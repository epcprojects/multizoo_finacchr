import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, MoreThan } from 'typeorm';
import {
  AccountType,
  JournalEntryKind,
  JournalEntrySource,
  UtilityAllocationMethod,
  UtilityBillStatus,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { LoansService } from '../loans/loans.service';
import { LoanMovement } from '../loans/entities/loan.entity';
import { payingAccount } from '../payroll/payroll-common';
import { userNames } from '../hr/hr-common';
import { BillShare, MeterReading, RemainderSplit, SubMeter, UtilityBill, UtilityConnection } from './entities/utility.entity';
import { allocateShared, allocateSubMetered, AllocationResult, UtilityMathError } from './utility-math';
import {
  CreateBillDto,
  CreateConnectionDto,
  ListBillsQueryDto,
  PostBillDto,
  RemainderSplitDto,
  ShareDto,
  SubMeterDto,
  UnpostDto,
  UpdateBillDto,
  UpdateConnectionDto,
} from './dto/utilities.dto';

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * Utility bill allocation (architecture plan Part 03 §8, Part 06 M8,
 * Fig. 10): each connection's bill, the sub-meter readings or weights that
 * share it out, and the charge to every unit — the "Utility bill
 * allocation sheet, per billing cycle".
 *
 * The unit that receives the bill pays it; every other unit's share is
 * charged to it through the inter-unit account between them (Dr its
 * Utilities, Cr what it owes the payer), so each unit's P&L carries its own
 * electricity and the payer is owed the rest.
 */
@Injectable()
export class UtilitiesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
    private readonly loans: LoansService,
  ) {}

  // --- Connections ------------------------------------------------------------

  async listConnections(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const connections = await m.find(UtilityConnection, {
      where: scope ? { businessUnitId: In(scope.length ? scope : ['00000000-0000-0000-0000-000000000000']) } : {},
      relations: { businessUnit: true, expenseAccount: true, subMeters: { businessUnit: true } },
      order: { isActive: 'DESC', name: 'ASC' },
    });
    const last: { connectionId: string; periodTo: string; billAmount: string; status: string }[] = connections.length
      ? await m.query(
          `SELECT DISTINCT ON ("connectionId") "connectionId", "periodTo"::text AS "periodTo", "billAmount", status
             FROM utility_bills WHERE "connectionId" = ANY($1) ORDER BY "connectionId", "periodTo" DESC`,
          [connections.map((c) => c.id)],
        )
      : [];
    const units = await this.unitMap(m);
    return connections.map((c) => ({ ...this.shapeConnection(c, units), lastBill: last.find((b) => b.connectionId === c.id) ?? null }));
  }

  async getConnection(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const c = await this.loadConnection(m, id, user);
    return this.shapeConnection(c, await this.unitMap(m));
  }

  async createConnection(dto: CreateConnectionDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await this.activeUnit(m, dto.businessUnitId, user);
      await this.assertExpense(m, dto.expenseAccountId, unit.id);
      const connection = await m.save(
        m.create(UtilityConnection, {
          name: dto.name.trim(),
          utility: dto.utility?.trim() || 'Electricity',
          provider: dto.provider?.trim() || null,
          reference: dto.reference?.trim() || null,
          businessUnitId: unit.id,
          method: dto.method,
          standardDays: dto.standardDays ?? 30,
          expenseAccountId: dto.expenseAccountId,
          remainderSplit: await this.checkRemainder(m, dto.remainderSplit ?? [{ businessUnitId: unit.id, pct: '100' }]),
          shares: await this.checkShares(m, dto.shares ?? [], dto.method),
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      await this.saveSubMeters(m, connection, dto.subMeters ?? [], user);
      return connection.id;
    });
    return this.getConnection(id, user);
  }

  async updateConnection(id: string, dto: UpdateConnectionDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.loadConnection(m, id, user);
      if (dto.name !== undefined) c.name = dto.name.trim();
      if (dto.utility !== undefined) c.utility = dto.utility.trim() || 'Electricity';
      if (dto.provider !== undefined) c.provider = dto.provider?.trim() || null;
      if (dto.reference !== undefined) c.reference = dto.reference?.trim() || null;
      if (dto.standardDays !== undefined) c.standardDays = dto.standardDays;
      if (dto.expenseAccountId !== undefined) {
        await this.assertExpense(m, dto.expenseAccountId, c.businessUnitId);
        c.expenseAccountId = dto.expenseAccountId;
      }
      if (dto.remainderSplit !== undefined) c.remainderSplit = await this.checkRemainder(m, dto.remainderSplit);
      if (dto.shares !== undefined) c.shares = await this.checkShares(m, dto.shares, c.method);
      if (dto.notes !== undefined) c.notes = dto.notes?.trim() || null;
      if (dto.isActive !== undefined) c.isActive = dto.isActive;
      c.updatedBy = user.id;
      await m.update(UtilityConnection, c.id, {
        name: c.name,
        utility: c.utility,
        provider: c.provider,
        reference: c.reference,
        standardDays: c.standardDays,
        expenseAccountId: c.expenseAccountId,
        remainderSplit: c.remainderSplit,
        shares: c.shares,
        notes: c.notes,
        isActive: c.isActive,
        updatedBy: c.updatedBy,
      } as Partial<UtilityConnection>);
      if (dto.subMeters !== undefined) await this.saveSubMeters(m, c, dto.subMeters, user);
    });
    return this.getConnection(id, user);
  }

  // --- Bills --------------------------------------------------------------------

  async listBills(query: ListBillsQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(UtilityBill, 'b')
      .leftJoinAndSelect('b.connection', 'c')
      .leftJoinAndSelect('c.businessUnit', 'bu')
      .orderBy('b.periodTo', 'DESC')
      .take(300);
    if (query.connectionId) qb.andWhere('b.connectionId = :c', { c: query.connectionId });
    if (scope) qb.andWhere('c.businessUnitId IN (:...scope)', { scope: scope.length ? scope : ['00000000-0000-0000-0000-000000000000'] });
    const bills = await qb.getMany();
    return bills.map((b) => {
      const result = b.status === UtilityBillStatus.POSTED ? b.result : this.tryCompute(b, b.connection).result;
      return {
        id: b.id,
        connection: { id: b.connection.id, name: b.connection.name, method: b.connection.method, businessUnit: { id: b.connection.businessUnit.id, code: b.connection.businessUnit.code, name: b.connection.businessUnit.name } },
        periodFrom: b.periodFrom,
        periodTo: b.periodTo,
        billAmount: b.billAmount,
        totalUnits: b.totalUnits,
        status: b.status,
        rate: result?.rate ?? null,
        recharged: result ? this.recharged(result, b.connection.businessUnitId) : null,
        postedAt: b.postedAt,
      };
    });
  }

  async getBill(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const bill = await this.loadBill(m, id, user);
    const c = bill.connection;
    const units = await this.unitMap(m);
    const live = bill.status === UtilityBillStatus.POSTED && bill.result ? { result: bill.result, errors: [] as string[] } : this.tryCompute(bill, c);
    const warnings: string[] = [];
    if (bill.status === UtilityBillStatus.DRAFT) {
      if (bill.periodTo > businessDate()) warnings.push('The cycle hasn’t ended — it can be posted from ' + bill.periodTo + '.');
      const meters = await m.find(SubMeter, { where: { connectionId: c.id, isActive: true } });
      const missing = meters.filter((sm) => !bill.readings.some((r) => r.subMeterId === sm.id));
      if (missing.length) warnings.push(`Not on this bill: ${missing.map((sm) => sm.name).join(', ')} (added after it was started).`);
    }
    const [prev, next] = await Promise.all([
      m.findOne(UtilityBill, { where: { connectionId: c.id, periodTo: LessThan(bill.periodTo) }, order: { periodTo: 'DESC' } }),
      m.findOne(UtilityBill, { where: { connectionId: c.id, periodTo: MoreThan(bill.periodTo) }, order: { periodTo: 'ASC' } }),
    ]);
    const movementEntries = await m.find(LoanMovement, { where: { utilityBillId: bill.id }, relations: { loan: { businessUnit: true } } });
    const entryIds = [bill.paymentEntryId, ...movementEntries.flatMap((mv) => [mv.journalEntryId, mv.reversalEntryId])].filter(Boolean) as string[];
    const entries = entryIds.length ? await m.find(JournalEntry, { where: { id: In(entryIds) } }) : [];
    const names = await userNames(m, [bill.createdBy, bill.postedBy]);
    const unitName = (id: string) => units.get(id) ?? { id, code: '?', name: 'Unknown unit' };
    const result = live.result;
    return {
      id: bill.id,
      connection: this.shapeConnection(c, units),
      periodFrom: bill.periodFrom,
      periodTo: bill.periodTo,
      days: daysBetween(bill.periodFrom, bill.periodTo) + 1,
      billAmount: bill.billAmount,
      totalUnits: bill.totalUnits,
      status: bill.status,
      note: bill.note,
      readings: bill.readings.map((r) => ({ ...r, businessUnit: unitName(r.businessUnitId) })),
      remainderSplit: bill.remainderSplit.map((s) => ({ ...s, businessUnit: unitName(s.businessUnitId) })),
      shares: bill.shares,
      allocation: result
        ? {
            ...result,
            metered: result.metered.map((r) => ({ ...r, businessUnit: unitName(r.unitKey) })),
            remainder: result.remainder.map((r) => ({ ...r, businessUnit: unitName(r.unitKey) })),
            byUnit: result.byUnit.map((u) => ({
              ...u,
              businessUnit: unitName(u.unitKey),
              isPayer: u.unitKey === c.businessUnitId,
            })),
          }
        : null,
      errors: live.errors,
      warnings,
      postings: [
        ...(bill.paymentEntryId
          ? [{ label: 'Bill paid', unit: unitName(c.businessUnitId), entry: this.entryRef(entries, bill.paymentEntryId), reversal: null }]
          : []),
        ...movementEntries.map((mv) => ({
          label: mv.loan.businessUnitId === c.businessUnitId ? 'Recharge — owed to the payer' : 'Recharge — share charged',
          unit: this.unitRef(mv.loan.businessUnit),
          entry: this.entryRef(entries, mv.journalEntryId),
          reversal: this.entryRef(entries, mv.reversalEntryId),
        })),
      ],
      paidOn: bill.paidOn,
      previous: prev ? { id: prev.id, periodTo: prev.periodTo } : null,
      next: next ? { id: next.id, periodTo: next.periodTo } : null,
      createdByName: bill.createdBy ? names.get(bill.createdBy) ?? null : null,
      postedByName: bill.postedBy ? names.get(bill.postedBy) ?? null : null,
      postedAt: bill.postedAt,
    };
  }

  /** Starts a cycle's bill: each sub-meter's start reading is where its last bill ended. */
  async createBill(dto: CreateBillDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const c = await this.loadConnection(m, dto.connectionId, user);
      if (!c.isActive) throw new BadRequestException(`${c.name} is inactive.`);
      this.assertPeriod(dto.periodFrom, dto.periodTo);
      const clash = await m.findOne(UtilityBill, { where: { connectionId: c.id, periodTo: dto.periodTo } });
      if (clash) throw new ConflictException(`There's already a bill for the cycle ending ${dto.periodTo}.`);
      const overlap = await m
        .createQueryBuilder(UtilityBill, 'b')
        .where('b.connectionId = :c AND b.periodFrom <= :to AND b.periodTo >= :from', { c: c.id, from: dto.periodFrom, to: dto.periodTo })
        .getOne();
      if (overlap) throw new ConflictException(`That overlaps the ${overlap.periodFrom} – ${overlap.periodTo} bill.`);
      if (c.method === UtilityAllocationMethod.SUB_METERED && !dto.totalUnits) {
        throw new BadRequestException('Enter the units on the bill — the rate per unit comes from them.');
      }
      const previous = await m.findOne(UtilityBill, {
        where: { connectionId: c.id, periodTo: LessThan(dto.periodFrom) },
        order: { periodTo: 'DESC' },
      });
      const readings: MeterReading[] = c.subMeters
        .filter((sm) => sm.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((sm) => {
          const before = previous?.readings.find((r) => r.subMeterId === sm.id);
          // A meter installed during this cycle is read over part of it — pro-rate by default.
          const partial = sm.installedOn && sm.installedOn > dto.periodFrom && sm.installedOn <= dto.periodTo;
          return {
            subMeterId: sm.id,
            name: sm.name,
            businessUnitId: sm.businessUnitId,
            start: before?.end ?? '0',
            end: null,
            daysCovered: partial ? Math.max(1, daysBetween(sm.installedOn as string, dto.periodTo)) : null,
          };
        });
      const bill = await m.save(
        m.create(UtilityBill, {
          connectionId: c.id,
          periodFrom: dto.periodFrom,
          periodTo: dto.periodTo,
          billAmount: fromPaisa(toPaisa(dto.billAmount)),
          totalUnits: dto.totalUnits ? fromPaisa(toPaisa(dto.totalUnits)) : null,
          status: UtilityBillStatus.DRAFT,
          readings: c.method === UtilityAllocationMethod.SUB_METERED ? readings : [],
          remainderSplit: c.remainderSplit,
          shares: c.shares,
          createdBy: user.id,
        }),
      );
      return bill.id;
    });
    return this.getBill(id, user);
  }

  async updateBill(id: string, dto: UpdateBillDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const bill = await this.loadBill(m, id, user, true);
      if (bill.status !== UtilityBillStatus.DRAFT) throw new ConflictException('This bill is posted — unpost it to change it.');
      if (dto.periodFrom !== undefined) bill.periodFrom = dto.periodFrom;
      if (dto.periodTo !== undefined) bill.periodTo = dto.periodTo;
      this.assertPeriod(bill.periodFrom, bill.periodTo);
      if (dto.billAmount !== undefined) bill.billAmount = fromPaisa(toPaisa(dto.billAmount));
      if (dto.totalUnits !== undefined) bill.totalUnits = dto.totalUnits ? fromPaisa(toPaisa(dto.totalUnits)) : null;
      if (dto.readings !== undefined) {
        const meters = await m.find(SubMeter, { where: { connectionId: bill.connectionId } });
        bill.readings = dto.readings.map((r) => {
          const sm = meters.find((x) => x.id === r.subMeterId);
          if (!sm) throw new BadRequestException('A reading is for a sub-meter that isn’t on this connection.');
          if (r.end != null && toPaisa(r.end) < toPaisa(r.start)) {
            throw new BadRequestException(`${sm.name}: the end reading is below the start reading.`);
          }
          const kept = bill.readings.find((x) => x.subMeterId === sm.id);
          return {
            subMeterId: sm.id,
            name: kept?.name ?? sm.name,
            businessUnitId: kept?.businessUnitId ?? sm.businessUnitId,
            start: fromPaisa(toPaisa(r.start)),
            end: r.end == null || r.end === '' ? null : fromPaisa(toPaisa(r.end)),
            daysCovered: r.daysCovered ?? null,
          };
        });
      }
      if (dto.remainderSplit !== undefined) bill.remainderSplit = await this.checkRemainder(m, dto.remainderSplit);
      if (dto.shares !== undefined) bill.shares = await this.checkShares(m, dto.shares, bill.connection.method);
      if (dto.note !== undefined) bill.note = dto.note?.trim() || null;
      bill.updatedBy = user.id;
      await m.update(UtilityBill, bill.id, {
        periodFrom: bill.periodFrom,
        periodTo: bill.periodTo,
        billAmount: bill.billAmount,
        totalUnits: bill.totalUnits,
        readings: bill.readings,
        remainderSplit: bill.remainderSplit,
        shares: bill.shares,
        note: bill.note,
        updatedBy: bill.updatedBy,
      } as Partial<UtilityBill>);
    });
    return this.getBill(id, user);
  }

  async deleteBill(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const bill = await this.loadBill(m, id, user, true);
      if (bill.status !== UtilityBillStatus.DRAFT) throw new ConflictException('Unpost the bill before deleting it.');
      await m.delete(UtilityBill, { id: bill.id });
    });
    return { deleted: true };
  }

  /**
   * Posts the allocation: each other unit's share is charged to it through
   * the inter-unit account with the payer, and — optionally — the bill's
   * payment is recorded too (Dr Utilities / Cr the payer's cash, out of its
   * Utilities reserve if chosen).
   */
  async postBill(id: string, dto: PostBillDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const bill = await this.loadBill(m, id, user, true);
      if (bill.status !== UtilityBillStatus.DRAFT) throw new ConflictException('This bill is already posted.');
      const c = bill.connection;
      if (bill.periodTo > businessDate()) throw new BadRequestException(`The cycle ends on ${bill.periodTo} — post it after that.`);
      const { result, errors } = this.tryCompute(bill, c);
      if (!result || errors.length) throw new BadRequestException(errors.join(' ') || 'The allocation can’t be worked out yet.');
      const period = `${bill.periodFrom} to ${bill.periodTo}`;

      let paymentEntryId: string | null = null;
      let paidOn: string | null = null;
      if (dto.paidFromAccountId) {
        paidOn = dto.paidOn ?? businessDate();
        if (!isIsoDate(paidOn) || paidOn > businessDate()) throw new BadRequestException('Enter the date it was paid (not in the future).');
        const account = await payingAccount(m, dto.paidFromAccountId, c.businessUnitId);
        const entry = (await this.journal.post(
          {
            entryDate: paidOn,
            businessUnitId: c.businessUnitId,
            description: `${c.name} bill, ${period}`,
            reference: c.reference,
            kind: JournalEntryKind.MONEY_OUT,
            reserveAccountId: dto.reserveAccountId ?? null,
            lines: [
              { accountId: c.expenseAccountId, debit: bill.billAmount, memo: c.provider },
              { accountId: account.id, credit: bill.billAmount, memo: null },
            ],
          },
          user,
          { manager: m, source: JournalEntrySource.UTILITIES },
        )) as JournalEntry;
        paymentEntryId = entry.id;
      }

      for (const share of result.byUnit) {
        if (share.unitKey === c.businessUnitId || toPaisa(share.charge) <= 0n) continue;
        await this.loans.postRecharge(
          m,
          {
            creditorUnitId: c.businessUnitId,
            debtorUnitId: share.unitKey,
            amount: share.charge,
            date: bill.periodTo,
            description: `${c.name} ${c.utility.toLowerCase()} share, ${period}${share.units ? ` (${share.units} units)` : ''}`,
            expenseAccountId: c.expenseAccountId,
            utilityBillId: bill.id,
          },
          user,
        );
      }

      await m.update(UtilityBill, bill.id, {
        status: UtilityBillStatus.POSTED,
        result: result as unknown as object,
        paymentEntryId,
        paidOn,
        postedBy: user.id,
        postedAt: new Date(),
        updatedBy: user.id,
      } as Partial<UtilityBill>);
    });
    return this.getBill(id, user);
  }

  /** Back to draft: the recharges (and the payment, if it was posted here) are reversed. */
  async unpostBill(id: string, dto: UnpostDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const bill = await this.loadBill(m, id, user, true);
      if (bill.status !== UtilityBillStatus.POSTED) throw new ConflictException('This bill isn’t posted.');
      const reason = dto.reason?.trim() || 'Utility bill unposted';
      await this.loans.reverseRecharges(m, bill.id, user, reason);
      if (bill.paymentEntryId) {
        await this.journal.reverseWithin(m, bill.paymentEntryId, { reason, entryDate: businessDate() }, user, {
          fromUtilities: true,
          source: JournalEntrySource.UTILITIES,
        });
      }
      await m.update(UtilityBill, bill.id, {
        status: UtilityBillStatus.DRAFT,
        result: null,
        paymentEntryId: null,
        paidOn: null,
        postedBy: null,
        postedAt: null,
        updatedBy: user.id,
      } as Partial<UtilityBill>);
    });
    return this.getBill(id, user);
  }

  // --- Internals ------------------------------------------------------------------

  /** The allocation for a bill as it stands, or why it can't be worked out yet. */
  private tryCompute(bill: UtilityBill, c: UtilityConnection): { result: AllocationResult | null; errors: string[] } {
    const errors: string[] = [];
    try {
      if (c.method === UtilityAllocationMethod.SHARED) {
        return { result: allocateShared(bill.billAmount, bill.shares), errors };
      }
      if (!bill.totalUnits) errors.push('Enter the units on the bill.');
      const unread = bill.readings.filter((r) => r.end == null);
      if (unread.length) errors.push(`Enter the end reading for ${unread.map((r) => r.name).join(', ')}.`);
      if (errors.length) return { result: null, errors };
      return {
        result: allocateSubMetered({
          billAmount: bill.billAmount,
          totalUnits: bill.totalUnits as string,
          standardDays: c.standardDays,
          readings: bill.readings.map((r) => ({
            key: r.subMeterId,
            label: r.name,
            unitKey: r.businessUnitId,
            start: r.start,
            end: r.end as string,
            daysCovered: r.daysCovered,
          })),
          remainder: bill.remainderSplit.map((s) => ({ unitKey: s.businessUnitId, pct: s.pct })),
        }),
        errors,
      };
    } catch (err) {
      if (err instanceof UtilityMathError) return { result: null, errors: [err.message] };
      throw err;
    }
  }

  /** What the other units were charged, in total. */
  private recharged(result: AllocationResult, payerId: string): string {
    return fromPaisa(result.byUnit.filter((u) => u.unitKey !== payerId).reduce((s, u) => s + toPaisa(u.charge), 0n));
  }

  private assertPeriod(from: string, to: string) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new BadRequestException('Enter real dates.');
    if (to < from) throw new BadRequestException('The cycle has to end after it starts.');
    if (daysBetween(from, to) > 62) throw new BadRequestException('A billing cycle can’t be longer than two months.');
  }

  private async saveSubMeters(m: EntityManager, c: UtilityConnection, list: SubMeterDto[], user: AuthenticatedUser) {
    const existing = await m.find(SubMeter, { where: { connectionId: c.id } });
    const unitIds = [...new Set(list.map((s) => s.businessUnitId))];
    const units = unitIds.length ? await m.find(BusinessUnit, { where: { id: In(unitIds) } }) : [];
    const kept = new Set<string>();
    for (const [i, s] of list.entries()) {
      if (!units.some((u) => u.id === s.businessUnitId)) throw new BadRequestException(`${s.name}: choose the unit it's charged to.`);
      const row = s.id ? existing.find((x) => x.id === s.id) : undefined;
      if (s.id && !row) throw new BadRequestException(`${s.name} isn't a sub-meter on this connection.`);
      if (row) kept.add(row.id);
      await m.save(
        m.create(SubMeter, {
          ...(row ?? { createdBy: user.id }),
          connectionId: c.id,
          name: s.name.trim(),
          businessUnitId: s.businessUnitId,
          installedOn: s.installedOn ?? null,
          sortOrder: i,
          isActive: s.isActive ?? true,
          updatedBy: row ? user.id : null,
        }),
      );
    }
    // Meters left off the list are retired, not deleted — past bills name them.
    const retire = existing.filter((x) => !kept.has(x.id) && x.isActive).map((x) => x.id);
    if (retire.length) await m.update(SubMeter, { id: In(retire) }, { isActive: false, updatedBy: user.id });
  }

  private async checkRemainder(m: EntityManager, list: RemainderSplitDto[]): Promise<RemainderSplit[]> {
    if (!list.length) return [];
    const ids = [...new Set(list.map((s) => s.businessUnitId))];
    if (ids.length !== list.length) throw new BadRequestException('Each unit appears once in the split.');
    const units = await m.find(BusinessUnit, { where: { id: In(ids) } });
    if (units.length !== ids.length) throw new BadRequestException('A unit in the split wasn’t found.');
    const total = list.reduce((s, x) => s + scaled(x.pct), 0n);
    if (total !== 1_000_000n) throw new BadRequestException('The unmetered split must add up to 100%.');
    return list.map((s) => ({ businessUnitId: s.businessUnitId, pct: s.pct.trim() }));
  }

  private async checkShares(m: EntityManager, list: ShareDto[], method: UtilityAllocationMethod): Promise<BillShare[]> {
    if (method !== UtilityAllocationMethod.SHARED) return [];
    if (!list.length) throw new BadRequestException('Add at least one line to share the bill by.');
    const ids = new Set<string>();
    const out = list.map((s) => {
      const weights: Record<string, string> = {};
      for (const [unitId, w] of Object.entries(s.weights ?? {})) {
        const text = String(w).trim();
        if (!text) continue;
        if (!/^\d{1,6}(\.\d{1,4})?$/.test(text)) throw new BadRequestException(`${s.label}: weights are numbers with at most 4 decimals.`);
        weights[unitId] = text;
        ids.add(unitId);
      }
      return { label: s.label.trim(), weights };
    });
    const units = ids.size ? await m.find(BusinessUnit, { where: { id: In([...ids]) } }) : [];
    if (units.length !== ids.size) throw new BadRequestException('A unit in the shares wasn’t found.');
    try {
      allocateShared('100', out);
    } catch (err) {
      if (err instanceof UtilityMathError) throw new BadRequestException(err.message);
      throw err;
    }
    return out;
  }

  private async assertExpense(m: EntityManager, accountId: string, unitId: string) {
    const account = await m.findOne(Account, { where: { id: accountId } });
    if (!account || account.type !== AccountType.EXPENSE || !account.isPostable || !account.isActive) {
      throw new BadRequestException('Choose an active expense account (e.g. Utilities).');
    }
    if (account.businessUnitId && account.businessUnitId !== unitId) throw new BadRequestException(`${account.name} belongs to another unit.`);
  }

  private async activeUnit(m: EntityManager, id: string, user: AuthenticatedUser) {
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit || !unit.isActive) throw new BadRequestException('Choose an active business unit.');
    assertUnitAccess(user, unit.id);
    return unit;
  }

  private async loadConnection(m: EntityManager, id: string, user: AuthenticatedUser) {
    const c = await m.findOne(UtilityConnection, {
      where: { id },
      relations: { businessUnit: true, expenseAccount: true, subMeters: { businessUnit: true } },
    });
    if (!c) throw new NotFoundException('Connection not found');
    assertUnitAccess(user, c.businessUnitId);
    return c;
  }

  private async loadBill(m: EntityManager, id: string, user: AuthenticatedUser, lock = false) {
    if (lock) {
      const locked = await m.findOne(UtilityBill, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw new NotFoundException('Bill not found');
    }
    const bill = await m.findOne(UtilityBill, {
      where: { id },
      relations: { connection: { businessUnit: true, expenseAccount: true, subMeters: { businessUnit: true } } },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    assertUnitAccess(user, bill.connection.businessUnitId);
    return bill;
  }

  private async unitMap(m: EntityManager) {
    const units = await m.find(BusinessUnit, { withDeleted: true });
    return new Map(units.map((u) => [u.id, this.unitRef(u)]));
  }

  private unitRef(u: BusinessUnit) {
    return { id: u.id, code: u.code, name: u.name };
  }

  private entryRef(entries: JournalEntry[], id: string | null) {
    const e = id ? entries.find((x) => x.id === id) : null;
    return e ? { id: e.id, displayNo: formatEntryNo(e.entryNo), entryDate: e.entryDate } : null;
  }

  private shapeConnection(c: UtilityConnection, units: Map<string, { id: string; code: string; name: string }>) {
    const unit = (id: string) => units.get(id) ?? { id, code: '?', name: 'Unknown unit' };
    return {
      id: c.id,
      name: c.name,
      utility: c.utility,
      provider: c.provider,
      reference: c.reference,
      businessUnit: this.unitRef(c.businessUnit),
      method: c.method,
      standardDays: c.standardDays,
      expenseAccount: c.expenseAccount ? { id: c.expenseAccount.id, code: c.expenseAccount.code, name: c.expenseAccount.name } : null,
      subMeters: [...(c.subMeters ?? [])]
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder)
        .map((sm) => ({ id: sm.id, name: sm.name, businessUnit: unit(sm.businessUnitId), installedOn: sm.installedOn, isActive: sm.isActive })),
      remainderSplit: c.remainderSplit.map((s) => ({ ...s, businessUnit: unit(s.businessUnitId) })),
      shares: c.shares,
      notes: c.notes,
      isActive: c.isActive,
    };
  }
}

function scaled(pct: string): bigint {
  const [whole, fraction = ''] = pct.trim().split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}
