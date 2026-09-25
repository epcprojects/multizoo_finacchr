import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import {
  BonusPoolStatus,
  JournalEntryKind,
  JournalEntrySource,
  PayrollAdjustmentKind,
  PayrollRunStatus,
  SalaryAdvanceStatus,
  SettlementStatus,
} from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { Employee } from '../hr/entities/employee.entity';
import { DisciplinaryRecord } from '../hr/entities/attendance.entity';
import { lockEmployees, userNames } from '../hr/hr-common';
import { monthBounds } from '../hr/hr-math';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { PayrollAdjustment, PayrollPolicy, PayrollRun, Payslip } from './entities/payroll.entity';
import { AdvanceRecovery, SalaryAdvance } from './entities/advance.entity';
import { BonusPool } from './entities/bonus.entity';
import { FinalSettlement } from './entities/settlement.entity';
import { ensurePayrollAccounts } from './payroll-accounts';
import {
  assertPaymentDate,
  lockPayMonth,
  monthLabel,
  payingAccount,
  payrollPolicyFor,
} from './payroll-common';
import { PayrollEngine, type ComputedPayslip } from './payroll-engine.service';
import { CreatePayrollRunDto, FinalizeDto, PayDto, PayrollAdjustmentDto } from './dto/payroll.dto';

const NIL = '00000000-0000-0000-0000-000000000000';
const m2 = (p: bigint) => fromPaisa(p);
const sumOf = <T>(rows: T[], pick: (r: T) => string | bigint) =>
  rows.reduce((s, r) => {
    const v = pick(r);
    return s + (typeof v === 'bigint' ? v : toPaisa(v));
  }, 0n);

const MONEY_COLUMNS = [
  'salary', 'earned', 'absenceDeduction', 'advance', 'gross', 'poolBonus', 'allowances', 'bonus', 'fines', 'food',
  'otherDeductions', 'eobiEmployee', 'eobiEmployer', 'tax', 'pfEmployee', 'pfEmployer', 'net', 'cost',
] as const;
type MoneyColumn = (typeof MONEY_COLUMNS)[number];

/** One row of the salary sheet as the screens show it — live (draft) or frozen (finalised). */
export type PayRow = Record<MoneyColumn, string> & {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  payBasis: string;
  absentDays: string;
  details: Payslip['details'];
  warnings: string[];
  errors: string[];
  payslipId: string | null;
  paidOn: string | null;
  paymentEntryId: string | null;
};

export function rowFromComputed(c: ComputedPayslip): PayRow {
  const r = c.result;
  return {
    employeeId: c.employee.id,
    employeeCode: c.employee.employeeCode,
    fullName: c.employee.fullName,
    designation: c.employee.designation?.name ?? null,
    department: c.employee.department?.name ?? null,
    payBasis: r.basis,
    absentDays: c.absentDays,
    salary: m2(r.salary),
    earned: m2(r.earned),
    absenceDeduction: m2(r.absenceDeduction),
    advance: m2(r.advanceRecovered),
    gross: m2(r.gross),
    poolBonus: m2(r.poolBonus),
    allowances: m2(r.allowances),
    bonus: m2(r.bonus),
    fines: m2(r.fines),
    food: m2(r.food),
    otherDeductions: m2(r.otherDeductions),
    eobiEmployee: m2(r.statutory.eobiEmployee),
    eobiEmployer: m2(r.statutory.eobiEmployer),
    tax: m2(r.statutory.tax),
    pfEmployee: m2(r.statutory.pfEmployee),
    pfEmployer: m2(r.statutory.pfEmployer),
    net: m2(r.net),
    cost: m2(r.cost),
    details: c.details,
    warnings: c.warnings,
    errors: c.errors,
    payslipId: null,
    paidOn: null,
    paymentEntryId: null,
  };
}

