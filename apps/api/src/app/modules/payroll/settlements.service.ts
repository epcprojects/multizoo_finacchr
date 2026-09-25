import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  JournalEntryKind,
  JournalEntrySource,
  PayrollAdjustmentKind,
  SettlementStatus,
} from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { Employee, SalaryRevision } from '../hr/entities/employee.entity';
import { DisciplinaryRecord } from '../hr/entities/attendance.entity';
import { LeaveType } from '../hr/entities/leave.entity';
import { LeaveService } from '../hr/leave.service';
import { activePolicies, loadEmployee, lockEmployees, policyOn, userNames } from '../hr/hr-common';
import { fromHalves, yearOf } from '../hr/hr-math';
import { visibleUnitIds } from '../../../common/scope/unit-scope';
import { Payslip } from './entities/payroll.entity';
import { AdvanceRecovery } from './entities/advance.entity';
import { FinalSettlement, type SettlementSnapshot } from './entities/settlement.entity';
import { ensurePayrollAccounts } from './payroll-accounts';
import { assertPaymentDate, monthLabel, monthsBetween, nextMonth, payingAccount, payrollPolicyFor } from './payroll-common';
import { PayrollEngine, outstandingAdvances, type ComputedPayslip } from './payroll-engine.service';
import { refreshAdvanceStatuses } from './payroll.service';
import { encashableHalves, encashmentAmount, planRecovery } from './payroll-math';
import { CreateSettlementDto, ListSettlementsQueryDto, PayDto, UpdateSettlementDto } from './dto/payroll.dto';

const NIL = '00000000-0000-0000-0000-000000000000';
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
const P = (s: string) => toPaisa(s);

/**
 * Full & final settlement (architecture plan Part 07 §06, Fig. 15):
 *
 *   salary not yet paid through a payroll run, to the exit date
 * + leave encashment, for leave types the policy marks encashable
 * + commission-pool shares for those months, and anything else owed
 * − fines not yet collected, other deductions, statutory deductions
 * − outstanding advances (as far as what's owed covers them)
 * = net settlement
 */
