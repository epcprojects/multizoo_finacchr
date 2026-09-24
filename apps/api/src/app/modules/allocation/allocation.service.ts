import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  AllocationRuleStatus,
  AllocationRunStatus,
  AllocationTargetType,
  JournalEntryKind,
  JournalEntrySource,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { JournalService, formatEntryNo } from '../journal/journal.service';
import { LedgerService } from '../ledger/ledger.service';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import {
  ensurePartnerReserve,
  ensureReserveOffset,
  reserveKind,
} from '../accounts/reserves';
import { AllocationRule } from './entities/allocation-rule.entity';
import { AllocationRun, RunBreakdownLine } from './entities/allocation-run.entity';
import { Partner } from './entities/partner.entity';
import { allocate } from './allocation-math';
import {
  addDays,
  AllocationRulesService,
  lockUnitAllocation,
} from './allocation-rules.service';
import { SetOpeningReservesDto } from './dto/allocation.dto';

/** Marks the opening-reserves entry so it can be found (and corrected) later. */
export const OPENING_RESERVES_REF = 'OPENING-RESERVES';

export type DayState =
  /** Allocated, and the day's income hasn't changed since. */
  | 'ALLOCATED'
  /** Income, no allocation yet. */
  | 'PENDING'
  /** Allocated, but income has since changed (a late entry or a reversal) — re-run. */
  | 'CHANGED'
  /** Income, but no approved rule covers the day. */
  | 'NO_RULE'
  | 'NO_INCOME';

function formatDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatRs(paisa: bigint) {
  const [whole, fraction] = fromPaisa(paisa < 0n ? -paisa : paisa).split('.');
  return `${paisa < 0n ? '−' : ''}Rs ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === '00' ? '' : `.${fraction}`}`;
}

/**
 * The Income Allocation Engine (module M2 in the plan; Module 3 here).
 *
 * Each day, each unit's net income is split by the rule version in force
 * that day, and the split is posted as one journal entry that earmarks the
 * money into reserves — cash itself doesn't move (Follow the Rupee, step 2).
 * The run record ties the entry to the income it was based on, so a day
 * whose income later changes is flagged and can be re-run: the old entry
 * is reversed and a new one posted, both visible in the ledger.
 */
