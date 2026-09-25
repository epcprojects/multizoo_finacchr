import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import {
  CounterpartyKind,
  EmployeeStatus,
  JournalEntryKind,
  JournalEntrySource,
  LoanDirection,
  LoanMovementEffect,
  LoanMovementMethod,
  LoanMovementStatus,
  LoanStatus,
  Permission,
  SalaryAdvanceStatus,
  SettlementStatus,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { Partner } from '../allocation/entities/partner.entity';
import { Employee } from '../hr/entities/employee.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { ensurePartnerEquity, ensureReserveOffset } from '../accounts/reserves';
import { OPENING_BALANCE_EQUITY_KEY } from '../accounts/chart-of-accounts';
import { SalaryAdvance } from '../payroll/entities/advance.entity';
import { FinalSettlement } from '../payroll/entities/settlement.entity';
import { ensurePayrollAccounts } from '../payroll/payroll-accounts';
import { refreshAdvanceStatuses } from '../payroll/payroll.service';
import { userNames } from '../hr/hr-common';
import { Counterparty, Loan, LoanMovement } from './entities/loan.entity';
import { headroom, increaseNeedsApproval, loanRunningBalances, summarizeLoan } from './loans-math';
import {
  LOAN_WRITE_OFF_KEY,
  ensureLoanAccount,
  ensurePartnerCounterparties,
  ensureUnitCounterparty,
  ensureWriteOffAccount,
} from './loans-accounts';
import {
  CreateCounterpartyDto,
  CreateLoanDto,
  InterUnitTransferDto,
  ListLoansQueryDto,
  LoanMovementDto,
  ReviewDto,
  UpdateCounterpartyDto,
  UpdateLoanDto,
  WriteOffDto,
} from './dto/loans.dto';

const NIL = '00000000-0000-0000-0000-000000000000';
const E = LoanMovementEffect;
const M = LoanMovementMethod;

export function formatLoanNo(no: number): string {
  return `LN-${String(no).padStart(4, '0')}`;
}

/** Whether value goes to the counterparty (Dr the loan account): lending, or paying back what we owe. */
function toThem(direction: LoanDirection, effect: LoanMovementEffect): boolean {
  return (direction === LoanDirection.RECEIVABLE) === (effect === E.INCREASE);
}

/** "They owe us" is positive: a receivable's balance as is, a payable's negated. */
function position(direction: LoanDirection, balance: bigint): bigint {
  return direction === LoanDirection.RECEIVABLE ? balance : -balance;
}

type MovementForApproval = Pick<LoanMovement, 'effect' | 'method' | 'amount'> & {
  /** Cleared against Loans & Advances Written Off. */
  isWriteOff: boolean;
};

export interface RechargeInput {
  /** The unit that paid and is owed. */
  creditorUnitId: string;
  /** The unit charged its share. */
  debtorUnitId: string;
  amount: string;
  date: string;
  description: string;
  /** The expense the charge moves between the units' P&Ls. */
  expenseAccountId: string;
  utilityBillId: string;
}

/**
 * The loans & counterparty ledger (architecture plan Part 03 §4, Part 06
 * M4, Fig. 5). See docs/module-06-loans-utilities-cost-centres.md.
 */
@Injectable()
export class LoansService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
  ) {}

  // ===========================================================================
  // Counterparties
  // ===========================================================================

  async listCounterparties(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    await ensurePartnerCounterparties(m);
    const rows = await m.find(Counterparty, {
      where: { kind: Not(CounterpartyKind.BUSINESS_UNIT) },
      relations: { partner: true, employee: { businessUnit: true, designation: true } },
      order: { kind: 'ASC', name: 'ASC' },
    });
    const balances = await this.loanBalances(m, user, { counterpartyIds: rows.map((c) => c.id) });
    const advances = await this.advanceTotals(m, user, rows.map((c) => c.employeeId).filter(Boolean) as string[]);
    return rows.map((c) => {
      const mine = balances.filter((b) => b.counterpartyId === c.id);
      const net = mine.reduce((s, b) => s + position(b.direction, b.balance), 0n);
      const adv = c.employeeId ? advances.get(c.employeeId) ?? 0n : 0n;
      return {
        ...this.shapeCounterparty(c),
        loanCount: mine.filter((b) => b.status !== LoanStatus.REJECTED).length,
        /** Positive: they owe us. Negative: we owe them. Staff advances included. */
        net: fromPaisa(net + adv),
        staffAdvances: fromPaisa(adv),
      };
    });
  }

  async createCounterparty(dto: CreateCounterpartyDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      if (dto.kind === CounterpartyKind.EMPLOYEE) {
        const employee = await m.findOne(Employee, { where: { id: dto.employeeId as string } });
        if (!employee) throw new NotFoundException('Employee not found');
        assertUnitAccess(user, employee.businessUnitId);
        const existing = await m.findOne(Counterparty, { where: { employeeId: employee.id } });
        if (existing) throw new ConflictException(`${employee.fullName} is already a counterparty.`);
        const saved = await m.save(
          m.create(Counterparty, {
            name: employee.fullName,
            kind: CounterpartyKind.EMPLOYEE,
            employeeId: employee.id,
            phone: dto.phone?.trim() || null,
            notes: dto.notes?.trim() || null,
            createdBy: user.id,
          }),
        );
        return saved.id;
      }
      const name = (dto.name as string).trim();
      const clash = await m
        .createQueryBuilder(Counterparty, 'c')
        .where('LOWER(c.name) = LOWER(:name)', { name })
        .getOne();
      if (clash) throw new ConflictException(`There's already a counterparty called ${clash.name}.`);
      const saved = await m.save(
        m.create(Counterparty, {
          name,
          kind: dto.kind,
          phone: dto.phone?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return (await this.listCounterparties(user)).find((c) => c.id === id);
  }

  async updateCounterparty(id: string, dto: UpdateCounterpartyDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await m.findOne(Counterparty, { where: { id } });
      if (!c) throw new NotFoundException('Counterparty not found');
      if (dto.name !== undefined) {
        if (c.kind !== CounterpartyKind.PERSON && c.kind !== CounterpartyKind.ORGANISATION) {
          throw new BadRequestException(`${c.name}'s name comes from their own record — change it there.`);
        }
        c.name = dto.name.trim();
      }
      if (dto.phone !== undefined) c.phone = dto.phone?.trim() || null;
      if (dto.notes !== undefined) c.notes = dto.notes?.trim() || null;
      if (dto.isActive !== undefined) c.isActive = dto.isActive;
      c.updatedBy = user.id;
      await m.save(c);
    });
    return (await this.listCounterparties(user)).find((c) => c.id === id);
  }

  /**
   * Everything between the group and one counterparty: each loan, every
   * posted movement in date order, and — for an employee — their salary
   * advances from payroll. The "Loan & payable/receivable statement".
   */
  async counterpartyStatement(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const c = await m.findOne(Counterparty, {
      where: { id },
      relations: { partner: true, businessUnit: true, employee: { businessUnit: true, designation: true } },
    });
    if (!c) throw new NotFoundException('Counterparty not found');
    const scope = visibleUnitIds(user);
    const loans = await m.find(Loan, {
      where: { counterpartyId: c.id, ...(scope ? { businessUnitId: In(scope.length ? scope : [NIL]) } : {}) },
      relations: { businessUnit: true, account: true },
      order: { loanNo: 'ASC' },
    });
    const movements = loans.length
      ? await m.find(LoanMovement, {
          where: { loanId: In(loans.map((l) => l.id)), status: LoanMovementStatus.POSTED },
          order: { movementDate: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const entries = await this.entryNos(m, movements.map((mv) => mv.journalEntryId));
    let net = 0n;
    const rows = movements.map((mv) => {
      const loan = loans.find((l) => l.id === mv.loanId) as Loan;
      const delta = (mv.effect === E.INCREASE ? 1n : -1n) * toPaisa(mv.amount);
      net += position(loan.direction, delta);
      return {
        id: mv.id,
        date: mv.movementDate,
        loan: { id: loan.id, loanNo: formatLoanNo(loan.loanNo), direction: loan.direction, unit: loan.businessUnit.code },
        description: mv.description,
        effect: mv.effect,
        method: mv.method,
        amount: mv.amount,
        /** Running "they owe us" across all their loans. */
        net: fromPaisa(net),
        entry: entries.get(mv.journalEntryId ?? '') ?? null,
      };
    });
    const advances = c.employeeId
      ? await m.find(SalaryAdvance, {
          where: { employeeId: c.employeeId },
          relations: { recoveries: true, businessUnit: true },
          order: { issueDate: 'ASC' },
        })
      : [];
    const advanceRows = advances.map((a) => this.shapeAdvanceBrief(a));
    const advanceOutstanding = advanceRows.reduce((s, a) => s + toPaisa(a.outstanding), 0n);
    return {
      counterparty: this.shapeCounterparty(c),
      loans: loans.map((l) => {
        const own = movements.filter((mv) => mv.loanId === l.id);
        const sum = summarizeLoan(own);
        return {
          id: l.id,
          loanNo: formatLoanNo(l.loanNo),
          businessUnit: { id: l.businessUnit.id, code: l.businessUnit.code, name: l.businessUnit.name },
          direction: l.direction,
          purpose: l.purpose,
          status: l.status,
          limit: l.limit,
          ...sum,
          account: l.account ? { id: l.account.id, code: l.account.code, name: l.account.name } : null,
        };
      }),
      movements: rows,
      staffAdvances: advanceRows,
      totals: {
        loansNet: fromPaisa(net),
        staffAdvances: fromPaisa(advanceOutstanding),
        net: fromPaisa(net + advanceOutstanding),
      },
    };
  }

  // ===========================================================================
  // Loans
  // ===========================================================================

  async stats(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const balances = await this.loanBalances(m, user, {});
    let owedToUs = 0n;
    let weOwe = 0n;
    let interUnit = 0n;
    for (const b of balances) {
      if (b.status === LoanStatus.REJECTED) continue;
      const pos = position(b.direction, b.balance);
      if (b.interUnit) {
        // Each pair once: its receivable side.
        if (b.direction === LoanDirection.RECEIVABLE) interUnit += pos < 0n ? -pos : pos;
        continue;
      }
      if (pos > 0n) owedToUs += pos;
      else weOwe -= pos;
    }
    const approvals = await this.approvals(user);
    const advances = await this.advanceTotals(m, user, null);
    const staff = [...advances.values()].reduce((a, b) => a + b, 0n);
    return {
      owedToUs: fromPaisa(owedToUs),
      weOwe: fromPaisa(weOwe),
      interUnitOpen: fromPaisa(interUnit),
      staffAdvances: fromPaisa(staff),
      pendingApprovals: approvals.loans.length + approvals.movements.length,
    };
  }

  async list(query: ListLoansQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(Loan, 'l')
      .leftJoinAndSelect('l.counterparty', 'c')
      .leftJoinAndSelect('l.businessUnit', 'bu')
      .leftJoinAndSelect('l.account', 'a')
      .orderBy('l.loanNo', 'DESC');
    if (scope) qb.andWhere('l.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    if (query.businessUnitId) qb.andWhere('l.businessUnitId = :u', { u: query.businessUnitId });
    if (query.counterpartyId) qb.andWhere('l.counterpartyId = :c', { c: query.counterpartyId });
    if (query.status) qb.andWhere('l.status = :s', { s: query.status });
    if (query.interUnit === 'true') qb.andWhere('l.mirrorLoanId IS NOT NULL');
    if (query.interUnit === 'false') qb.andWhere('l.mirrorLoanId IS NULL');
    const loans = await qb.getMany();
    const sums = await this.movementSums(m, loans.map((l) => l.id));
    return loans.map((l) => this.shapeLoan(l, sums.get(l.id)));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const loan = await m.findOne(Loan, { where: { id }, relations: { counterparty: true, businessUnit: true, account: true } });
    if (!loan) throw new NotFoundException('Loan not found');
    assertUnitAccess(user, loan.businessUnitId);
    const movements = await m.find(LoanMovement, {
      where: { loanId: loan.id },
      relations: { otherAccount: true },
      order: { movementDate: 'ASC', createdAt: 'ASC' },
    });
    const posted = movements.filter((mv) => mv.status === LoanMovementStatus.POSTED);
    const balances = loanRunningBalances(posted);
    const entries = await this.entryNos(m, movements.flatMap((mv) => [mv.journalEntryId, mv.reversalEntryId]));
    const names = await userNames(m, [...movements.flatMap((mv) => [mv.createdBy, mv.reviewedBy]), loan.createdBy, loan.reviewedBy]);
    const mirror = loan.mirrorLoanId
      ? await m.findOne(Loan, { where: { id: loan.mirrorLoanId }, relations: { businessUnit: true } })
      : null;
    const summary = summarizeLoan(posted);
    return {
      ...this.shapeLoan(loan, { ...summary, pending: movements.filter((mv) => mv.status === LoanMovementStatus.PENDING_APPROVAL).length }),
      createdBy: loan.createdBy,
      createdByName: loan.createdBy ? names.get(loan.createdBy) ?? null : null,
      reviewedByName: loan.reviewedBy ? names.get(loan.reviewedBy) ?? null : null,
      reviewNote: loan.reviewNote,
      reviewedAt: loan.reviewedAt,
      mirror: mirror
        ? { id: mirror.id, loanNo: formatLoanNo(mirror.loanNo), businessUnit: { id: mirror.businessUnit.id, code: mirror.businessUnit.code, name: mirror.businessUnit.name } }
        : null,
      movements: movements.map((mv) => ({
        id: mv.id,
        movementDate: mv.movementDate,
        effect: mv.effect,
        method: mv.method,
        amount: mv.amount,
        description: mv.description,
        otherAccount: { id: mv.otherAccount.id, code: mv.otherAccount.code, name: mv.otherAccount.name },
        status: mv.status,
        balance: mv.status === LoanMovementStatus.POSTED ? balances[posted.indexOf(mv)] : null,
        entry: entries.get(mv.journalEntryId ?? '') ?? null,
        reversalEntry: entries.get(mv.reversalEntryId ?? '') ?? null,
        fromUtilityBill: mv.utilityBillId,
        isInterUnit: Boolean(mv.mirrorMovementId),
        createdByName: mv.createdBy ? names.get(mv.createdBy) ?? null : null,
        createdAt: mv.createdAt,
        reviewedByName: mv.reviewedBy ? names.get(mv.reviewedBy) ?? null : null,
        reviewNote: mv.reviewNote,
      })),
    };
  }

  /**
   * Opens a loan. A Partner's loan is approved as they make it; anyone
   * else's waits for a Partner, with its first movement.
   */
  async create(dto: CreateLoanDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const counterparty = await m.findOne(Counterparty, { where: { id: dto.counterpartyId } });
      if (!counterparty || !counterparty.isActive) throw new BadRequestException('Choose an active counterparty.');
      if (counterparty.kind === CounterpartyKind.BUSINESS_UNIT) {
        throw new BadRequestException('Money between units is an inter-unit transfer — use Loans → Inter-unit.');
      }
      const unit = await this.activeUnit(m, dto.businessUnitId, user);
      const approver = this.canApprove(user);
      const loan = await m.save(
        m.create(Loan, {
          counterpartyId: counterparty.id,
          businessUnitId: unit.id,
          direction: dto.direction,
          purpose: dto.purpose.trim(),
          limit: dto.limit ? fromPaisa(toPaisa(dto.limit)) : null,
          status: approver ? LoanStatus.ACTIVE : LoanStatus.PENDING_APPROVAL,
          reviewedBy: approver ? user.id : null,
          reviewedAt: approver ? new Date() : null,
          createdBy: user.id,
        }),
      );
      loan.counterparty = counterparty;
      loan.businessUnit = unit;
      if (approver) await ensureLoanAccount(m, loan, counterparty, unit, user.id);
      if (dto.opening) {
        const data = await this.prepareMovement(m, loan, dto.opening);
        const mv = await m.save(m.create(LoanMovement, { ...data, loanId: loan.id, status: LoanMovementStatus.PENDING_APPROVAL, createdBy: user.id }));
        if (approver) await this.postMovement(m, loan, mv, user);
      }
      return loan.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateLoanDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, id, user);
      if (dto.purpose !== undefined) loan.purpose = dto.purpose.trim();
      if (dto.limit !== undefined) {
        const limit = dto.limit ? fromPaisa(toPaisa(dto.limit)) : null;
        if (limit !== loan.limit) {
          // Before approval the one asking can still change what they ask for.
          const ownPending = loan.status === LoanStatus.PENDING_APPROVAL && loan.createdBy === user.id;
          if (!this.canApprove(user) && !ownPending) {
            throw new ForbiddenException('Only a Partner can change an approved loan’s ceiling.');
          }
          loan.limit = limit;
        }
      }
      loan.updatedBy = user.id;
      await m.save(loan);
    });
    return this.findOne(id, user);
  }

  async approveLoan(id: string, dto: ReviewDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, id, user);
      if (loan.status !== LoanStatus.PENDING_APPROVAL) throw new ConflictException('This loan isn’t waiting for approval.');
      await m.update(Loan, loan.id, { status: LoanStatus.ACTIVE, reviewedBy: user.id, reviewedAt: new Date(), reviewNote: dto.note?.trim() || null });
      loan.status = LoanStatus.ACTIVE;
      await ensureLoanAccount(m, loan, loan.counterparty, loan.businessUnit, user.id);
      const pending = await m.find(LoanMovement, {
        where: { loanId: loan.id, status: LoanMovementStatus.PENDING_APPROVAL },
        order: { movementDate: 'ASC', createdAt: 'ASC' },
      });
      for (const mv of pending) await this.postMovement(m, loan, mv, user, { reviewer: user.id });
    });
    return this.findOne(id, user);
  }

  async rejectLoan(id: string, dto: ReviewDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, id, user);
      if (loan.status !== LoanStatus.PENDING_APPROVAL) throw new ConflictException('This loan isn’t waiting for approval.');
      const note = dto.note?.trim() || null;
      await m.update(Loan, loan.id, { status: LoanStatus.REJECTED, reviewedBy: user.id, reviewedAt: new Date(), reviewNote: note });
      await m.update(
        LoanMovement,
        { loanId: loan.id, status: LoanMovementStatus.PENDING_APPROVAL },
        { status: LoanMovementStatus.REJECTED, reviewedBy: user.id, reviewedAt: new Date(), reviewNote: note },
      );
    });
    return this.findOne(id, user);
  }

  async close(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, id, user);
      if (loan.status !== LoanStatus.ACTIVE) throw new ConflictException('Only an active loan can be closed.');
      if (loan.mirrorLoanId) throw new BadRequestException('An inter-unit account stays open.');
      const sums = (await this.movementSums(m, [loan.id])).get(loan.id);
      if (sums && toPaisa(sums.outstanding) !== 0n) {
        throw new ConflictException(`Rs ${sums.outstanding} is still outstanding — settle or write it off first.`);
      }
      if (sums?.pending) throw new ConflictException('A movement is waiting for approval — approve or withdraw it first.');
      await m.update(Loan, loan.id, { status: LoanStatus.CLOSED, closedAt: new Date(), updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  async reopen(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, id, user);
      if (loan.status !== LoanStatus.CLOSED) throw new ConflictException('This loan isn’t closed.');
      await m.update(Loan, loan.id, { status: LoanStatus.ACTIVE, closedAt: null, updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  // ===========================================================================
  // Movements
  // ===========================================================================

  /**
   * Records a movement. It posts straight away when it's a cash repayment,
   * an advance within the approved ceiling, or entered by a Partner;
   * otherwise it waits for a Partner.
   */
  async addMovement(loanId: string, dto: LoanMovementDto, user: AuthenticatedUser) {
    const status = await this.dataSource.transaction(async (m) => {
      const loan = await this.lockLoan(m, loanId, user);
      if (loan.mirrorLoanId) throw new BadRequestException('Move money between units with an inter-unit transfer.');
      if (loan.status === LoanStatus.PENDING_APPROVAL) throw new ConflictException('This loan is waiting for a Partner’s approval.');
      if (loan.status !== LoanStatus.ACTIVE) throw new ConflictException(`This loan is ${loan.status.toLowerCase()} — reopen it first.`);
      const data = await this.prepareMovement(m, loan, dto);
      const mv = await m.save(m.create(LoanMovement, { ...data, loanId: loan.id, status: LoanMovementStatus.PENDING_APPROVAL, createdBy: user.id }));
      const outstanding = (await this.movementSums(m, [loan.id])).get(loan.id)?.outstanding ?? '0.00';
      const isWriteOff = (await m.findOne(Account, { where: { id: mv.otherAccountId } }))?.systemKey === LOAN_WRITE_OFF_KEY;
      if (this.canApprove(user) || !this.needsApproval(loan, { ...mv, isWriteOff }, outstanding)) {
        await this.postMovement(m, loan, mv, user);
        return LoanMovementStatus.POSTED;
      }
      return LoanMovementStatus.PENDING_APPROVAL;
    });
    return { status, loan: await this.findOne(loanId, user) };
  }

  async approveMovement(id: string, dto: ReviewDto, user: AuthenticatedUser) {
    const loanId = await this.dataSource.transaction(async (m) => {
      const { mv, loan, mirror } = await this.lockMovement(m, id, user);
      if (mv.status !== LoanMovementStatus.PENDING_APPROVAL) throw new ConflictException('This movement isn’t waiting for approval.');
      if (loan.status !== LoanStatus.ACTIVE) throw new ConflictException('Approve the loan itself first — its movements post with it.');
      const note = dto.note?.trim() || null;
      await this.postMovement(m, loan, mv, user, { reviewer: user.id, note });
      if (mirror) await this.postMovement(m, mirror.loan, mirror.mv, user, { reviewer: user.id, note });
      return loan.id;
    });
    return this.findOne(loanId, user);
  }

  async rejectMovement(id: string, dto: ReviewDto, user: AuthenticatedUser) {
    return this.closePending(id, user, dto.note?.trim() || null, false);
  }

  /** The person who asked (or a Partner) takes back a movement still waiting. */
  async withdrawMovement(id: string, user: AuthenticatedUser) {
    return this.closePending(id, user, 'Withdrawn', true);
  }

  private async closePending(id: string, user: AuthenticatedUser, note: string | null, withdraw: boolean) {
    const loanId = await this.dataSource.transaction(async (m) => {
      const { mv, loan, mirror } = await this.lockMovement(m, id, user);
      if (mv.status !== LoanMovementStatus.PENDING_APPROVAL) throw new ConflictException('This movement isn’t waiting for approval.');
      if (withdraw && mv.createdBy !== user.id && !this.canApprove(user)) {
        throw new ForbiddenException('Only the person who asked for it can withdraw this.');
      }
      const ids = [mv.id, ...(mirror ? [mirror.mv.id] : [])];
      await m.update(LoanMovement, { id: In(ids) }, { status: LoanMovementStatus.REJECTED, reviewedBy: user.id, reviewedAt: new Date(), reviewNote: note });
      return loan.id;
    });
    return this.findOne(loanId, user);
  }

  /** Undoes a posted movement with a reversing entry (both units' halves of an inter-unit one). */
  async reverseMovement(id: string, dto: ReviewDto, user: AuthenticatedUser) {
    const loanId = await this.dataSource.transaction(async (m) => {
      const { mv, loan, mirror } = await this.lockMovement(m, id, user);
      if (mv.status !== LoanMovementStatus.POSTED) throw new ConflictException('Only a posted movement can be reversed.');
      if (mv.utilityBillId) throw new BadRequestException('This is a utility recharge — unpost the bill from the Utilities screen.');
      if (loan.status === LoanStatus.CLOSED) throw new ConflictException('Reopen the loan first.');
      for (const x of [mv, ...(mirror ? [mirror.mv] : [])]) await this.reverseOne(m, x, user, dto.note);
      return loan.id;
    });
    return this.findOne(loanId, user);
  }

  /** Everything waiting for a Partner. */
  async approvals(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const unitWhere = scope ? { businessUnitId: In(scope.length ? scope : [NIL]) } : {};
    const loans = await m.find(Loan, {
      where: { status: LoanStatus.PENDING_APPROVAL, ...unitWhere },
      relations: { counterparty: true, businessUnit: true, movements: true },
      order: { createdAt: 'ASC' },
    });
    const movements = await m.find(LoanMovement, {
      where: { status: LoanMovementStatus.PENDING_APPROVAL, loan: { status: LoanStatus.ACTIVE, ...unitWhere } },
      relations: { loan: { counterparty: true, businessUnit: true }, otherAccount: true },
      order: { createdAt: 'ASC' },
    });
    // An inter-unit transfer is one approval: show the paying unit's half.
    const mirrors = await m.find(LoanMovement, {
      where: { id: In(movements.map((mv) => mv.mirrorMovementId).filter(Boolean) as string[]) },
      relations: { loan: { businessUnit: true } },
    });
    const shown = movements.filter((mv) => {
      if (!mv.mirrorMovementId) return true;
      return toThem(mv.loan.direction, mv.effect);
    });
    const names = await userNames(m, [...loans.map((l) => l.createdBy), ...shown.map((mv) => mv.createdBy)]);
    const sums = await this.movementSums(m, shown.map((mv) => mv.loanId));
    return {
      loans: loans.map((l) => ({
        ...this.shapeLoan(l, undefined),
        opening: l.movements
          .filter((mv) => mv.status === LoanMovementStatus.PENDING_APPROVAL)
          .map((mv) => ({ movementDate: mv.movementDate, effect: mv.effect, method: mv.method, amount: mv.amount, description: mv.description })),
        createdByName: l.createdBy ? names.get(l.createdBy) ?? null : null,
      })),
      movements: shown.map((mv) => {
        const mirror = mirrors.find((x) => x.id === mv.mirrorMovementId);
        return {
          id: mv.id,
          loan: this.shapeLoan(mv.loan, sums.get(mv.loanId)),
          movementDate: mv.movementDate,
          effect: mv.effect,
          method: mv.method,
          amount: mv.amount,
          description: mv.description,
          otherAccount: { id: mv.otherAccount.id, code: mv.otherAccount.code, name: mv.otherAccount.name },
          interUnit: mirror
            ? { from: mv.loan.businessUnit.name, to: mirror.loan.businessUnit.name }
            : null,
          reason:
            this.approvalReason(
              mv.loan,
              { ...mv, isWriteOff: mv.otherAccount.systemKey === LOAN_WRITE_OFF_KEY },
              sums.get(mv.loanId)?.outstanding ?? '0.00',
            ) ??
            'Asked for before the ceiling was raised — it’s within it now.',
          createdByName: mv.createdBy ? names.get(mv.createdBy) ?? null : null,
          createdAt: mv.createdAt,
        };
      }),
    };
  }

  // ===========================================================================
  // Inter-unit
  // ===========================================================================

  /** Every pair of units with a current account between them: who owes whom. */
  async interUnit(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const loans = await m.find(Loan, {
      where: { mirrorLoanId: Not(IsNull()), direction: LoanDirection.RECEIVABLE },
      relations: { businessUnit: true, counterparty: { businessUnit: true } },
      order: { loanNo: 'ASC' },
    });
    const scope = visibleUnitIds(user);
    const visible = loans.filter(
      (l) => !scope || scope.includes(l.businessUnitId) || scope.includes(l.counterparty.businessUnitId as string),
    );
    const sums = await this.movementSums(m, visible.map((l) => l.id));
    return visible.map((l) => {
      const s = sums.get(l.id);
      const balance = toPaisa(s?.outstanding ?? '0');
      const a = l.businessUnit;
      const b = l.counterparty.businessUnit as BusinessUnit;
      const owes = balance >= 0n ? { debtor: b, creditor: a } : { debtor: a, creditor: b };
      return {
        id: l.id,
        mirrorLoanId: l.mirrorLoanId,
        units: [this.unitRef(a), this.unitRef(b)],
        balance: fromPaisa(balance < 0n ? -balance : balance),
        debtor: balance === 0n ? null : this.unitRef(owes.debtor),
        creditor: balance === 0n ? null : this.unitRef(owes.creditor),
        // Each transfer has a half in both units' books — count it once.
        pending: s?.pending ?? 0,
      };
    });
  }

  /**
   * Money from one unit's cash to another's (roles table: inter-unit
   * transfers need a Partner). Both halves are recorded together and post
   * together: the payer's "Due from", the receiver's "Due to".
   */
  async transfer(dto: InterUnitTransferDto, user: AuthenticatedUser) {
    if (dto.fromUnitId === dto.toUnitId) throw new BadRequestException('Choose two different units.');
    const result = await this.dataSource.transaction(async (m) => {
      const from = await this.activeUnit(m, dto.fromUnitId, user);
      const to = await this.activeUnit(m, dto.toUnitId, user);
      const pair = await this.ensurePair(m, from, to, user);
      const fromSide = pair.get(from.id) as Loan;
      const toSide = pair.get(to.id) as Loan;
      const base = { movementDate: dto.transferDate, method: M.CASH, amount: dto.amount, description: dto.description.trim() };
      const outData = await this.prepareMovement(m, fromSide, {
        ...base,
        effect: fromSide.direction === LoanDirection.RECEIVABLE ? E.INCREASE : E.DECREASE,
        otherAccountId: dto.fromAccountId,
        reserveAccountId: dto.reserveAccountId,
      });
      const inData = await this.prepareMovement(m, toSide, {
        ...base,
        effect: toSide.direction === LoanDirection.PAYABLE ? E.INCREASE : E.DECREASE,
        otherAccountId: dto.toAccountId,
      });
      const out = await m.save(m.create(LoanMovement, { ...outData, loanId: fromSide.id, status: LoanMovementStatus.PENDING_APPROVAL, createdBy: user.id }));
      const inn = await m.save(m.create(LoanMovement, { ...inData, loanId: toSide.id, status: LoanMovementStatus.PENDING_APPROVAL, mirrorMovementId: out.id, createdBy: user.id }));
      await m.update(LoanMovement, out.id, { mirrorMovementId: inn.id });
      out.mirrorMovementId = inn.id;
      if (this.canApprove(user)) {
        await this.postMovement(m, fromSide, out, user);
        await this.postMovement(m, toSide, inn, user);
        return { status: LoanMovementStatus.POSTED, loanId: fromSide.id };
      }
      return { status: LoanMovementStatus.PENDING_APPROVAL, loanId: fromSide.id };
    });
    return { status: result.status, loan: await this.findOne(result.loanId, user) };
  }

  /**
   * A utility bill's charge to another unit (Module 6 utilities): the unit
   * that paid is owed, the other bears the cost. Posted at once, as part
   * of posting the bill — the allocation itself is what was reviewed.
   */
  async postRecharge(m: EntityManager, input: RechargeInput, user: AuthenticatedUser): Promise<void> {
    const creditor = await this.activeUnit(m, input.creditorUnitId, user);
    const debtor = await this.activeUnit(m, input.debtorUnitId, user);
    const pair = await this.ensurePair(m, creditor, debtor, user);
    const cSide = pair.get(creditor.id) as Loan;
    const dSide = pair.get(debtor.id) as Loan;
    const base = {
      movementDate: input.date,
      method: M.ON_ACCOUNT,
      amount: input.amount,
      description: input.description,
      otherAccountId: input.expenseAccountId,
    };
    const cData = await this.prepareMovement(m, cSide, { ...base, effect: cSide.direction === LoanDirection.RECEIVABLE ? E.INCREASE : E.DECREASE });
    const dData = await this.prepareMovement(m, dSide, { ...base, effect: dSide.direction === LoanDirection.PAYABLE ? E.INCREASE : E.DECREASE });
    const c = await m.save(m.create(LoanMovement, { ...cData, loanId: cSide.id, utilityBillId: input.utilityBillId, createdBy: user.id }));
    const d = await m.save(m.create(LoanMovement, { ...dData, loanId: dSide.id, utilityBillId: input.utilityBillId, mirrorMovementId: c.id, createdBy: user.id }));
    await m.update(LoanMovement, c.id, { mirrorMovementId: d.id });
    await this.postMovement(m, cSide, c, user, { source: JournalEntrySource.UTILITIES });
    await this.postMovement(m, dSide, d, user, { source: JournalEntrySource.UTILITIES });
  }

  /** Unposting a bill: its recharges are reversed. */
  async reverseRecharges(m: EntityManager, utilityBillId: string, user: AuthenticatedUser, reason: string): Promise<void> {
    const movements = await m.find(LoanMovement, { where: { utilityBillId, status: LoanMovementStatus.POSTED } });
    for (const mv of movements) await this.reverseOne(m, mv, user, reason, true);
  }

  // ===========================================================================
  // Staff advances — Module 5's records, on the counterparty ledger
  // ===========================================================================

  async staffAdvances(user: AuthenticatedUser, status?: SalaryAdvanceStatus) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const advances = await m.find(SalaryAdvance, {
      where: {
        ...(status ? { status } : { status: In([SalaryAdvanceStatus.OUTSTANDING, SalaryAdvanceStatus.WRITTEN_OFF]) }),
        ...(scope ? { businessUnitId: In(scope.length ? scope : [NIL]) } : {}),
      },
      relations: { employee: { designation: true }, businessUnit: true, recoveries: true },
      order: { issueDate: 'ASC' },
    });
    const employeeIds = [...new Set(advances.map((a) => a.employeeId))];
    const settlements = employeeIds.length ? await m.find(FinalSettlement, { where: { employeeId: In(employeeIds) } }) : [];
    const counterparties = employeeIds.length ? await m.find(Counterparty, { where: { employeeId: In(employeeIds) } }) : [];
    const entries = await this.entryNos(m, advances.map((a) => a.writeOffEntryId));
    return advances.map((a) => {
      const brief = this.shapeAdvanceBrief(a);
      const settlement = settlements.find((s) => s.employeeId === a.employeeId) ?? null;
      const exited = a.employee.status === EmployeeStatus.EXITED;
      return {
        ...brief,
        employee: {
          id: a.employee.id,
          employeeCode: a.employee.employeeCode,
          fullName: a.employee.fullName,
          designation: a.employee.designation?.name ?? null,
          status: a.employee.status,
          exitDate: a.employee.exitDate,
        },
        counterpartyId: counterparties.find((c) => c.employeeId === a.employeeId)?.id ?? null,
        settlement: settlement ? { id: settlement.id, status: settlement.status } : null,
        /** A leaver's settlement is paid and this is still left: only a write-off clears it. */
        canWriteOff:
          a.status === SalaryAdvanceStatus.OUTSTANDING &&
          exited &&
          settlement?.status === SettlementStatus.PAID &&
          toPaisa(brief.outstanding) > 0n,
        writeOffEntry: entries.get(a.writeOffEntryId ?? '') ?? null,
      };
    });
  }

  /**
   * Writes off what a leaver's paid settlement couldn't recover
   * (Module 5 deferred this here): Dr Loans & Advances Written Off /
   * Cr Staff Salary Advances. A Partner's decision.
   */
  async writeOffAdvance(id: string, dto: WriteOffDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const advance = await m.findOne(SalaryAdvance, {
        where: { id },
        relations: { recoveries: true, employee: true },
        lock: { mode: 'pessimistic_write', tables: ['salary_advances'] },
      });
      if (!advance) throw new NotFoundException('Advance not found');
      assertUnitAccess(user, advance.businessUnitId);
      if (advance.status !== SalaryAdvanceStatus.OUTSTANDING) throw new ConflictException(`This advance is ${advance.status.toLowerCase().replace('_', ' ')}.`);
      if (advance.employee.status !== EmployeeStatus.EXITED) {
        throw new BadRequestException(`${advance.employee.fullName} still works here — payroll recovers the advance.`);
      }
      const settlement = await m.findOne(FinalSettlement, { where: { employeeId: advance.employeeId } });
      if (settlement?.status !== SettlementStatus.PAID) {
        throw new BadRequestException('Pay their full & final settlement first — it recovers what it can before anything is written off.');
      }
      const recovered = advance.recoveries.reduce((s, r) => s + toPaisa(r.amount), 0n);
      const left = toPaisa(advance.amount) - recovered;
      if (left <= 0n) throw new ConflictException('Nothing is left to write off.');
      const accounts = await ensurePayrollAccounts(m);
      const writeOff = await ensureWriteOffAccount(m);
      const amount = fromPaisa(left);
      const entry = (await this.journal.post(
        {
          entryDate: businessDate(),
          businessUnitId: advance.businessUnitId,
          description: `Advance written off — ${advance.employee.fullName} (${advance.employee.employeeCode}): ${dto.reason.trim()}`,
          reference: advance.employee.employeeCode,
          kind: JournalEntryKind.LOAN,
          lines: [
            { accountId: writeOff.id, debit: amount, memo: advance.employee.fullName },
            { accountId: accounts.STAFF_ADVANCES.id, credit: amount, memo: `Advance of ${advance.issueDate}` },
          ],
        },
        user,
        { manager: m, source: JournalEntrySource.LOANS },
      )) as JournalEntry;
      await m.update(SalaryAdvance, advance.id, {
        status: SalaryAdvanceStatus.WRITTEN_OFF,
        writtenOff: amount,
        writeOffEntryId: entry.id,
        writeOffReason: dto.reason.trim(),
        updatedBy: user.id,
      });
    });
    return (await this.staffAdvances(user)).find((a) => a.id === id) ?? null;
  }

  async undoWriteOff(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const advance = await m.findOne(SalaryAdvance, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!advance) throw new NotFoundException('Advance not found');
      assertUnitAccess(user, advance.businessUnitId);
      if (advance.status !== SalaryAdvanceStatus.WRITTEN_OFF) throw new ConflictException('This advance hasn’t been written off.');
      if (advance.writeOffEntryId) {
        await this.journal.reverseWithin(
          m,
          advance.writeOffEntryId,
          { reason: 'Write-off undone', entryDate: businessDate() },
          user,
          { fromLoans: true, source: JournalEntrySource.LOANS },
        );
      }
      await m.update(SalaryAdvance, advance.id, {
        status: SalaryAdvanceStatus.OUTSTANDING,
        writtenOff: null,
        writeOffEntryId: null,
        writeOffReason: null,
        updatedBy: user.id,
      });
      await refreshAdvanceStatuses(m, [advance.id]);
    });
    return (await this.staffAdvances(user)).find((a) => a.id === id) ?? null;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private canApprove(user: AuthenticatedUser): boolean {
    return hasPermission(user, Permission.LOANS_APPROVE);
  }

  /**
   * Paying down never waits — cash coming back, or an officer spending the
   * float they hold on the company's bills. An advance within the approved
   * ceiling doesn't either. Everything else — past the ceiling, a write-off,
   * a set-off against profit, any inter-unit transfer — is a Partner's call.
   */
  private needsApproval(loan: Loan, mv: MovementForApproval, outstanding: string): boolean {
    return this.approvalReason(loan, mv, outstanding) !== null;
  }

  private approvalReason(loan: Loan, mv: MovementForApproval, outstanding: string): string | null {
    if (loan.mirrorLoanId) return 'Inter-unit transfers need a Partner.';
    if (mv.method === M.PROFIT_SETOFF) return 'Setting a loan off against profit needs a Partner.';
    if (mv.effect === E.DECREASE) {
      if (mv.method === M.CASH) return null;
      if (mv.method === M.ON_ACCOUNT && !mv.isWriteOff) return null;
      return mv.isWriteOff ? 'A write-off needs a Partner.' : 'Clearing a loan against an opening balance needs a Partner.';
    }
    if (!increaseNeedsApproval(outstanding, mv.amount, loan.limit)) return null;
    return loan.limit == null
      ? 'This loan has no approved ceiling, so each advance needs a Partner.'
      : `Past the approved ceiling of Rs ${loan.limit} (outstanding Rs ${outstanding}).`;
  }

  /** Checks a movement against its loan and resolves the account on the other side. */
  private async prepareMovement(m: EntityManager, loan: Loan, dto: LoanMovementDto) {
    if (!isIsoDate(dto.movementDate)) throw new BadRequestException('Enter a real date.');
    if (dto.movementDate > businessDate()) throw new BadRequestException('A movement can’t be dated in the future.');
    const amount = fromPaisa(toPaisa(dto.amount));
    if (toPaisa(amount) <= 0n) throw new BadRequestException('Enter an amount above zero.');
    const out = toThem(loan.direction, dto.effect);
    const counterparty = loan.counterparty ?? (await m.findOneOrFail(Counterparty, { where: { id: loan.counterpartyId } }));
    let other: Account;

    switch (dto.method) {
      case M.CASH: {
        other = await this.loadAccount(m, dto.otherAccountId);
        if (!other.accountClass.isLiquid) throw new BadRequestException('Choose a cash, bank or wallet account.');
        if (other.businessUnitId !== loan.businessUnitId) throw new BadRequestException(`${other.name} isn’t one of this unit’s accounts.`);
        break;
      }
      case M.ON_ACCOUNT: {
        other = await this.loadAccount(m, dto.otherAccountId);
        if (other.accountClass.isLiquid) throw new BadRequestException('That’s a cash account — record it as cash.');
        if (other.accountClass.isReserve) throw new BadRequestException('Reserves are earmarks, not something a loan is paid with.');
        if (other.loanId) throw new BadRequestException('Choose an expense, asset or income account — not another loan.');
        if (other.partnerId) throw new BadRequestException('To use a partner’s profit, choose “Set off against profit”.');
        if (other.systemKey === OPENING_BALANCE_EQUITY_KEY) throw new BadRequestException('Use “Opening balance” for balances brought in.');
        if (other.businessUnitId && other.businessUnitId !== loan.businessUnitId) {
          throw new BadRequestException(`${other.name} belongs to another unit.`);
        }
        break;
      }
      case M.PROFIT_SETOFF: {
        if (counterparty.kind !== CounterpartyKind.PARTNER || !counterparty.partnerId) {
          throw new BadRequestException('Only a partner’s loan can be set off against their profit.');
        }
        // Only ways that take from their profit: repaying what they owe us, or leaving profit with us as a loan.
        if (out) {
          throw new BadRequestException(
            loan.direction === LoanDirection.RECEIVABLE
              ? 'Setting off can only reduce what a partner owes.'
              : 'Setting off can only turn their profit into a loan to us.',
          );
        }
        const partner = await m.findOneOrFail(Partner, { where: { id: counterparty.partnerId } });
        other = await ensurePartnerEquity(m, partner);
        break;
      }
      case M.OPENING: {
        const obe = await m.findOne(Account, { where: { systemKey: OPENING_BALANCE_EQUITY_KEY } });
        if (!obe) throw new BadRequestException('Opening Balance Equity is missing — run the seed.');
        other = obe;
        break;
      }
      default:
        throw new BadRequestException('Unknown movement type.');
    }

    let reserveAccountId: string | null = null;
    if (dto.reserveAccountId) {
      if (dto.method !== M.CASH || !out) throw new BadRequestException('Only cash going out can be paid out of a reserve.');
      reserveAccountId = dto.reserveAccountId;
    }
    return {
      movementDate: dto.movementDate,
      effect: dto.effect,
      method: dto.method,
      amount,
      description: dto.description.trim(),
      otherAccountId: other.id,
      reserveAccountId,
    };
  }

  /** Posts a movement as its own entry, source LOANS (or UTILITIES for a recharge). */
  private async postMovement(
    m: EntityManager,
    loan: Loan,
    mv: LoanMovement,
    user: AuthenticatedUser,
    opts: { reviewer?: string; note?: string | null; source?: JournalEntrySource } = {},
  ): Promise<void> {
    const counterparty = loan.counterparty ?? (await m.findOneOrFail(Counterparty, { where: { id: loan.counterpartyId } }));
    const unit = loan.businessUnit ?? (await m.findOneOrFail(BusinessUnit, { where: { id: loan.businessUnitId } }));
    const account = await ensureLoanAccount(m, loan, counterparty, unit, user.id);
    const out = toThem(loan.direction, mv.effect);
    const lines: { accountId: string; debit?: string; credit?: string; memo?: string | null }[] = out
      ? [
          { accountId: account.id, debit: mv.amount, memo: counterparty.name },
          { accountId: mv.otherAccountId, credit: mv.amount, memo: null },
        ]
      : [
          { accountId: mv.otherAccountId, debit: mv.amount, memo: null },
          { accountId: account.id, credit: mv.amount, memo: counterparty.name },
        ];
    let allowReserve = false;
    if (mv.method === M.PROFIT_SETOFF) {
      // As with a drawing, the partner's profit reserve in the unit is released: that profit is spent.
      const reserve = await m.findOne(Account, {
        where: { businessUnitId: loan.businessUnitId, partnerId: counterparty.partnerId as string },
      });
      if (reserve?.isActive) {
        const offset = await ensureReserveOffset(m, unit, user.id);
        lines.push(
          { accountId: offset.id, debit: mv.amount, memo: `Set off against ${counterparty.name}'s profit` },
          { accountId: reserve.id, credit: mv.amount, memo: `Set off against ${counterparty.name}'s profit` },
        );
        allowReserve = true;
      }
    }
    const kind =
      mv.method === M.CASH
        ? out
          ? JournalEntryKind.MONEY_OUT
          : JournalEntryKind.MONEY_IN
        : mv.method === M.OPENING
          ? JournalEntryKind.OPENING_BALANCE
          : JournalEntryKind.LOAN;
    const ref = formatLoanNo(loan.loanNo);
    const entry = (await this.journal.post(
      {
        entryDate: mv.movementDate,
        businessUnitId: loan.businessUnitId,
        description: `${ref} ${counterparty.name}: ${mv.description}`.slice(0, 500),
        reference: ref,
        kind,
        reserveAccountId: mv.reserveAccountId,
        lines,
      },
      user,
      { manager: m, source: opts.source ?? JournalEntrySource.LOANS, allowReserve },
    )) as JournalEntry;
    await m.update(LoanMovement, mv.id, {
      status: LoanMovementStatus.POSTED,
      journalEntryId: entry.id,
      ...(opts.reviewer ? { reviewedBy: opts.reviewer, reviewedAt: new Date(), reviewNote: opts.note ?? null } : {}),
    });
    mv.status = LoanMovementStatus.POSTED;
    mv.journalEntryId = entry.id;
  }

  private async reverseOne(m: EntityManager, mv: LoanMovement, user: AuthenticatedUser, reason?: string, fromUtilities = false) {
    if (!mv.journalEntryId) return;
    const reversalId = await this.journal.reverseWithin(
      m,
      mv.journalEntryId,
      { reason: reason?.trim() || 'Loan movement reversed', entryDate: businessDate() },
      user,
      { fromLoans: true, fromUtilities, source: fromUtilities ? JournalEntrySource.UTILITIES : JournalEntrySource.LOANS },
    );
    await m.update(LoanMovement, mv.id, { status: LoanMovementStatus.REVERSED, reversalEntryId: reversalId, updatedBy: user.id });
  }

  /**
   * The current account between two units: one loan in each unit's books,
   * mirrored. The first unit to lend holds the "Due from" side; balances
   * can swing either way after that.
   */
  private async ensurePair(m: EntityManager, lender: BusinessUnit, borrower: BusinessUnit, user: AuthenticatedUser) {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('interunit:' || LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text)))`, [lender.id, borrower.id]);
    const cpLender = await ensureUnitCounterparty(m, lender, user.id);
    const cpBorrower = await ensureUnitCounterparty(m, borrower, user.id);
    const existing = await m.find(Loan, {
      where: [
        { businessUnitId: lender.id, counterpartyId: cpBorrower.id, mirrorLoanId: Not(IsNull()) },
        { businessUnitId: borrower.id, counterpartyId: cpLender.id, mirrorLoanId: Not(IsNull()) },
      ],
      relations: { counterparty: true, businessUnit: true },
    });
    if (existing.length === 2) return new Map(existing.map((l) => [l.businessUnitId, l]));
    const purpose = `Inter-unit current account — ${lender.name} and ${borrower.name}`;
    const make = (unit: BusinessUnit, cp: Counterparty, direction: LoanDirection) =>
      m.save(
        m.create(Loan, {
          counterpartyId: cp.id,
          businessUnitId: unit.id,
          direction,
          purpose,
          limit: null,
          status: LoanStatus.ACTIVE,
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNote: 'Opened with the first inter-unit movement; each transfer is approved on its own.',
          createdBy: user.id,
        }),
      );
    const a = await make(lender, cpBorrower, LoanDirection.RECEIVABLE);
    const b = await make(borrower, cpLender, LoanDirection.PAYABLE);
    await m.update(Loan, a.id, { mirrorLoanId: b.id });
    await m.update(Loan, b.id, { mirrorLoanId: a.id });
    a.mirrorLoanId = b.id;
    b.mirrorLoanId = a.id;
    a.counterparty = cpBorrower;
    a.businessUnit = lender;
    b.counterparty = cpLender;
    b.businessUnit = borrower;
    await ensureLoanAccount(m, a, cpBorrower, lender, user.id);
    await ensureLoanAccount(m, b, cpLender, borrower, user.id);
    return new Map([
      [lender.id, a],
      [borrower.id, b],
    ]);
  }

  private async lockLoan(m: EntityManager, id: string, user: AuthenticatedUser): Promise<Loan> {
    const locked = await m.findOne(Loan, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!locked) throw new NotFoundException('Loan not found');
    assertUnitAccess(user, locked.businessUnitId);
    const loan = await m.findOneOrFail(Loan, { where: { id }, relations: { counterparty: true, businessUnit: true } });
    return loan;
  }

  private async lockMovement(m: EntityManager, id: string, user: AuthenticatedUser) {
    const locked = await m.findOne(LoanMovement, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!locked) throw new NotFoundException('Movement not found');
    const loan = await this.lockLoan(m, locked.loanId, user);
    let mirror: { mv: LoanMovement; loan: Loan } | null = null;
    if (locked.mirrorMovementId) {
      const mv = await m.findOne(LoanMovement, { where: { id: locked.mirrorMovementId }, lock: { mode: 'pessimistic_write' } });
      if (mv) mirror = { mv, loan: await this.lockLoan(m, mv.loanId, user) };
    }
    return { mv: locked, loan, mirror };
  }

  private async activeUnit(m: EntityManager, id: string, user: AuthenticatedUser): Promise<BusinessUnit> {
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new BadRequestException('Business unit not found');
    if (!unit.isActive) throw new BadRequestException(`${unit.name} is inactive.`);
    assertUnitAccess(user, unit.id);
    return unit;
  }

  private async loadAccount(m: EntityManager, id: string | undefined): Promise<Account> {
    if (!id) throw new BadRequestException('Choose the account on the other side.');
    const account = await m.findOne(Account, { where: { id }, relations: { accountClass: true } });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.isActive || !account.isPostable) throw new BadRequestException(`${account.name} can’t be posted to.`);
    return account;
  }

  /** Posted totals and waiting movements per loan. */
  private async movementSums(m: EntityManager, loanIds: string[]) {
    const out = new Map<string, { principal: string; repaid: string; outstanding: string; pending: number }>();
    if (!loanIds.length) return out;
    const rows: { loanId: string; up: string; down: string; pending: string }[] = await m.query(
      `SELECT "loanId",
              COALESCE(SUM(amount) FILTER (WHERE status = 'POSTED' AND effect = 'INCREASE'), 0) AS up,
              COALESCE(SUM(amount) FILTER (WHERE status = 'POSTED' AND effect = 'DECREASE'), 0) AS down,
              COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL') AS pending
         FROM loan_movements WHERE "loanId" = ANY($1) GROUP BY "loanId"`,
      [loanIds],
    );
    for (const r of rows) {
      const up = toPaisa(String(r.up));
      const down = toPaisa(String(r.down));
      out.set(r.loanId, { principal: fromPaisa(up), repaid: fromPaisa(down), outstanding: fromPaisa(up - down), pending: Number(r.pending) });
    }
    return out;
  }

  private async loanBalances(m: EntityManager, user: AuthenticatedUser, opts: { counterpartyIds?: string[] }) {
    const scope = visibleUnitIds(user);
    const loans = await m.find(Loan, {
      where: {
        ...(opts.counterpartyIds ? { counterpartyId: In(opts.counterpartyIds.length ? opts.counterpartyIds : [NIL]) } : {}),
        ...(scope ? { businessUnitId: In(scope.length ? scope : [NIL]) } : {}),
      },
    });
    const sums = await this.movementSums(m, loans.map((l) => l.id));
    return loans.map((l) => ({
      loanId: l.id,
      counterpartyId: l.counterpartyId,
      direction: l.direction,
      status: l.status,
      interUnit: Boolean(l.mirrorLoanId),
      balance: toPaisa(sums.get(l.id)?.outstanding ?? '0'),
    }));
  }

  /** Outstanding salary advances per employee (null = everyone visible). */
  private async advanceTotals(m: EntityManager, user: AuthenticatedUser, employeeIds: string[] | null) {
    const scope = visibleUnitIds(user);
    const params: unknown[] = [];
    const where: string[] = [`a.status = '${SalaryAdvanceStatus.OUTSTANDING}'`];
    if (employeeIds) where.push(`a."employeeId" = ANY($${params.push(employeeIds.length ? employeeIds : [NIL])})`);
    if (scope) where.push(`a."businessUnitId" = ANY($${params.push(scope.length ? scope : [NIL])})`);
    const rows: { employeeId: string; total: string }[] = await m.query(
      `SELECT a."employeeId", SUM(a.amount - COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r WHERE r."advanceId" = a.id), 0)) AS total
         FROM salary_advances a WHERE ${where.join(' AND ')} GROUP BY a."employeeId"`,
      params,
    );
    return new Map(rows.map((r) => [r.employeeId, toPaisa(String(r.total))]));
  }

  private async entryNos(m: EntityManager, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    const entries = unique.length ? await m.find(JournalEntry, { where: { id: In(unique) } }) : [];
    return new Map(entries.map((e) => [e.id, { id: e.id, displayNo: formatEntryNo(e.entryNo), entryDate: e.entryDate }]));
  }

  private unitRef(u: BusinessUnit) {
    return { id: u.id, code: u.code, name: u.name };
  }

  private shapeCounterparty(c: Counterparty) {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      partner: c.partner ? { id: c.partner.id, shortName: c.partner.shortName } : null,
      employee: c.employee
        ? {
            id: c.employee.id,
            employeeCode: c.employee.employeeCode,
            unit: c.employee.businessUnit?.code ?? null,
            designation: c.employee.designation?.name ?? null,
            status: c.employee.status,
          }
        : null,
      businessUnit: c.businessUnit ? this.unitRef(c.businessUnit) : null,
      phone: c.phone,
      notes: c.notes,
      isActive: c.isActive,
    };
  }

  private shapeLoan(l: Loan, sums: { principal: string; repaid: string; outstanding: string; pending?: number } | undefined) {
    const outstanding = sums?.outstanding ?? '0.00';
    return {
      id: l.id,
      loanNo: formatLoanNo(l.loanNo),
      counterparty: l.counterparty ? { id: l.counterparty.id, name: l.counterparty.name, kind: l.counterparty.kind } : null,
      businessUnit: l.businessUnit ? this.unitRef(l.businessUnit) : null,
      direction: l.direction,
      purpose: l.purpose,
      limit: l.limit,
      headroom: headroom(outstanding, l.limit),
      status: l.status,
      principal: sums?.principal ?? '0.00',
      repaid: sums?.repaid ?? '0.00',
      outstanding,
      pending: sums?.pending ?? 0,
      isInterUnit: Boolean(l.mirrorLoanId),
      account: l.account ? { id: l.account.id, code: l.account.code, name: l.account.name } : null,
      createdAt: l.createdAt,
      closedAt: l.closedAt,
    };
  }

  private shapeAdvanceBrief(a: SalaryAdvance) {
    const recovered = (a.recoveries ?? []).reduce((s, r) => s + toPaisa(r.amount), 0n);
    const live = a.status === SalaryAdvanceStatus.OUTSTANDING || a.status === SalaryAdvanceStatus.RECOVERED;
    return {
      id: a.id,
      issueDate: a.issueDate,
      businessUnit: a.businessUnit ? this.unitRef(a.businessUnit) : null,
      amount: a.amount,
      reason: a.reason,
      status: a.status,
      recovered: fromPaisa(recovered),
      outstanding: live ? fromPaisa(toPaisa(a.amount) - recovered) : '0.00',
      writtenOff: a.writtenOff,
      writeOffReason: a.writeOffReason,
    };
  }
}
