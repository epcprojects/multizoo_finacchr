import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { JournalEntryKind, JournalEntrySource, SalaryAdvanceStatus } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { isEmployedOn, loadEmployee, userNames } from '../hr/hr-common';
import { visibleUnitIds } from '../../../common/scope/unit-scope';
import { SalaryAdvance } from './entities/advance.entity';
import { ensurePayrollAccounts } from './payroll-accounts';
import { payingAccount } from './payroll-common';
import { CreateAdvanceDto, ListAdvancesQueryDto } from './dto/payroll.dto';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * Salary advances (architecture plan Part 07 §04): paid out of a unit's
 * cash, recovered by payroll — in instalments or all at once — or, on
 * exit, by the settlement.
 */
@Injectable()
export class AdvancesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
  ) {}

  async list(query: ListAdvancesQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(SalaryAdvance, 'a')
      .leftJoinAndSelect('a.employee', 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('a.businessUnit', 'bu')
      .leftJoinAndSelect('a.recoveries', 'r')
      .orderBy('a.issueDate', 'DESC')
      .addOrderBy('a.createdAt', 'DESC')
      .take(500);
    if (query.businessUnitId) qb.andWhere('a.businessUnitId = :u', { u: query.businessUnitId });
    if (query.employeeId) qb.andWhere('a.employeeId = :e', { e: query.employeeId });
    if (query.status) qb.andWhere('a.status = :s', { s: query.status });
    if (scope) qb.andWhere('a.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const rows = await qb.getMany();
    const entryIds = rows.map((a) => a.journalEntryId).filter(Boolean) as string[];
    const entries = entryIds.length ? await m.find(JournalEntry, { where: { id: In(entryIds) } }) : [];
    const names = await userNames(m, rows.map((a) => a.createdBy));
    return rows.map((a) => {
      const recovered = a.recoveries.reduce((s, r) => s + toPaisa(r.amount), 0n);
      const entry = entries.find((e) => e.id === a.journalEntryId);
      return {
        id: a.id,
        employee: {
          id: a.employee.id,
          employeeCode: a.employee.employeeCode,
          fullName: a.employee.fullName,
          designation: a.employee.designation?.name ?? null,
        },
        businessUnit: { id: a.businessUnit.id, code: a.businessUnit.code, name: a.businessUnit.name },
        issueDate: a.issueDate,
        amount: a.amount,
        installment: a.installment,
        reason: a.reason,
        status: a.status,
        recovered: fromPaisa(recovered),
        outstanding: a.status === SalaryAdvanceStatus.CANCELLED ? '0.00' : fromPaisa(toPaisa(a.amount) - recovered),
        recoveries: [...a.recoveries]
          .sort((x, y) => x.month.localeCompare(y.month))
          .map((r) => ({ month: r.month, amount: r.amount, source: r.payslipId ? 'PAYROLL' : 'SETTLEMENT' })),
        entry: entry ? { id: entry.id, displayNo: formatEntryNo(entry.entryNo) } : null,
        cancelReason: a.cancelReason,
        createdAt: a.createdAt,
        createdByName: a.createdBy ? names.get(a.createdBy) ?? null : null,
      };
    });
  }

  /** Pays the advance out (Dr Staff Salary Advances, Cr cash / bank) and records it against their pay. */
  async create(dto: CreateAdvanceDto, user: AuthenticatedUser) {
    if (dto.issueDate > businessDate()) throw new BadRequestException('An advance can’t be dated in the future.');
    if (dto.installment && toPaisa(dto.installment) > toPaisa(dto.amount)) {
      throw new BadRequestException('The monthly recovery can’t be more than the advance.');
    }
    const id = await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, dto.employeeId, user);
      if (!isEmployedOn(employee, dto.issueDate)) {
        throw new BadRequestException(`${employee.fullName} isn't employed on ${dto.issueDate}.`);
      }
      const account = await payingAccount(m, dto.accountId, employee.businessUnitId);
      const accounts = await ensurePayrollAccounts(m);
      const amount = fromPaisa(toPaisa(dto.amount));
      const entry = (await this.journal.post(
        {
          entryDate: dto.issueDate,
          businessUnitId: employee.businessUnitId,
          description: `Salary advance — ${employee.fullName} (${employee.employeeCode}): ${dto.reason.trim()}`,
          reference: employee.employeeCode,
          kind: JournalEntryKind.MONEY_OUT,
          reserveAccountId: dto.reserveAccountId ?? null,
          lines: [
            { accountId: accounts.STAFF_ADVANCES.id, debit: amount, memo: employee.fullName },
            { accountId: account.id, credit: amount, memo: null },
          ],
        },
        user,
        { manager: m, source: JournalEntrySource.PAYROLL },
      )) as JournalEntry;
      const advance = await m.save(
        m.create(SalaryAdvance, {
          employeeId: employee.id,
          businessUnitId: employee.businessUnitId,
          issueDate: dto.issueDate,
          amount,
          installment: dto.installment ? fromPaisa(toPaisa(dto.installment)) : null,
          reason: dto.reason.trim(),
          status: SalaryAdvanceStatus.OUTSTANDING,
          journalEntryId: entry.id,
          paidFromAccountId: account.id,
          createdBy: user.id,
        }),
      );
      return advance.id;
    });
    return (await this.list({}, user)).find((a) => a.id === id);
  }

  /** A mistaken advance, before any of it has been recovered: the payment is reversed. */
  async cancel(id: string, reason: string | undefined, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const advance = await m.findOne(SalaryAdvance, { where: { id }, relations: { recoveries: true }, lock: { mode: 'pessimistic_write', tables: ['salary_advances'] } });
      if (!advance) throw new NotFoundException('Advance not found');
      await loadEmployee(m, advance.employeeId, user);
      if (advance.status !== SalaryAdvanceStatus.OUTSTANDING) throw new ConflictException(`This advance is ${advance.status.toLowerCase()}.`);
      if (advance.recoveries.length) {
        throw new ConflictException('Part of this advance has already been recovered by payroll — it can’t be cancelled.');
      }
      if (advance.journalEntryId) {
        await this.journal.reverseWithin(
          m,
          advance.journalEntryId,
          { reason: reason?.trim() || 'Advance cancelled', entryDate: businessDate() },
          user,
          { fromPayroll: true, source: JournalEntrySource.PAYROLL },
        );
      }
      await m.update(SalaryAdvance, { id }, { status: SalaryAdvanceStatus.CANCELLED, cancelReason: reason?.trim() || null, updatedBy: user.id });
    });
    return (await this.list({}, user)).find((a) => a.id === id);
  }
}