@Injectable()
export class AllocationService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly rules: AllocationRulesService,
    private readonly journal: JournalService,
    private readonly ledger: LedgerService,
  ) {}

  private async unitFor(m: EntityManager, id: string, user: AuthenticatedUser) {
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new NotFoundException('Business unit not found');
    assertUnitAccess(user, id);
    return unit;
  }

  private async firstRuleDate(m: EntityManager, unitId: string): Promise<string | null> {
    const row = await m
      .createQueryBuilder(AllocationRule, 'r')
      .select(`to_char(MIN(r."effectiveFrom"), 'YYYY-MM-DD')`, 'first')
      .where('r.businessUnitId = :unitId', { unitId })
      .andWhere('r.status = :s', { s: AllocationRuleStatus.APPROVED })
      .getRawOne<{ first: string | null }>();
    return row?.first ?? null;
  }

  private postedRuns(m: EntityManager, unitId: string, from?: string, to?: string) {
    const qb = m
      .createQueryBuilder(AllocationRun, 'r')
      .leftJoinAndSelect('r.journalEntry', 'e')
      .leftJoinAndSelect('r.rule', 'rule')
      .where('r.businessUnitId = :unitId', { unitId })
      .andWhere('r.status = :s', { s: AllocationRunStatus.POSTED })
      .orderBy('r.allocationDate', 'ASC');
    if (from) qb.andWhere('r.allocationDate >= :from', { from });
    if (to) qb.andWhere('r.allocationDate <= :to', { to });
    return qb.getMany();
  }

  /**
   * Every day that needs the engine's attention, oldest first: income with
   * no allocation, or an allocation whose income has since changed. Only
   * days on or after the unit's first approved rule — before that there
   * was nothing to allocate by — and never today (the day isn't over).
   */
  async outstandingDays(m: EntityManager, unitId: string, upTo = addDays(businessDate(), -1)) {
    const first = await this.firstRuleDate(m, unitId);
    if (!first || first > upTo) return [] as { date: string; income: bigint; run: AllocationRun | null }[];
    const [income, runs] = await Promise.all([
      this.rules.incomeByDay(m, unitId, first, upTo),
      this.postedRuns(m, unitId, first, upTo),
    ]);
    const runByDate = new Map(runs.map((r) => [r.allocationDate, r]));
    const dates = [...new Set([...income.keys(), ...runByDate.keys()])].sort();
    return dates
      .map((date) => ({ date, income: income.get(date) ?? 0n, run: runByDate.get(date) ?? null }))
      .filter(({ income: gross, run }) => (run ? toPaisa(run.grossIncome) !== gross : gross !== 0n));
  }

  // --- screens -------------------------------------------------------------

  /** One card per unit: its rule, today so far, what's outstanding, what's earmarked. */
  async overview(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const units = scope && !scope.length
      ? []
      : await m.find(BusinessUnit, {
          where: scope ? { id: In(scope) } : {},
          relations: { unitType: true },
          order: { code: 'ASC' },
        });
    const today = businessDate();

    const pendingApprovals =
      scope && !scope.length
        ? 0
        : await m.count(AllocationRule, {
            where: {
              status: AllocationRuleStatus.PENDING_APPROVAL,
              ...(scope ? { businessUnitId: In(scope) } : {}),
            },
          });

    const cards = await Promise.all(units.map(async (unit) => {
      const [rule, todayIncome, outstanding, reserves] = await Promise.all([
        this.rules.effectiveRule(m, unit.id, today),
        this.rules.incomeByDay(m, unit.id, today, today),
        this.outstandingDays(m, unit.id),
        this.reserveSummary(m, unit.id),
      ]);
      const upcoming = await m.findOne(AllocationRule, {
        where: { businessUnitId: unit.id, status: AllocationRuleStatus.APPROVED },
        order: { effectiveFrom: 'DESC' },
      });
      const gross = todayIncome.get(today) ?? 0n;
      const input = rule ? this.rules.toRuleInput(rule) : null;
      return {
        id: unit.id,
        code: unit.code,
        name: unit.name,
        isActive: unit.isActive,
        isHolding: unit.unitType?.isHolding ?? false,
        rule: rule && input
          ? {
              id: rule.id,
              version: rule.version,
              effectiveFrom: rule.effectiveFrom,
              tranches: input.tranches.map((t) => ({ name: t.name, share: t.share, lineCount: t.lines.length })),
            }
          : null,
        upcomingRule:
          upcoming && upcoming.effectiveFrom > today
            ? { id: upcoming.id, version: upcoming.version, effectiveFrom: upcoming.effectiveFrom }
            : null,
        today: {
          date: today,
          income: fromPaisa(gross),
          split: input
            ? allocate(gross, input).byKey.map((b) => ({ key: b.key, label: b.label, amount: fromPaisa(b.amount) }))
            : [],
        },
        pendingDays: outstanding.filter((d) => !d.run).length,
        changedDays: outstanding.filter((d) => d.run).length,
        oldestOutstanding: outstanding[0]?.date ?? null,
        ...reserves.totals,
      };
    }));
    return { asOf: today, pendingApprovals, units: cards };
  }

  /** The unit's days, newest first: income, what was allocated, and what needs doing. */
  async days(unitId: string, user: AuthenticatedUser, from?: string, to?: string) {
    const m = this.dataSource.manager;
    const unit = await this.unitFor(m, unitId, user);
    const today = businessDate();
    to = to ?? today;
    from = from ?? addDays(to, -29);
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new BadRequestException('Invalid date range.');

    const [income, runs, outstanding, firstRule, lastAllocated] = await Promise.all([
      this.rules.incomeByDay(m, unit.id, from, to),
      this.postedRuns(m, unit.id, from, to),
      this.outstandingDays(m, unit.id),
      this.firstRuleDate(m, unit.id),
      this.rules.lastAllocatedDate(m, unit.id),
    ]);
    const runByDate = new Map(runs.map((r) => [r.allocationDate, r]));

    const rows: { date: string; isToday: boolean; income: string; state: DayState; run: ReturnType<AllocationService['shapeRun']> | null }[] = [];
    for (let date = to; date >= from; date = addDays(date, -1)) {
      const gross = income.get(date) ?? 0n;
      const run = runByDate.get(date) ?? null;
      let state: DayState;
      if (run) state = toPaisa(run.grossIncome) === gross ? 'ALLOCATED' : 'CHANGED';
      else if (gross === 0n) state = 'NO_INCOME';
      else if (!firstRule || date < firstRule) state = 'NO_RULE';
      else state = 'PENDING';
      rows.push({
        date,
        isToday: date === today,
        income: fromPaisa(gross),
        state,
        run: run ? this.shapeRun(run) : null,
      });
    }

    return {
      unit: { id: unit.id, code: unit.code, name: unit.name },
      from,
      to,
      firstRuleDate: firstRule,
      /** A new rule version can start the day after this at the earliest. */
      lastAllocatedDate: lastAllocated,
      outstanding: {
        pending: outstanding.filter((d) => !d.run).length,
        changed: outstanding.filter((d) => d.run).length,
        oldest: outstanding[0]?.date ?? null,
        total: fromPaisa(outstanding.reduce((s, d) => s + d.income, 0n)),
      },
      rows,
    };
  }

  private shapeRun(run: AllocationRun) {
    return {
      id: run.id,
      allocationDate: run.allocationDate,
      grossIncome: run.grossIncome,
      status: run.status,
      ruleId: run.ruleId,
      ruleVersion: run.rule?.version ?? null,
      journalEntryId: run.journalEntryId,
      entryNo: run.journalEntry ? formatEntryNo(run.journalEntry.entryNo) : null,
      breakdown: run.breakdown,
      createdAt: run.createdAt,
    };
  }

  // --- posting -------------------------------------------------------------

  /**
   * Allocates one day for one unit — or brings an existing allocation back
   * in line with the day's income (reverse + repost). Serialised per unit
   * with an advisory lock, so two clicks can't allocate a day twice (the
   * partial unique index is the backstop).
   */
  async allocateDay(unitId: string, date: string, user: AuthenticatedUser) {
    if (!isIsoDate(date)) throw new BadRequestException('date is not a real calendar date');
    if (date > businessDate()) throw new BadRequestException('A day in the future has no income to allocate yet.');

    const runId = await this.dataSource.transaction(async (m) => {
      const unit = await this.unitFor(m, unitId, user);
      await lockUnitAllocation(m, unit.id);
      return this.allocateWithin(m, unit, date, user);
    });
    const run = runId
      ? await this.dataSource.manager.findOne(AllocationRun, {
          where: { id: runId },
          relations: { journalEntry: true, rule: true },
        })
      : null;
    return { date, run: run ? this.shapeRun(run) : null };
  }

  /** Returns the new run's id, or null when the day ends up with nothing to allocate. */
  private async allocateWithin(m: EntityManager, unit: BusinessUnit, date: string, user: AuthenticatedUser) {
    const gross = (await this.rules.incomeByDay(m, unit.id, date, date)).get(date) ?? 0n;
    const existing = await m.findOne(AllocationRun, {
      where: { businessUnitId: unit.id, allocationDate: date, status: AllocationRunStatus.POSTED },
    });

    if (existing) {
      if (toPaisa(existing.grossIncome) === gross) {
        throw new ConflictException(`${unit.name} is already allocated for ${formatDay(date)}.`);
      }
      await this.undoWithin(m, existing, user, `income for the day changed to ${formatRs(gross)}`);
    }
    if (gross === 0n) {
      if (existing) return null;
      throw new BadRequestException(`${unit.name} has no income on ${formatDay(date)} — nothing to allocate.`);
    }

    const rule = await this.rules.effectiveRule(m, unit.id, date);
    if (!rule) {
      throw new BadRequestException(
        `No approved allocation rule covers ${unit.name} on ${formatDay(date)}. Set one up under Allocation → Rule.`,
      );
    }

    const input = this.rules.toRuleInput(rule);
    const result = allocate(gross, input);

    // Resolve each target to the account that receives it.
    const offset = await ensureReserveOffset(m, unit, user.id);
    const partnerIds = rule.tranches.flatMap((t) => t.lines.map((l) => l.partnerId).filter(Boolean) as string[]);
    const partners = partnerIds.length ? await m.find(Partner, { where: { id: In(partnerIds) } }) : [];
    const accountFor = new Map<string, string>();
    for (const line of rule.tranches.flatMap((t) => t.lines)) {
      if (line.targetType === AllocationTargetType.RESERVE) {
        accountFor.set(`${line.targetType}:${line.accountId}`, line.accountId as string);
      } else {
        const partner = partners.find((p) => p.id === line.partnerId) as Partner;
        const reserve = await ensurePartnerReserve(m, unit, partner, user.id);
        accountFor.set(`${line.targetType}:${line.partnerId}`, reserve.id);
      }
    }

    const reserveLines = result.byKey
      .filter((b) => b.amount !== 0n)
      .map((b) => {
        const accountId = accountFor.get(b.key) as string;
        return b.amount > 0n
          ? { accountId, debit: fromPaisa(b.amount), memo: b.label }
          : { accountId, credit: fromPaisa(-b.amount), memo: b.label };
      });
    const offsetLine =
      gross > 0n
        ? { accountId: offset.id, credit: fromPaisa(gross), memo: 'Earmarked from the day’s income' }
        : { accountId: offset.id, debit: fromPaisa(-gross), memo: 'Earmarks released — net income was negative' };

    const entry = await this.journal.post(
      {
        entryDate: date,
        businessUnitId: unit.id,
        description: `Income allocation · ${formatDay(date)} · ${formatRs(gross)} split by rule v${rule.version}`,
        reference: `ALLOC-${unit.code}-${date}`,
        kind: JournalEntryKind.ALLOCATION,
        lines: [...reserveLines, offsetLine],
      },
      user,
      { manager: m, allowReserve: true, source: JournalEntrySource.ALLOCATION },
    );

    const breakdown: RunBreakdownLine[] = result.lines.map((l) => {
      const t = input.tranches[l.tranche];
      return {
        tranche: t.name,
        trancheShare: t.share,
        label: l.label,
        targetType: l.key.split(':')[0],
        accountId: accountFor.get(l.key) as string,
        percentOfIncome: l.percentOfIncome,
        amount: fromPaisa(l.amount),
      };
    });

    const run = await m.save(
      m.create(AllocationRun, {
        businessUnitId: unit.id,
        allocationDate: date,
        ruleId: rule.id,
        grossIncome: fromPaisa(gross),
        journalEntryId: (entry as JournalEntry).id,
        status: AllocationRunStatus.POSTED,
        reversalEntryId: null,
        breakdown,
        createdBy: user.id,
        updatedBy: null,
      }),
    );
    return run.id;
  }

  /**
   * Allocates every outstanding day up to `upTo` (default yesterday), oldest
   * first, each day in its own transaction — a failure on one day leaves
   * the days before it done and reports where it stopped.
   */
  async allocateOutstanding(unitId: string, user: AuthenticatedUser, upTo?: string) {
    const limit = upTo ?? addDays(businessDate(), -1);
    if (!isIsoDate(limit)) throw new BadRequestException('upTo is not a real date');
    if (limit > businessDate()) throw new BadRequestException('upTo cannot be in the future.');
    const unit = await this.unitFor(this.dataSource.manager, unitId, user);
    const days = await this.outstandingDays(this.dataSource.manager, unit.id, limit);

    const done: { date: string; income: string; entryNo: string | null }[] = [];
    for (const day of days) {
      try {
        const result = await this.allocateDay(unit.id, day.date, user);
        done.push({ date: day.date, income: fromPaisa(day.income), entryNo: result.run?.entryNo ?? null });
      } catch (err) {
        return {
          allocated: done.length,
          days: done,
          stoppedAt: { date: day.date, reason: (err as Error).message },
        };
      }
    }
    return { allocated: done.length, days: done, stoppedAt: null };
  }

  /** Undoes a day's allocation: reverses its entry (dated the same day) and marks the run reversed. */
  async undoRun(runId: string, user: AuthenticatedUser, reason?: string) {
    await this.dataSource.transaction(async (m) => {
      const run = await m.findOne(AllocationRun, { where: { id: runId } });
      if (!run) throw new NotFoundException('Allocation not found');
      assertUnitAccess(user, run.businessUnitId);
      await lockUnitAllocation(m, run.businessUnitId);
      const fresh = await m.findOneOrFail(AllocationRun, { where: { id: runId } });
      if (fresh.status !== AllocationRunStatus.POSTED) throw new BadRequestException('This allocation is already undone.');
      await this.undoWithin(m, fresh, user, reason?.trim() || 'undone by hand');
    });
    return { id: runId, status: AllocationRunStatus.REVERSED };
  }

  private async undoWithin(m: EntityManager, run: AllocationRun, user: AuthenticatedUser, reason: string) {
    const reversalId = await this.journal.reverseWithin(
      m,
      run.journalEntryId,
      { entryDate: run.allocationDate, reason },
      user,
      { fromAllocationEngine: true },
    );
    await m.update(AllocationRun, run.id, {
      status: AllocationRunStatus.REVERSED,
      reversalEntryId: reversalId,
      updatedBy: user.id,
    });
  }

  // --- reserves ------------------------------------------------------------

  /** Balances of a unit's reserves, and how much of its money on hand is earmarked. */
  private async reserveSummary(m: EntityManager, unitId: string, asOf = businessDate()) {
    const accounts = await m.find(Account, {
      where: { businessUnitId: unitId },
      relations: { accountClass: true },
      order: { code: 'ASC' },
    });
    const relevant = accounts.filter((a) => a.accountClass.isLiquid || a.accountClass.isReserve);
    const balances = await this.ledger.balancesFor(relevant, { asOf });
    const bal = (a: Account) => toPaisa(balances.get(a.id) ?? '0.00');

    const liquid = relevant.filter((a) => a.accountClass.isLiquid);
    const reserves = relevant.filter((a) => {
      const kind = reserveKind(a);
      return kind === 'BUCKET' || kind === 'PARTNER';
    });
    const moneyOnHand = liquid.reduce((s, a) => s + bal(a), 0n);
    const earmarked = reserves.reduce((s, a) => s + bal(a), 0n);

    return {
      accounts: reserves.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        kind: reserveKind(a) as 'BUCKET' | 'PARTNER',
        partnerId: a.partnerId,
        isActive: a.isActive,
        balance: fromPaisa(bal(a)),
      })),
      liquid: liquid.map((a) => ({ id: a.id, code: a.code, name: a.name, balance: fromPaisa(bal(a)) })),
      totals: {
        moneyOnHand: fromPaisa(moneyOnHand),
        earmarked: fromPaisa(earmarked),
        /** Money on hand not yet earmarked — negative means more is earmarked than is actually held. */
        unearmarked: fromPaisa(moneyOnHand - earmarked),
      },
    };
  }

  async reserves(unitId: string, user: AuthenticatedUser, asOf?: string) {
    const m = this.dataSource.manager;
    const unit = await this.unitFor(m, unitId, user);
    const date = asOf ?? businessDate();
    if (!isIsoDate(date)) throw new BadRequestException('asOf is not a real date');
    const summary = await this.reserveSummary(m, unit.id, date);
    const opening = await this.openingReservesEntry(m, unit.id);
    return {
      unit: { id: unit.id, code: unit.code, name: unit.name },
      asOf: date,
      ...summary,
      openingReserves: opening
        ? { entryId: opening.id, displayNo: formatEntryNo(opening.entryNo), entryDate: opening.entryDate }
        : null,
    };
  }

  private openingReservesEntry(m: EntityManager, unitId: string) {
    return m.findOne(JournalEntry, {
      where: {
        businessUnitId: unitId,
        kind: JournalEntryKind.ALLOCATION,
        source: JournalEntrySource.SYSTEM,
        reference: OPENING_RESERVES_REF,
        reversedById: IsNull(),
      },
    });
  }

  /**
   * Brings the workbook's reserve balances in at cutover ("From New
   * Formulation" opening rows): each reserve debited, the offset credited.
   * Correcting reverses the previous opening entry and posts the new one
   * in one transaction, like a unit's opening balances.
   */
  async setOpeningReserves(unitId: string, dto: SetOpeningReservesDto, user: AuthenticatedUser) {
    if (!isIsoDate(dto.asOfDate)) throw new BadRequestException('asOfDate is not a real date');
    await this.dataSource.transaction(async (m) => {
      const unit = await this.unitFor(m, unitId, user);
      await lockUnitAllocation(m, unit.id);

      const ids = dto.amounts.map((a) => a.accountId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each reserve can appear only once.');
      const accounts = ids.length
        ? await m.find(Account, { where: { id: In(ids) }, relations: { accountClass: true } })
        : [];
      for (const a of dto.amounts) {
        const account = accounts.find((x) => x.id === a.accountId);
        const kind = account ? reserveKind(account) : null;
        if (!account || account.businessUnitId !== unit.id || (kind !== 'BUCKET' && kind !== 'PARTNER')) {
          throw new BadRequestException(`Opening reserves can only be set on ${unit.name}'s own reserves.`);
        }
      }

      const existing = await this.openingReservesEntry(m, unit.id);
      if (existing && !dto.replaceExisting) {
        throw new ConflictException(
          `${unit.name} already has opening reserves (${formatEntryNo(existing.entryNo)}). Choose “Correct opening reserves” to replace them.`,
        );
      }
      if (existing) {
        await this.journal.reverseWithin(
          m,
          existing.id,
          { entryDate: existing.entryDate, reason: dto.reason?.trim() || 'opening reserves corrected' },
          user,
        );
      }

      const nonZero = dto.amounts.filter((a) => toPaisa(a.amount) !== 0n);
      if (!nonZero.length) return;
      const offset = await ensureReserveOffset(m, unit, user.id);
      const total = nonZero.reduce((s, a) => s + toPaisa(a.amount), 0n);
      const lines = nonZero.map((a) => {
        const p = toPaisa(a.amount);
        return p > 0n ? { accountId: a.accountId, debit: fromPaisa(p) } : { accountId: a.accountId, credit: fromPaisa(-p) };
      });
      if (total !== 0n) {
        lines.push(total > 0n ? { accountId: offset.id, credit: fromPaisa(total) } : { accountId: offset.id, debit: fromPaisa(-total) });
      }
      await this.journal.post(
        {
          entryDate: dto.asOfDate,
          businessUnitId: unit.id,
          description: `Opening reserve balances — ${unit.name}`,
          reference: OPENING_RESERVES_REF,
          kind: JournalEntryKind.ALLOCATION,
          lines,
        },
        user,
        { manager: m, allowReserve: true, source: JournalEntrySource.SYSTEM },
      );
    });
    return this.reserves(unitId, user);
  }
}