function rowFromPayslip(p: Payslip): PayRow {
  const money = Object.fromEntries(MONEY_COLUMNS.map((k) => [k, fromPaisa(toPaisa(p[k]))])) as Record<MoneyColumn, string>;
  return {
    ...money,
    employeeId: p.employeeId,
    employeeCode: p.employeeCode,
    fullName: p.fullName,
    designation: p.designation,
    department: p.department,
    payBasis: p.payBasis,
    absentDays: String(Number(p.absentDays)),
    details: p.details,
    warnings: [],
    errors: [],
    payslipId: p.id,
    paidOn: p.paidOn,
    paymentEntryId: p.paymentEntryId,
  };
}

export function totalsOf(rows: PayRow[]) {
  return Object.fromEntries(MONEY_COLUMNS.filter((k) => k !== 'salary').map((k) => [k, fromPaisa(sumOf(rows, (r) => r[k]))])) as Record<
    Exclude<MoneyColumn, 'salary'>,
    string
  > & { salary?: string };
}

/**
 * Payroll runs (architecture plan Part 07 §05, module M6): a unit's month
 * of pay, from draft to paid. The logic of the salary sheet doesn't change —
 * where its inputs come from does.
 */
@Injectable()
export class PayrollService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly engine: PayrollEngine,
    private readonly journal: JournalService,
  ) {}

  // --- Who is on a run --------------------------------------------------------------

  /**
   * Everyone who belongs to the unit and was employed at some point in the
   * month — less anyone already paid for it by another run (a transfer), or
   * whose full & final settlement covers it.
   */
  async members(m: EntityManager, run: Pick<PayrollRun, 'id' | 'businessUnitId' | 'month'>): Promise<Employee[]> {
    const { from, to } = monthBounds(run.month);
    return m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('e.department', 'dep')
      .where('e.businessUnitId = :unit', { unit: run.businessUnitId })
      .andWhere('e.joinDate <= :to', { to })
      .andWhere(new Brackets((b) => b.where('e.exitDate IS NULL').orWhere('e.exitDate >= :from', { from })))
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM payslips p WHERE p."employeeId" = e.id AND p.month = :month AND p."runId" <> :runId)`,
        { month: run.month, runId: run.id ?? NIL },
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM final_settlements s WHERE s."employeeId" = e.id AND s."fromMonth" <= :month AND to_char(s."exitDate", 'YYYY-MM') >= :month)`,
        { month: run.month },
      )
      .orderBy('dep.name', 'ASC', 'NULLS LAST')
      .addOrderBy('e.fullName')
      .getMany();
  }

  private async loadRun(m: EntityManager, id: string, user: AuthenticatedUser, lock = false): Promise<PayrollRun> {
    const run = await m.findOne(PayrollRun, {
      where: { id },
      relations: { businessUnit: true },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const, tables: ['payroll_runs'] } } : {}),
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    assertUnitAccess(user, run.businessUnitId);
    return run;
  }

  /** The live calculation of a draft run. */
  private async computeDraft(m: EntityManager, run: PayrollRun) {
    const policy = await payrollPolicyFor(m, run.month);
    const employees = await this.members(m, run);
    const adjustments = await m.find(PayrollAdjustment, { where: { runId: run.id }, order: { createdAt: 'ASC' } });
    const computed = await this.engine.computeMonth(m, employees, run.month, policy, { adjustments, collect: true });
    return { policy, computed, adjustments };
  }

  // --- Reading ------------------------------------------------------------------------

  /** Every unit's run for a month — started or not. */
  async overview(month: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const units = (await m.find(BusinessUnit, { where: { isActive: true }, relations: { unitType: true }, order: { code: 'ASC' } })).filter(
      (u) => !u.unitType?.isHolding && (!scope || scope.includes(u.id)),
    );
    const runs = await m.find(PayrollRun, { where: { month } });
    const out: {
      unit: { id: string; code: string; name: string };
      run: { id: string; status: PayrollRunStatus; net: string; cost: string; unpaid: string; issues: number } | null;
      headcount: number;
    }[] = [];
    for (const unit of units) {
      const run = runs.find((r) => r.businessUnitId === unit.id) ?? null;
      let rows: PayRow[] = [];
      let issues = 0;
      if (run && run.status !== PayrollRunStatus.DRAFT) {
        rows = (await m.find(Payslip, { where: { runId: run.id } })).map(rowFromPayslip);
      } else if (run) {
        try {
          const { computed } = await this.computeDraft(m, run);
          rows = computed.map(rowFromComputed);
          issues = computed.reduce((s, c) => s + c.errors.length + c.warnings.length, 0);
        } catch {
          rows = [];
        }
      }
      const headcount = run ? rows.length : (await this.members(m, { id: NIL, businessUnitId: unit.id, month })).length;
      out.push({
        unit: { id: unit.id, code: unit.code, name: unit.name },
        run: run
          ? {
              id: run.id,
              status: run.status,
              net: fromPaisa(sumOf(rows, (r) => r.net)),
              cost: fromPaisa(sumOf(rows, (r) => r.cost)),
              unpaid: fromPaisa(sumOf(rows.filter((r) => !r.paidOn), (r) => r.net)),
              issues,
            }
          : null,
        headcount,
      });
    }
    return { month, units: out };
  }

  async list(user: AuthenticatedUser, year?: number) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(PayrollRun, 'r')
      .leftJoinAndSelect('r.businessUnit', 'bu')
      .orderBy('r.month', 'DESC')
      .addOrderBy('bu.code');
    if (year) qb.andWhere('r.month LIKE :y', { y: `${year}-%` });
    if (scope) qb.andWhere('r.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const runs = await qb.getMany();
    const totals: { runId: string; net: string; cost: string; count: string; unpaid: string }[] = runs.length
      ? await m.query(
          `SELECT "runId", SUM(net) AS net, SUM(cost) AS cost, COUNT(*) AS count,
                  COALESCE(SUM(net) FILTER (WHERE "paidOn" IS NULL), 0) AS unpaid
             FROM payslips WHERE "runId" = ANY($1) GROUP BY "runId"`,
          [runs.map((r) => r.id)],
        )
      : [];
    return runs.map((r) => {
      const t = totals.find((x) => x.runId === r.id);
      return {
        id: r.id,
        month: r.month,
        status: r.status,
        businessUnit: { id: r.businessUnit.id, code: r.businessUnit.code, name: r.businessUnit.name },
        headcount: t ? Number(t.count) : null,
        net: t ? fromPaisa(toPaisa(String(t.net))) : null,
        cost: t ? fromPaisa(toPaisa(String(t.cost))) : null,
        unpaid: t ? fromPaisa(toPaisa(String(t.unpaid))) : null,
        finalizedAt: r.finalizedAt,
      };
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const run = await this.loadRun(m, id, user);
    const { to } = monthBounds(run.month);
    let rows: PayRow[];
    let policy: PayrollPolicy | null;
    let adjustments: PayrollAdjustment[] = [];
    const runWarnings: string[] = [];
    if (run.status === PayrollRunStatus.DRAFT) {
      const draft = await this.computeDraft(m, run);
      rows = draft.computed.map(rowFromComputed);
      policy = draft.policy;
      adjustments = draft.adjustments;
      const draftPools = await m.count(BonusPool, { where: { month: run.month, businessUnitId: run.businessUnitId, status: BonusPoolStatus.DRAFT } });
      if (draftPools) runWarnings.push(`${draftPools} commission ${draftPools === 1 ? 'pool for this month is' : 'pools for this month are'} still a draft — only approved pools are paid.`);
    } else {
      rows = (await m.find(Payslip, { where: { runId: run.id }, order: { department: 'ASC', fullName: 'ASC' } })).map(rowFromPayslip);
      policy = run.policyId ? await m.findOne(PayrollPolicy, { where: { id: run.policyId } }) : null;
    }

    const entryIds = [run.accrualEntryId, ...rows.map((r) => r.paymentEntryId)].filter(Boolean) as string[];
    const entries = entryIds.length ? await m.find(JournalEntry, { where: { id: In([...new Set(entryIds)]) } }) : [];
    const entryNo = (eid: string | null) => {
      const e = entries.find((x) => x.id === eid);
      return e ? formatEntryNo(e.entryNo) : null;
    };
    const payments = [...new Set(rows.map((r) => r.paymentEntryId).filter(Boolean) as string[])].map((eid) => {
      const paid = rows.filter((r) => r.paymentEntryId === eid);
      return { entryId: eid, displayNo: entryNo(eid), date: paid[0].paidOn, count: paid.length, amount: fromPaisa(sumOf(paid, (r) => r.net)) };
    });
    const names = await userNames(m, [run.finalizedBy, run.createdBy]);
    const today = businessDate();
    const errors = rows.flatMap((r) => r.errors);
    const warnings = [...runWarnings, ...rows.flatMap((r) => r.warnings.map((w) => `${r.fullName}: ${w}`))];

    return {
      id: run.id,
      month: run.month,
      status: run.status,
      businessUnit: { id: run.businessUnit.id, code: run.businessUnit.code, name: run.businessUnit.name },
      policy: policy
        ? {
            id: policy.id,
            version: policy.version,
            daysPerMonth: policy.daysPerMonth,
            eobiEnabled: policy.eobiEnabled,
            taxEnabled: policy.taxEnabled,
            pfEnabled: policy.pfEnabled,
          }
        : null,
      finalizableFrom: to,
      canFinalize: run.status === PayrollRunStatus.DRAFT && today >= to && !errors.length,
      rows: rows.map((r) => ({ ...r, paymentEntryNo: entryNo(r.paymentEntryId) })),
      totals: totalsOf(rows),
      unpaid: fromPaisa(sumOf(rows.filter((r) => !r.paidOn), (r) => r.net)),
      errors,
      warnings,
      adjustments: adjustments.map((a) => ({ id: a.id, employeeId: a.employeeId, kind: a.kind, amount: a.amount, description: a.description })),
      accrualEntry: run.accrualEntryId ? { id: run.accrualEntryId, displayNo: entryNo(run.accrualEntryId) } : null,
      payments,
      createdAt: run.createdAt,
      createdByName: run.createdBy ? names.get(run.createdBy) ?? null : null,
      finalizedAt: run.finalizedAt,
      finalizedByName: run.finalizedBy ? names.get(run.finalizedBy) ?? null : null,
      note: run.note,
    };
  }

  /** One person's payslip in a run — live for a draft. */
  async payslip(runId: string, employeeId: string, user: AuthenticatedUser) {
    const run = await this.findOne(runId, user);
    const row = run.rows.find((r) => r.employeeId === employeeId);
    if (!row) throw new NotFoundException('That employee is not on this run.');
    const employee = await this.dataSource.manager.findOne(Employee, { where: { id: employeeId }, relations: { designation: true } });
    return {
      run: { id: run.id, month: run.month, status: run.status, businessUnit: run.businessUnit, policy: run.policy },
      employee: employee
        ? { id: employee.id, employeeCode: employee.employeeCode, fullName: employee.fullName, cnic: employee.cnic, joinDate: employee.joinDate, employmentType: employee.employmentType }
        : null,
      row,
    };
  }

  async employeePayslips(employeeId: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const employee = await m.findOne(Employee, { where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');
    assertUnitAccess(user, employee.businessUnitId);
    const slips = await m.find(Payslip, { where: { employeeId }, relations: { run: { businessUnit: true } }, order: { month: 'DESC' } });
    return slips.map((p) => ({
      runId: p.runId,
      month: p.month,
      businessUnit: { id: p.run.businessUnit.id, code: p.run.businessUnit.code, name: p.run.businessUnit.name },
      salary: p.salary,
      absentDays: String(Number(p.absentDays)),
      gross: p.gross,
      bonus: p.bonus,
      fines: p.fines,
      net: p.net,
      paidOn: p.paidOn,
    }));
  }

  // --- Draft ----------------------------------------------------------------------------

  async create(dto: CreatePayrollRunDto, user: AuthenticatedUser) {
    assertUnitAccess(user, dto.businessUnitId);
    if (dto.month > businessDate().slice(0, 7)) throw new BadRequestException('A payroll run can’t be started for a future month.');
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await m.findOne(BusinessUnit, { where: { id: dto.businessUnitId } });
      if (!unit || !unit.isActive) throw new BadRequestException('That business unit is not active.');
      await lockPayMonth(m, unit.id, dto.month);
      const existing = await m.findOne(PayrollRun, { where: { businessUnitId: unit.id, month: dto.month } });
      if (existing) throw new ConflictException(`${unit.name} already has a ${monthLabel(dto.month)} payroll run.`);
      await payrollPolicyFor(m, dto.month);
      const run = await m.save(m.create(PayrollRun, { businessUnitId: unit.id, month: dto.month, status: PayrollRunStatus.DRAFT, createdBy: user.id }));
      return run.id;
    });
    return this.findOne(id, user);
  }

  private async draft(m: EntityManager, id: string, user: AuthenticatedUser) {
    const run = await this.loadRun(m, id, user, true);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException('This run is finalised — reopen it to change it.');
    }
    return run;
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.draft(m, id, user);
      await m.delete(PayrollRun, { id: run.id });
    });
    return { deleted: true };
  }

  async addAdjustment(id: string, dto: PayrollAdjustmentDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.draft(m, id, user);
      const members = await this.members(m, run);
      if (!members.some((e) => e.id === dto.employeeId)) throw new BadRequestException('That employee is not on this run.');
      if (dto.kind === PayrollAdjustmentKind.ADVANCE_RECOVERY) {
        // One override per person: the latest replaces any earlier one.
        await m.delete(PayrollAdjustment, { runId: run.id, employeeId: dto.employeeId, kind: PayrollAdjustmentKind.ADVANCE_RECOVERY });
      }
      await m.save(
        m.create(PayrollAdjustment, {
          runId: run.id,
          employeeId: dto.employeeId,
          kind: dto.kind,
          amount: fromPaisa(toPaisa(dto.amount)),
          description: dto.description.trim(),
          createdBy: user.id,
        }),
      );
    });
    return this.findOne(id, user);
  }

  async removeAdjustment(id: string, adjustmentId: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.draft(m, id, user);
      const res = await m.delete(PayrollAdjustment, { id: adjustmentId, runId: run.id });
      if (!res.affected) throw new NotFoundException('Adjustment not found');
    });
    return this.findOne(id, user);
  }

  // --- Finalise ------------------------------------------------------------------------

  /**
   * Freezes the month: payslips written, fines and advance recoveries
   * recorded against them, the cost posted to the ledger, attendance locked.
   */
  async finalize(id: string, dto: FinalizeDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.draft(m, id, user);
      const { to } = monthBounds(run.month);
      if (businessDate() < to) {
        throw new BadRequestException(`${monthLabel(run.month)} can be finalised from ${to}, its last day.`);
      }
      await lockPayMonth(m, run.businessUnitId, run.month);
      const preliminary = await this.members(m, run);
      await lockEmployees(m, preliminary.map((e) => e.id));

      const { policy, computed } = await this.computeDraft(m, run);
      if (!computed.length) throw new BadRequestException('Nobody is on this run.');
      const errors = computed.flatMap((c) => c.errors);
      if (errors.length) throw new BadRequestException(errors.join(' '));
      const warnings = computed.flatMap((c) => c.warnings);
      if (warnings.length && !dto.acknowledgeWarnings) {
        throw new BadRequestException(
          `There ${warnings.length === 1 ? 'is 1 warning' : `are ${warnings.length} warnings`} to look at before finalising — confirm you've checked them.`,
        );
      }

      const accounts = await ensurePayrollAccounts(m);
      const rows = computed.map(rowFromComputed);
      const total = (k: MoneyColumn) => sumOf(rows, (r) => r[k]);
      // Salary for the days worked (floored at zero per person) = gross + the advance taken out of it.
      const salaries = sumOf(rows, (r) => toPaisa(r.gross) + toPaisa(r.advance));
      const bonus = total('bonus');
      const employer = total('eobiEmployer') + total('pfEmployer');
      const net = total('net');
      const advances = total('advance');
      const recoveries = total('fines') + total('food') + total('otherDeductions');
      const eobi = total('eobiEmployee') + total('eobiEmployer');
      const tax = total('tax');
      const pf = total('pfEmployee') + total('pfEmployer');

      const lines = [
        { accountId: accounts.SALARIES_EXPENSE.id, debit: salaries, memo: 'Salary for the days worked' },
        { accountId: accounts.BONUS_EXPENSE.id, debit: bonus, memo: 'Commission pool shares and allowances' },
        { accountId: accounts.STATUTORY_EXPENSE.id, debit: employer, memo: 'Employer EOBI and provident fund' },
        { accountId: accounts.SALARIES_PAYABLE.id, credit: net, memo: 'Net pay owed' },
        { accountId: accounts.STAFF_ADVANCES.id, credit: advances, memo: 'Advances recovered' },
        { accountId: accounts.STAFF_RECOVERIES.id, credit: recoveries, memo: 'Fines, food and other deductions' },
        { accountId: accounts.EOBI_PAYABLE.id, credit: eobi, memo: 'EOBI, employee and employer' },
        { accountId: accounts.TAX_WITHHELD.id, credit: tax, memo: 'Income tax withheld' },
        { accountId: accounts.PF_PAYABLE.id, credit: pf, memo: 'Provident fund, employee and employer' },
      ]
        .filter((l) => ((l.debit ?? 0n) as bigint) > 0n || ((l.credit ?? 0n) as bigint) > 0n)
        .map((l) => ({
          accountId: l.accountId,
          debit: l.debit !== undefined ? fromPaisa(l.debit) : null,
          credit: l.credit !== undefined ? fromPaisa(l.credit) : null,
          memo: l.memo,
        }));

      let accrualEntryId: string | null = null;
      if (lines.length >= 2) {
        const entry = await this.journal.post(
          {
            entryDate: to,
            businessUnitId: run.businessUnitId,
            description: `Payroll — ${run.businessUnit.name}, ${monthLabel(run.month)} (${rows.length} staff)`,
            reference: `PAY-${run.month}-${run.businessUnit.code}`,
            kind: JournalEntryKind.PAYROLL,
            lines,
          },
          user,
          { manager: m, source: JournalEntrySource.PAYROLL },
        );
        accrualEntryId = (entry as JournalEntry).id;
      }

      const finalizedOn = businessDate();
      for (const c of computed) {
        const row = rowFromComputed(c);
        const slip = await m.save(
          m.create(Payslip, {
            runId: run.id,
            employeeId: c.employee.id,
            month: run.month,
            businessUnitId: run.businessUnitId,
            employeeCode: c.employee.employeeCode,
            fullName: c.employee.fullName,
            designation: c.employee.designation?.name ?? null,
            department: c.employee.department?.name ?? null,
            payBasis: c.result.basis,
            absentDays: c.absentDays,
            ...Object.fromEntries(MONEY_COLUMNS.map((k) => [k, row[k]])),
            details: c.details,
            paymentEntryId: null,
            paidOn: c.result.net === 0n ? finalizedOn : null,
          }),
        );
        if (c.fineIds.length) {
          await m.update(DisciplinaryRecord, { id: In(c.fineIds) }, { payslipId: slip.id, deductedMonth: run.month });
        }
        for (const r of c.result.recoveries) {
          await m.save(m.create(AdvanceRecovery, { advanceId: r.id, amount: fromPaisa(r.amount), month: run.month, payslipId: slip.id, settlementId: null }));
        }
      }
      await refreshAdvanceStatuses(m, computed.flatMap((c) => c.result.recoveries.map((r) => r.id)));

      const allPaid = computed.every((c) => c.result.net === 0n);
      await m.update(PayrollRun, { id: run.id }, {
        status: allPaid ? PayrollRunStatus.PAID : PayrollRunStatus.FINALIZED,
        policyId: policy.id,
        accrualEntryId,
        finalizedAt: new Date(),
        finalizedBy: user.id,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  /**
   * Back to draft, while nothing has been paid: the posting is reversed,
   * payslips removed, fines and advances handed back, attendance unlocked.
   */
  async reopen(id: string, reason: string | undefined, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.loadRun(m, id, user, true);
      if (run.status === PayrollRunStatus.DRAFT) throw new ConflictException('This run is already a draft.');
      await lockPayMonth(m, run.businessUnitId, run.month);
      const slips = await m.find(Payslip, { where: { runId: run.id } });
      if (slips.some((s) => s.paymentEntryId)) {
        throw new ConflictException('Some of this run has been paid — a paid run can’t be reopened. Correct it in next month’s run.');
      }
      const later = await m
        .createQueryBuilder(Payslip, 'p')
        .where('p.employeeId IN (:...ids)', { ids: slips.length ? slips.map((s) => s.employeeId) : [NIL] })
        .andWhere('p.month > :month', { month: run.month })
        .getCount();
      if (later) throw new ConflictException('A later month has already been finalised for some of these staff — reopen that first.');
      const settled = await m.count(FinalSettlement, {
        where: { employeeId: In(slips.map((s) => s.employeeId)), status: Not(SettlementStatus.DRAFT) },
      });
      if (settled) throw new ConflictException('A finalised settlement depends on this run — reopen it first.');

      if (run.accrualEntryId) {
        await this.journal.reverseWithin(
          m,
          run.accrualEntryId,
          { reason: reason?.trim() || 'Payroll run reopened', entryDate: businessDate() },
          user,
          { fromPayroll: true, source: JournalEntrySource.PAYROLL },
        );
      }
      const slipIds = slips.map((s) => s.id);
      if (slipIds.length) {
        const recovered = await m.find(AdvanceRecovery, { where: { payslipId: In(slipIds) } });
        await m.delete(AdvanceRecovery, { payslipId: In(slipIds) });
        await refreshAdvanceStatuses(m, recovered.map((r) => r.advanceId));
        await m.update(DisciplinaryRecord, { payslipId: In(slipIds) }, { payslipId: null, deductedMonth: null });
        await m.delete(Payslip, { runId: run.id });
      }
      await m.update(PayrollRun, { id: run.id }, {
        status: PayrollRunStatus.DRAFT,
        policyId: null,
        accrualEntryId: null,
        finalizedAt: null,
        finalizedBy: null,
        note: reason?.trim() ? `Reopened: ${reason.trim()}` : run.note,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  // --- Pay ---------------------------------------------------------------------------------

  /** Pays out net pay: Dr Salaries Payable, Cr the unit's cash / bank — optionally out of the Salary reserve. */
  async pay(id: string, dto: PayDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const run = await this.loadRun(m, id, user, true);
      if (run.status !== PayrollRunStatus.FINALIZED) {
        throw new ConflictException(run.status === PayrollRunStatus.DRAFT ? 'Finalise the run before paying it.' : 'This run is already paid.');
      }
      assertPaymentDate(dto.paymentDate, monthBounds(run.month).to);
      const account = await payingAccount(m, dto.accountId, run.businessUnitId);
      const unpaid = await m.find(Payslip, { where: { runId: run.id, paidOn: IsNull() }, order: { fullName: 'ASC' } });
      const chosen = dto.employeeIds?.length ? unpaid.filter((s) => dto.employeeIds?.includes(s.employeeId)) : unpaid;
      if (!chosen.length) throw new BadRequestException('Nobody chosen is waiting to be paid.');
      const total = sumOf(chosen, (s) => s.net);
      const accounts = await ensurePayrollAccounts(m);
      const entry = (await this.journal.post(
        {
          entryDate: dto.paymentDate,
          businessUnitId: run.businessUnitId,
          description: `Salaries paid — ${run.businessUnit.name}, ${monthLabel(run.month)} (${chosen.length} staff)`,
          reference: `PAY-${run.month}-${run.businessUnit.code}`,
          kind: JournalEntryKind.MONEY_OUT,
          reserveAccountId: dto.reserveAccountId ?? null,
          lines: [
            { accountId: accounts.SALARIES_PAYABLE.id, debit: fromPaisa(total), memo: 'Net pay' },
            { accountId: account.id, credit: fromPaisa(total), memo: null },
          ],
        },
        user,
        { manager: m, source: JournalEntrySource.PAYROLL },
      )) as JournalEntry;
      await m.update(Payslip, { id: In(chosen.map((s) => s.id)) }, { paymentEntryId: entry.id, paidOn: dto.paymentDate });
      const left = await m.count(Payslip, { where: { runId: run.id, paidOn: IsNull() } });
      if (!left) await m.update(PayrollRun, { id: run.id }, { status: PayrollRunStatus.PAID, updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  /** Banner figures. */
  async stats(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const params: unknown[] = [];
    const where = scope ? (params.push(scope.length ? scope : [NIL]), `AND "businessUnitId" = ANY($1)`) : '';
    const [unpaid] = await m.query(`SELECT COALESCE(SUM(net), 0) AS total, COUNT(*) AS count FROM payslips WHERE "paidOn" IS NULL ${where}`, params);
    const [last] = await m.query(
      `SELECT month, SUM(cost) AS cost FROM payslips WHERE 1=1 ${where} GROUP BY month ORDER BY month DESC LIMIT 1`,
      params,
    );
    const advWhere = scope ? `AND a."businessUnitId" = ANY($1)` : '';
    const [adv] = await m.query(
      `SELECT COALESCE(SUM(a.amount - COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r WHERE r."advanceId" = a.id), 0)), 0) AS total,
              COUNT(*) AS count
         FROM salary_advances a WHERE a.status = '${SalaryAdvanceStatus.OUTSTANDING}' ${advWhere}`,
      params,
    );
    const drafts = await m.count(PayrollRun, { where: { status: PayrollRunStatus.DRAFT, ...(scope ? { businessUnitId: In(scope.length ? scope : [NIL]) } : {}) } });
    return {
      unpaidNet: fromPaisa(toPaisa(String(unpaid.total))),
      unpaidCount: Number(unpaid.count),
      lastMonth: last ? { month: last.month as string, cost: fromPaisa(toPaisa(String(last.cost))) } : null,
      advancesOutstanding: fromPaisa(toPaisa(String(adv.total))),
      advancesCount: Number(adv.count),
      draftRuns: drafts,
    };
  }
}

/** An advance is RECOVERED once its recoveries add up to it, and OUTSTANDING again if one is undone. */
export async function refreshAdvanceStatuses(m: EntityManager, advanceIds: string[]): Promise<void> {
  const ids = [...new Set(advanceIds)];
  if (!ids.length) return;
  const advances = await m.find(SalaryAdvance, { where: { id: In(ids) }, relations: { recoveries: true } });
  for (const a of advances) {
    if (a.status === SalaryAdvanceStatus.CANCELLED) continue;
    const recovered = a.recoveries.reduce((s, r) => s + toPaisa(r.amount), 0n);
    const status = recovered >= toPaisa(a.amount) ? SalaryAdvanceStatus.RECOVERED : SalaryAdvanceStatus.OUTSTANDING;
    if (status !== a.status) await m.update(SalaryAdvance, { id: a.id }, { status });
  }
}