@Injectable()
export class SettlementsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly engine: PayrollEngine,
    private readonly leave: LeaveService,
    private readonly journal: JournalService,
  ) {}

  /** The first month the settlement pays: the one after their last payslip, or the month they joined. */
  private async fromMonth(m: EntityManager, employee: Employee): Promise<string> {
    const [last] = await m.find(Payslip, { where: { employeeId: employee.id }, order: { month: 'DESC' }, take: 1 });
    return last ? nextMonth(last.month) : employee.joinDate.slice(0, 7);
  }

  /** The live calculation, in the same shape as the frozen snapshot. */
  private async compute(m: EntityManager, s: FinalSettlement, employee: Employee) {
    const exitDate = employee.exitDate as string;
    const exitMonth = exitDate.slice(0, 7);
    const fromMonth = await this.fromMonth(m, employee);
    const policy = await payrollPolicyFor(m, exitMonth);
    const warnings: string[] = [];
    const errors: string[] = [];

    const months: ComputedPayslip[] = [];
    for (const month of fromMonth <= exitMonth ? monthsBetween(fromMonth, exitMonth) : []) {
      const [c] = await this.engine.computeMonth(m, [employee], month, await payrollPolicyFor(m, month), { collect: false });
      months.push(c);
      warnings.push(...c.warnings.map((w) => `${monthLabel(month)}: ${w}`));
      errors.push(...c.errors);
    }
    if (fromMonth > exitMonth) warnings.push('Every month to the exit date has already been paid through payroll.');

    // Leave encashment: encashable types, at the salary in force on the exit date.
    const encashment: SettlementSnapshot['encashment'] = [];
    const [revision] = await m.find(SalaryRevision, {
      where: { employeeId: employee.id },
      order: { effectiveFrom: 'DESC' },
    }).then((rows) => rows.filter((r) => r.effectiveFrom <= exitDate));
    const year = yearOf(exitDate);
    const hrPolicy = policyOn(await activePolicies(m), employee.joinDate > `${year}-01-01` ? employee.joinDate : `${year}-01-01`);
    const ledgers = (await this.leave.ledgers(m, [employee], year)).get(employee.id);
    const types = await m.find(LeaveType, { withDeleted: true });
    for (const rule of hrPolicy?.leaveRules ?? []) {
      if (!rule.encashable || !rule.employmentTypes.includes(employee.employmentType)) continue;
      const y = ledgers?.byType.get(rule.leaveTypeId);
      if (!y || !revision) continue;
      const halves = encashableHalves({
        exitDate,
        carriedIn: y.carriedIn,
        adjustments: y.adjustments,
        entitlement: y.entitlement,
        eligibleFrom: y.eligibleFrom,
        taken: y.taken,
      });
      if (!halves) continue;
      encashment.push({
        leaveTypeId: rule.leaveTypeId,
        name: types.find((t) => t.id === rule.leaveTypeId)?.name ?? 'Leave',
        days: fromHalves(halves),
        amount: fromPaisa(encashmentAmount(P(revision.baseSalary), revision.payBasis, halves, policy.daysPerMonth)),
      });
    }

    // Fines not collected by any payroll, and every outstanding advance.
    const fines = await m.find(DisciplinaryRecord, {
      where: {
        employeeId: employee.id,
        type: DisciplinaryType.FINE,
        status: DisciplinaryStatus.APPROVED,
        payslipId: IsNull(),
        settlementId: IsNull(),
      },
      order: { incidentDate: 'ASC' },
    });
    const pendingFines = await m.count(DisciplinaryRecord, {
      where: { employeeId: employee.id, type: DisciplinaryType.FINE, status: DisciplinaryStatus.PENDING_APPROVAL },
    });
    if (pendingFines) warnings.push(`${pendingFines} ${pendingFines === 1 ? 'fine is' : 'fines are'} still awaiting approval — not deducted.`);
    const advances = (await outstandingAdvances(m, [employee.id], exitDate)).get(employee.id) ?? [];
    const later = (await outstandingAdvances(m, [employee.id], '9999-12-31')).get(employee.id) ?? [];
    if (later.length > advances.length) warnings.push('An advance dated after the exit date is outstanding — check it.');

    const salaryForDays = sum(months.map((c) => c.result.salaryForDays));
    const poolBonus = sum(months.map((c) => c.result.poolBonus));
    const st = (k: 'eobiEmployee' | 'eobiEmployer' | 'tax' | 'pfEmployee' | 'pfEmployer') => sum(months.map((c) => c.result.statutory[k]));
    const leaveEncashment = sum(encashment.map((e) => P(e.amount)));
    const additions = sum(s.adjustments.filter((a) => a.kind === PayrollAdjustmentKind.ALLOWANCE).map((a) => P(a.amount)));
    const deductions = sum(s.adjustments.filter((a) => a.kind === PayrollAdjustmentKind.DEDUCTION).map((a) => P(a.amount)));
    const finesTotal = sum(fines.map((f) => P(f.amount as string)));
    const statutoryEmployee = st('eobiEmployee') + st('tax') + st('pfEmployee');
    const statutoryEmployer = st('eobiEmployer') + st('pfEmployer');

    const available = salaryForDays + poolBonus + leaveEncashment + additions - finesTotal - deductions - statutoryEmployee;
    const outstanding = sum(advances.map((a) => a.outstanding));
    const recoveries = planRecovery(advances, available, outstanding);
    const recovered = sum(recoveries.map((r) => r.amount));
    const net = available - recovered;
    if (net < 0n) errors.push(`Fines and deductions come to Rs ${fromPaisa(-net)} more than what's owed — reduce a deduction.`);
    if (outstanding > recovered) {
      warnings.push(`Rs ${fromPaisa(outstanding - recovered)} of advances is more than what's owed — it stays outstanding against ${employee.fullName}.`);
    }
    if (!revision) errors.push(`${employee.fullName} has no salary recorded.`);

    const snapshot: SettlementSnapshot = {
      months: months.map((c) => ({
        month: c.month,
        salary: fromPaisa(c.result.salary),
        absentDays: c.absentDays,
        earned: fromPaisa(c.result.earned),
        absenceDeduction: fromPaisa(c.result.absenceDeduction),
        salaryForDays: fromPaisa(c.result.salaryForDays),
        poolBonus: fromPaisa(c.result.poolBonus),
        eobiEmployee: fromPaisa(c.result.statutory.eobiEmployee),
        eobiEmployer: fromPaisa(c.result.statutory.eobiEmployer),
        tax: fromPaisa(c.result.statutory.tax),
        pfEmployee: fromPaisa(c.result.statutory.pfEmployee),
        pfEmployer: fromPaisa(c.result.statutory.pfEmployer),
      })),
      salaryForDays: fromPaisa(salaryForDays),
      poolBonus: fromPaisa(poolBonus),
      encashment,
      leaveEncashment: fromPaisa(leaveEncashment),
      additions: fromPaisa(additions),
      fines: fines.map((f) => ({ id: f.id, date: f.incidentDate, reason: f.reason, amount: f.amount as string })),
      finesTotal: fromPaisa(finesTotal),
      deductions: fromPaisa(deductions),
      statutoryEmployee: fromPaisa(statutoryEmployee),
      statutoryEmployer: fromPaisa(statutoryEmployer),
      eobiEmployee: fromPaisa(st('eobiEmployee')),
      eobiEmployer: fromPaisa(st('eobiEmployer')),
      tax: fromPaisa(st('tax')),
      pfEmployee: fromPaisa(st('pfEmployee')),
      pfEmployer: fromPaisa(st('pfEmployer')),
      advances: advances.map((a) => ({
        advanceId: a.id,
        issueDate: a.issueDate,
        outstanding: fromPaisa(a.outstanding),
        recovered: fromPaisa(recoveries.find((r) => r.id === a.id)?.amount ?? 0n),
      })),
      advanceRecovered: fromPaisa(recovered),
      stillOwed: fromPaisa(outstanding - recovered),
      net: fromPaisa(net),
      cost: fromPaisa(salaryForDays + poolBonus + leaveEncashment + additions + statutoryEmployer),
    };
    return { snapshot, fromMonth, policy, fines, recoveries, warnings, errors, months };
  }

  private async load(m: EntityManager, id: string, user: AuthenticatedUser, lock = false) {
    const s = await m.findOne(FinalSettlement, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!s) throw new NotFoundException('Settlement not found');
    const employee = await loadEmployee(m, s.employeeId, user);
    return { s, employee };
  }

  async list(query: ListSettlementsQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(FinalSettlement, 's')
      .leftJoinAndSelect('s.employee', 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('s.businessUnit', 'bu')
      .orderBy('s.createdAt', 'DESC');
    if (query.businessUnitId) qb.andWhere('s.businessUnitId = :u', { u: query.businessUnitId });
    if (query.employeeId) qb.andWhere('s.employeeId = :e', { e: query.employeeId });
    if (query.status) qb.andWhere('s.status = :st', { st: query.status });
    if (scope) qb.andWhere('s.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const rows = await qb.getMany();
    return rows.map((s) => ({
      id: s.id,
      status: s.status,
      employee: {
        id: s.employee.id,
        employeeCode: s.employee.employeeCode,
        fullName: s.employee.fullName,
        designation: s.employee.designation?.name ?? null,
        exitDate: s.employee.exitDate,
      },
      businessUnit: { id: s.businessUnit.id, code: s.businessUnit.code, name: s.businessUnit.name },
      exitDate: s.status === SettlementStatus.DRAFT ? s.employee.exitDate : s.exitDate,
      net: s.net,
      paidOn: s.paidOn,
      createdAt: s.createdAt,
    }));
  }

  /** Staff who have left (or are leaving) with no settlement yet. */
  async awaiting(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('e.businessUnit', 'bu')
      .where('e.status = :st', { st: EmployeeStatus.EXITED })
      .andWhere('NOT EXISTS (SELECT 1 FROM final_settlements s WHERE s."employeeId" = e.id)')
      .orderBy('e.exitDate', 'DESC');
    if (scope) qb.andWhere('e.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    return (await qb.getMany()).map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      designation: e.designation?.name ?? null,
      businessUnit: { id: e.businessUnit.id, code: e.businessUnit.code, name: e.businessUnit.name },
      exitDate: e.exitDate,
      exitReason: e.exitReason,
    }));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const { s, employee } = await this.load(m, id, user);
    const today = businessDate();
    let snapshot: SettlementSnapshot;
    let warnings: string[] = [];
    let errors: string[] = [];
    let fromMonth = s.fromMonth;
    if (s.status === SettlementStatus.DRAFT) {
      const live = await this.compute(m, s, employee);
      snapshot = live.snapshot;
      warnings = live.warnings;
      errors = live.errors;
      fromMonth = live.fromMonth;
    } else {
      snapshot = s.snapshot as SettlementSnapshot;
    }
    const exitDate = s.status === SettlementStatus.DRAFT ? (employee.exitDate as string) : s.exitDate;
    const entryIds = [s.accrualEntryId, s.paymentEntryId].filter(Boolean) as string[];
    const entries = entryIds.length ? await m.find(JournalEntry, { where: { id: In(entryIds) } }) : [];
    const no = (eid: string | null) => {
      const e = entries.find((x) => x.id === eid);
      return e ? { id: e.id, displayNo: formatEntryNo(e.entryNo) } : null;
    };
    const names = await userNames(m, [s.createdBy, s.finalizedBy]);
    const full = await m.findOne(Employee, { where: { id: employee.id }, relations: { designation: true, businessUnit: true, department: true } });
    return {
      id: s.id,
      status: s.status,
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        fatherName: employee.fatherName,
        cnic: employee.cnic,
        designation: full?.designation?.name ?? null,
        department: full?.department?.name ?? null,
        businessUnit: full ? { id: full.businessUnit.id, code: full.businessUnit.code, name: full.businessUnit.name } : null,
        joinDate: employee.joinDate,
        exitDate,
        exitReason: employee.exitReason,
        employmentType: employee.employmentType,
      },
      fromMonth,
      snapshot,
      adjustments: s.adjustments,
      warnings,
      errors,
      canFinalize: s.status === SettlementStatus.DRAFT && !errors.length && exitDate <= today,
      finalizableFrom: exitDate,
      accrualEntry: no(s.accrualEntryId),
      paymentEntry: no(s.paymentEntryId),
      paidOn: s.paidOn,
      note: s.note,
      createdAt: s.createdAt,
      createdByName: s.createdBy ? names.get(s.createdBy) ?? null : null,
      finalizedAt: s.finalizedAt,
      finalizedByName: s.finalizedBy ? names.get(s.finalizedBy) ?? null : null,
    };
  }

  async create(dto: CreateSettlementDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, dto.employeeId, user);
      await lockEmployees(m, [employee.id]);
      if (employee.status !== EmployeeStatus.EXITED || !employee.exitDate) {
        throw new BadRequestException(`Record ${employee.fullName}'s exit first — the settlement is worked out to their last day.`);
      }
      const existing = await m.findOne(FinalSettlement, { where: { employeeId: employee.id } });
      if (existing) throw new ConflictException(`${employee.fullName} already has a settlement.`);
      const s = await m.save(
        m.create(FinalSettlement, {
          employeeId: employee.id,
          businessUnitId: employee.businessUnitId,
          exitDate: employee.exitDate,
          fromMonth: await this.fromMonth(m, employee),
          status: SettlementStatus.DRAFT,
          adjustments: [],
          createdBy: user.id,
        }),
      );
      return s.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateSettlementDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const { s } = await this.load(m, id, user, true);
      if (s.status !== SettlementStatus.DRAFT) throw new ConflictException('This settlement is finalised — reopen it to change it.');
      if (dto.adjustments) {
        s.adjustments = dto.adjustments.map((a) => ({ kind: a.kind, amount: fromPaisa(toPaisa(a.amount)), description: a.description.trim() }));
      }
      if (dto.note !== undefined) s.note = dto.note.trim() || null;
      s.updatedBy = user.id;
      await m.save(s);
    });
    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const { s } = await this.load(m, id, user, true);
      if (s.status !== SettlementStatus.DRAFT) throw new ConflictException('Only a draft settlement can be deleted.');
      await m.delete(FinalSettlement, { id: s.id });
    });
    return { deleted: true };
  }

  async finalize(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const { s, employee } = await this.load(m, id, user, true);
      if (s.status !== SettlementStatus.DRAFT) throw new ConflictException('This settlement is already finalised.');
      await lockEmployees(m, [employee.id]);
      const exitDate = employee.exitDate as string;
      if (employee.status !== EmployeeStatus.EXITED || !employee.exitDate) throw new BadRequestException(`${employee.fullName} is no longer recorded as leaving.`);
      if (exitDate > businessDate()) throw new BadRequestException(`The settlement can be finalised from ${exitDate}, their last day.`);
      const live = await this.compute(m, s, employee);
      if (live.errors.length) throw new BadRequestException(live.errors.join(' '));
      const snap = live.snapshot;

      const accounts = await ensurePayrollAccounts(m);
      const salaries = P(snap.salaryForDays) + P(snap.leaveEncashment) + P(snap.additions);
      const lines = ([
        { accountId: accounts.SALARIES_EXPENSE.id, debit: salaries, memo: 'Final salary, leave encashment and other dues' },
        { accountId: accounts.BONUS_EXPENSE.id, debit: P(snap.poolBonus), memo: 'Commission pool shares' },
        { accountId: accounts.STATUTORY_EXPENSE.id, debit: P(snap.statutoryEmployer), memo: 'Employer EOBI and provident fund' },
        { accountId: accounts.SALARIES_PAYABLE.id, credit: P(snap.net), memo: 'Net settlement owed' },
        { accountId: accounts.STAFF_ADVANCES.id, credit: P(snap.advanceRecovered), memo: 'Advances recovered' },
        { accountId: accounts.STAFF_RECOVERIES.id, credit: P(snap.finesTotal) + P(snap.deductions), memo: 'Fines and deductions' },
        { accountId: accounts.EOBI_PAYABLE.id, credit: P(snap.eobiEmployee) + P(snap.eobiEmployer), memo: 'EOBI' },
        { accountId: accounts.TAX_WITHHELD.id, credit: P(snap.tax), memo: 'Income tax withheld' },
        { accountId: accounts.PF_PAYABLE.id, credit: P(snap.pfEmployee) + P(snap.pfEmployer), memo: 'Provident fund' },
      ] as { accountId: string; debit?: bigint; credit?: bigint; memo: string }[])
        .filter((l) => (l.debit ?? l.credit ?? 0n) > 0n)
        .map((l) => ({
          accountId: l.accountId,
          debit: l.debit !== undefined ? fromPaisa(l.debit) : null,
          credit: l.credit !== undefined ? fromPaisa(l.credit) : null,
          memo: l.memo,
        }));

      let accrualEntryId: string | null = null;
      if (lines.length >= 2) {
        const entry = (await this.journal.post(
          {
            entryDate: exitDate,
            businessUnitId: s.businessUnitId,
            description: `Full & final settlement — ${employee.fullName} (${employee.employeeCode}), left ${exitDate}`,
            reference: `FFS-${employee.employeeCode}`,
            kind: JournalEntryKind.PAYROLL,
            lines,
          },
          user,
          { manager: m, source: JournalEntrySource.PAYROLL },
        )) as JournalEntry;
        accrualEntryId = entry.id;
      }

      const exitMonth = exitDate.slice(0, 7);
      if (live.fines.length) {
        await m.update(DisciplinaryRecord, { id: In(live.fines.map((f) => f.id)) }, { settlementId: s.id, deductedMonth: exitMonth });
      }
      for (const r of live.recoveries) {
        await m.save(m.create(AdvanceRecovery, { advanceId: r.id, amount: fromPaisa(r.amount), month: exitMonth, payslipId: null, settlementId: s.id }));
      }
      await refreshAdvanceStatuses(m, live.recoveries.map((r) => r.id));

      const zero = toPaisa(snap.net) === 0n;
      await m.update(FinalSettlement, { id: s.id }, {
        status: zero ? SettlementStatus.PAID : SettlementStatus.FINALIZED,
        exitDate,
        fromMonth: live.fromMonth,
        snapshot: snap,
        net: snap.net,
        policyId: live.policy.id,
        accrualEntryId,
        paidOn: zero ? businessDate() : null,
        finalizedAt: new Date(),
        finalizedBy: user.id,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  async reopen(id: string, reason: string | undefined, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const { s } = await this.load(m, id, user, true);
      if (s.status === SettlementStatus.DRAFT) throw new ConflictException('This settlement is already a draft.');
      if (s.paymentEntryId) throw new ConflictException('This settlement has been paid — it can’t be reopened.');
      if (s.accrualEntryId) {
        await this.journal.reverseWithin(
          m,
          s.accrualEntryId,
          { reason: reason?.trim() || 'Settlement reopened', entryDate: businessDate() },
          user,
          { fromPayroll: true, source: JournalEntrySource.PAYROLL },
        );
      }
      const recovered = await m.find(AdvanceRecovery, { where: { settlementId: s.id } });
      await m.delete(AdvanceRecovery, { settlementId: s.id });
      await refreshAdvanceStatuses(m, recovered.map((r) => r.advanceId));
      await m.update(DisciplinaryRecord, { settlementId: s.id }, { settlementId: null, deductedMonth: null });
      await m.update(FinalSettlement, { id: s.id }, {
        status: SettlementStatus.DRAFT,
        snapshot: null,
        net: null,
        policyId: null,
        accrualEntryId: null,
        paidOn: null,
        finalizedAt: null,
        finalizedBy: null,
        note: reason?.trim() ? `Reopened: ${reason.trim()}` : s.note,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  async pay(id: string, dto: PayDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const { s, employee } = await this.load(m, id, user, true);
      if (s.status !== SettlementStatus.FINALIZED) {
        throw new ConflictException(s.status === SettlementStatus.DRAFT ? 'Finalise the settlement before paying it.' : 'This settlement is already paid.');
      }
      assertPaymentDate(dto.paymentDate, s.exitDate);
      const account = await payingAccount(m, dto.accountId, s.businessUnitId);
      const accounts = await ensurePayrollAccounts(m);
      const amount = s.net as string;
      const entry = (await this.journal.post(
        {
          entryDate: dto.paymentDate,
          businessUnitId: s.businessUnitId,
          description: `Full & final settlement paid — ${employee.fullName} (${employee.employeeCode})`,
          reference: `FFS-${employee.employeeCode}`,
          kind: JournalEntryKind.MONEY_OUT,
          reserveAccountId: dto.reserveAccountId ?? null,
          lines: [
            { accountId: accounts.SALARIES_PAYABLE.id, debit: amount, memo: employee.fullName },
            { accountId: account.id, credit: amount, memo: null },
          ],
        },
        user,
        { manager: m, source: JournalEntrySource.PAYROLL },
      )) as JournalEntry;
      await m.update(FinalSettlement, { id: s.id }, { status: SettlementStatus.PAID, paymentEntryId: entry.id, paidOn: dto.paymentDate, updatedBy: user.id });
    });
    return this.findOne(id, user);
  }
}

