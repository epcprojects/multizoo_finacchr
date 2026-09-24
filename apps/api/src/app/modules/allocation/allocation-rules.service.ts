import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, LessThanOrEqual } from 'typeorm';
import {
  AllocationRuleStatus,
  AllocationRunStatus,
  AllocationTargetType,
  Permission,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { User } from '../users/entities/user.entity';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  hasPermission,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import { ensurePartnerReserve, isBucketReserve } from '../accounts/reserves';
import {
  AllocationLine,
  AllocationRule,
  AllocationTranche,
} from './entities/allocation-rule.entity';
import { AllocationRun } from './entities/allocation-run.entity';
import { Partner } from './entities/partner.entity';
import {
  allocate,
  fromScaled,
  ruleViolations,
  toScaled,
  type RuleInput,
} from './allocation-math';
import {
  CreateAllocationRuleDto,
  ListAllocationRulesQueryDto,
  PreviewAllocationRuleDto,
  ReviewAllocationRuleDto,
  RuleTrancheDto,
  UpdateAllocationRuleDto,
} from './dto/allocation.dto';

const S = AllocationRuleStatus;

/** Serialises everything that changes a unit's waterfall (approvals, runs). */
export async function lockUnitAllocation(m: EntityManager, unitId: string) {
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`allocation:${unitId}`]);
}

export function targetKey(type: AllocationTargetType, id: string) {
  return `${type}:${id}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tranches normalised for display: "65.0000" → "65". */
function tidy(value: string) {
  return fromScaled(toScaled(value));
}

/**
 * The Rules & Policy Engine for the income waterfall (plan Part 07 §08,
 * Fig. 16): versioned, effective-dated, never edited once approved.
 *
 * Who does what, per the roles table (Part 10): the Accountant drafts and
 * submits a change ("approval only"); a Partner approves or rejects it —
 * or makes a change and approves it in one step, since Partners hold the
 * authority outright.
 */
@Injectable()
export class AllocationRulesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // --- reading -------------------------------------------------------------

  private loadRules(m: EntityManager, where: FindOptionsWhere<AllocationRule>) {
    return m.find(AllocationRule, {
      where,
      relations: {
        businessUnit: true,
        tranches: { lines: { account: true, partner: true } },
      },
      order: { version: 'DESC' },
    });
  }

  /** The approved version in force on a date, or null. */
  async effectiveRule(m: EntityManager, unitId: string, date: string): Promise<AllocationRule | null> {
    const [rule] = await m.find(AllocationRule, {
      where: { businessUnitId: unitId, status: S.APPROVED, effectiveFrom: LessThanOrEqual(date) },
      relations: { tranches: { lines: { account: true, partner: true } } },
      order: { effectiveFrom: 'DESC', version: 'DESC' },
      take: 1,
    });
    return rule ?? null;
  }

  /** A stored rule as the pure engine's input. */
  toRuleInput(rule: AllocationRule): RuleInput {
    return {
      tranches: [...rule.tranches]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({
          name: t.name,
          share: tidy(t.share),
          method: t.method,
          lines: [...t.lines]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((l) => ({
              key: targetKey(l.targetType, (l.accountId ?? l.partnerId) as string),
              label: this.lineLabel(l),
              weight: tidy(l.weight),
            })),
        })),
    };
  }

  private lineLabel(l: AllocationLine) {
    if (l.targetType === AllocationTargetType.PARTNER) return l.partner?.name ?? 'Partner';
    return l.account?.name ?? 'Reserve';
  }

  async list(query: ListAllocationRulesQueryDto, user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    if (query.businessUnitId) assertUnitAccess(user, query.businessUnitId);
    const unitFilter = query.businessUnitId
      ? { businessUnitId: query.businessUnitId }
      : scope
        ? { businessUnitId: In(scope.length ? scope : ['00000000-0000-0000-0000-000000000000']) }
        : {};
    const rules = await this.loadRules(this.dataSource.manager, {
      ...unitFilter,
      ...(query.status ? { status: query.status } : {}),
    });
    return this.shape(this.dataSource.manager, rules);
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const [rule] = await this.loadRules(this.dataSource.manager, { id });
    if (!rule) throw new NotFoundException('Rule version not found');
    assertUnitAccess(user, rule.businessUnitId);
    const [shaped] = await this.shape(this.dataSource.manager, [rule]);
    return shaped;
  }

  /**
   * API shape: each line with its effective % of income, each approved
   * version with the date it stopped applying (the next one's start).
   */
  async shape(m: EntityManager, rules: AllocationRule[]) {
    const userIds = [
      ...new Set(rules.flatMap((r) => [r.createdBy, r.submittedBy, r.reviewedBy]).filter(Boolean) as string[]),
    ];
    const users = userIds.length ? await m.find(User, { where: { id: In(userIds) }, withDeleted: true }) : [];
    const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.fullName ?? null) : null);

    const unitIds = [...new Set(rules.map((r) => r.businessUnitId))];
    const approved = unitIds.length
      ? await m.find(AllocationRule, {
          where: { businessUnitId: In(unitIds), status: S.APPROVED },
          order: { effectiveFrom: 'ASC', version: 'ASC' },
        })
      : [];
    const today = businessDate();

    return rules.map((r) => {
      const input = this.toRuleInput(r);
      const pct = allocate(0n, input).lines;
      const sameUnit = approved.filter((a) => a.businessUnitId === r.businessUnitId);
      const idx = sameUnit.findIndex((a) => a.id === r.id);
      const next = idx >= 0 ? sameUnit.slice(idx + 1).find((a) => a.effectiveFrom > r.effectiveFrom) : undefined;
      const effectiveTo = r.status === S.APPROVED && next ? addDays(next.effectiveFrom, -1) : null;
      const isCurrent =
        r.status === S.APPROVED && r.effectiveFrom <= today && (!effectiveTo || effectiveTo >= today);

      const tranches = [...r.tranches].sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        id: r.id,
        businessUnitId: r.businessUnitId,
        businessUnit: r.businessUnit
          ? { id: r.businessUnit.id, code: r.businessUnit.code, name: r.businessUnit.name }
          : null,
        version: r.version,
        effectiveFrom: r.effectiveFrom,
        effectiveTo,
        isCurrent,
        isUpcoming: r.status === S.APPROVED && r.effectiveFrom > today,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt,
        createdBy: r.createdBy,
        createdByName: nameOf(r.createdBy),
        submittedAt: r.submittedAt,
        submittedByName: nameOf(r.submittedBy),
        reviewedAt: r.reviewedAt,
        reviewedByName: nameOf(r.reviewedBy),
        reviewNote: r.reviewNote,
        tranches: tranches.map((t, ti) => ({
          id: t.id,
          name: t.name,
          share: tidy(t.share),
          method: t.method,
          lines: [...t.lines]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((l, li) => ({
              id: l.id,
              targetType: l.targetType,
              accountId: l.accountId,
              partnerId: l.partnerId,
              label: this.lineLabel(l),
              weight: tidy(l.weight),
              percentOfIncome: pct.find((p) => p.tranche === ti && p.line === li)?.percentOfIncome ?? '0',
            })),
        })),
      };
    });
  }

  // --- validating ----------------------------------------------------------

  /**
   * Checks every line points at something real in this unit — one of its
   * own reserve buckets, or an active partner — and returns the rule in
   * engine form with display labels.
   */
  private async resolve(m: EntityManager, unitId: string, tranches: RuleTrancheDto[]): Promise<RuleInput> {
    const accountIds = tranches.flatMap((t) => t.lines.map((l) => l.accountId).filter(Boolean) as string[]);
    const partnerIds = tranches.flatMap((t) => t.lines.map((l) => l.partnerId).filter(Boolean) as string[]);
    const accounts = accountIds.length
      ? await m.find(Account, { where: { id: In(accountIds) }, relations: { accountClass: true } })
      : [];
    const partners = partnerIds.length ? await m.find(Partner, { where: { id: In(partnerIds) } }) : [];

    return {
      tranches: tranches.map((t) => ({
        name: t.name.trim(),
        share: t.share,
        method: t.method,
        lines: t.lines.map((l) => {
          if (l.targetType === AllocationTargetType.RESERVE) {
            const a = accounts.find((x) => x.id === l.accountId);
            if (!a || !l.accountId || l.partnerId) {
              throw new BadRequestException('A reserve line needs one of the unit’s reserve accounts.');
            }
            if (!isBucketReserve(a) || a.businessUnitId !== unitId) {
              throw new BadRequestException(`${a.name} is not one of this unit's reserve buckets.`);
            }
            if (!a.isActive) throw new BadRequestException(`${a.name} is inactive.`);
            return { key: targetKey(l.targetType, a.id), label: a.name, weight: l.weight };
          }
          const p = partners.find((x) => x.id === l.partnerId);
          if (!p || !l.partnerId || l.accountId) throw new BadRequestException('A partner line needs a partner.');
          if (!p.isActive) throw new BadRequestException(`${p.name} is not an active partner.`);
          return { key: targetKey(l.targetType, p.id), label: p.name, weight: l.weight };
        }),
      })),
    };
  }

  private assertValid(input: RuleInput) {
    const problems = ruleViolations(input);
    if (problems.length) throw new BadRequestException(problems.join(' '));
  }

  private buildTranches(m: EntityManager, tranches: RuleTrancheDto[]) {
    return tranches.map((t, ti) =>
      m.create(AllocationTranche, {
        sortOrder: ti + 1,
        name: t.name.trim(),
        share: t.share,
        method: t.method,
        lines: t.lines.map((l, li) =>
          m.create(AllocationLine, {
            sortOrder: li + 1,
            targetType: l.targetType,
            accountId: l.targetType === AllocationTargetType.RESERVE ? (l.accountId ?? null) : null,
            partnerId: l.targetType === AllocationTargetType.PARTNER ? (l.partnerId ?? null) : null,
            weight: l.weight,
          }),
        ),
      }),
    );
  }

  /** The last day this unit has a posted allocation for — rules can't change before it. */
  async lastAllocatedDate(m: EntityManager, unitId: string): Promise<string | null> {
    const row = await m
      .createQueryBuilder(AllocationRun, 'r')
      .select(`to_char(MAX(r."allocationDate"), 'YYYY-MM-DD')`, 'last')
      .where('r.businessUnitId = :unitId', { unitId })
      .andWhere('r.status = :status', { status: AllocationRunStatus.POSTED })
      .getRawOne<{ last: string | null }>();
    return row?.last ?? null;
  }

  private async assertEffectiveDateOpen(m: EntityManager, unitId: string, effectiveFrom: string) {
    if (!isIsoDate(effectiveFrom)) throw new BadRequestException('effectiveFrom is not a real date.');
    const last = await this.lastAllocatedDate(m, unitId);
    if (last && effectiveFrom <= last) {
      throw new BadRequestException(
        `Days up to ${last} are already allocated under the rule in force then. A new version can start on ${addDays(last, 1)} at the earliest — history is never re-split. (To re-split those days, undo their allocations first.)`,
      );
    }
  }

  private assertCanPropose(user: AuthenticatedUser) {
    if (
      !hasPermission(user, Permission.RULES_PROPOSE_ALLOCATION) &&
      !hasPermission(user, Permission.RULES_EDIT_ALLOCATION)
    ) {
      throw new ForbiddenException('You cannot propose allocation rule changes.');
    }
  }

  private assertCanApprove(user: AuthenticatedUser) {
    if (!hasPermission(user, Permission.RULES_EDIT_ALLOCATION)) {
      throw new ForbiddenException('Only a Partner (rules.edit_allocation) can approve allocation rules.');
    }
  }

  // --- writing -------------------------------------------------------------

  async create(dto: CreateAllocationRuleDto, user: AuthenticatedUser) {
    this.assertCanPropose(user);
    assertUnitAccess(user, dto.businessUnitId);
    if (dto.publish) this.assertCanApprove(user);

    const id = await this.dataSource.transaction(async (m) => {
      const unit = await m.findOne(BusinessUnit, { where: { id: dto.businessUnitId } });
      if (!unit) throw new NotFoundException('Business unit not found');
      await lockUnitAllocation(m, unit.id);

      this.assertValid(await this.resolve(m, unit.id, dto.tranches));
      await this.assertEffectiveDateOpen(m, unit.id, dto.effectiveFrom);

      const { max } = (await m
        .createQueryBuilder(AllocationRule, 'r')
        .select('COALESCE(MAX(r.version), 0)', 'max')
        .where('r.businessUnitId = :id', { id: unit.id })
        .getRawOne<{ max: number }>()) ?? { max: 0 };

      const rule = await m.save(
        m.create(AllocationRule, {
          businessUnitId: unit.id,
          version: Number(max) + 1,
          effectiveFrom: dto.effectiveFrom,
          status: S.DRAFT,
          note: dto.note?.trim() || null,
          createdBy: user.id,
          updatedBy: null,
          submittedAt: null,
          submittedBy: null,
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: null,
          tranches: this.buildTranches(m, dto.tranches),
        }),
      );

      if (dto.submit || dto.publish) {
        await m.update(AllocationRule, rule.id, {
          status: S.PENDING_APPROVAL,
          submittedAt: new Date(),
          submittedBy: user.id,
        });
      }
      if (dto.publish) await this.approveWithin(m, rule.id, { note: dto.note }, user);
      return rule.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateAllocationRuleDto, user: AuthenticatedUser) {
    this.assertCanPropose(user);
    await this.dataSource.transaction(async (m) => {
      const rule = await m.findOne(AllocationRule, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rule) throw new NotFoundException('Rule version not found');
      assertUnitAccess(user, rule.businessUnitId);
      if (rule.status !== S.DRAFT) {
        throw new BadRequestException('Only a draft can be edited. Approved versions never change — propose a new version instead.');
      }
      if (dto.tranches) {
        this.assertValid(await this.resolve(m, rule.businessUnitId, dto.tranches));
        await m.delete(AllocationTranche, { ruleId: rule.id });
        await m.save(this.buildTranches(m, dto.tranches).map((t) => Object.assign(t, { ruleId: rule.id })));
      }
      if (dto.effectiveFrom) {
        await this.assertEffectiveDateOpen(m, rule.businessUnitId, dto.effectiveFrom);
        rule.effectiveFrom = dto.effectiveFrom;
      }
      if (dto.note !== undefined) rule.note = dto.note.trim() || null;
      rule.updatedBy = user.id;
      await m.save(rule);
    });
    return this.findOne(id, user);
  }

  async submit(id: string, user: AuthenticatedUser) {
    this.assertCanPropose(user);
    await this.dataSource.transaction(async (m) => {
      const rule = await m.findOne(AllocationRule, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rule) throw new NotFoundException('Rule version not found');
      assertUnitAccess(user, rule.businessUnitId);
      if (rule.status !== S.DRAFT) throw new BadRequestException('Only a draft can be submitted.');
      await this.assertEffectiveDateOpen(m, rule.businessUnitId, rule.effectiveFrom);
      await m.update(AllocationRule, id, {
        status: S.PENDING_APPROVAL,
        submittedAt: new Date(),
        submittedBy: user.id,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  async approve(id: string, dto: ReviewAllocationRuleDto, user: AuthenticatedUser) {
    this.assertCanApprove(user);
    await this.dataSource.transaction((m) => this.approveWithin(m, id, dto, user));
    return this.findOne(id, user);
  }

  /**
   * Makes a version live from its effective date. Re-checks everything at
   * the moment of approval — the ledger may have moved since the draft:
   * a day could have been allocated, a reserve deactivated, a partner left.
   */
  private async approveWithin(m: EntityManager, id: string, dto: ReviewAllocationRuleDto, user: AuthenticatedUser) {
    const [rule] = await this.loadRules(m, { id });
    if (!rule) throw new NotFoundException('Rule version not found');
    assertUnitAccess(user, rule.businessUnitId);
    await lockUnitAllocation(m, rule.businessUnitId);
    if (rule.status !== S.PENDING_APPROVAL && rule.status !== S.DRAFT) {
      throw new BadRequestException(`This version is ${rule.status.toLowerCase().replace('_', ' ')} — only a draft or pending version can be approved.`);
    }

    const dtoTranches: RuleTrancheDto[] = [...rule.tranches]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        name: t.name,
        share: tidy(t.share),
        method: t.method,
        lines: [...t.lines]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((l) => ({
            targetType: l.targetType,
            accountId: l.accountId ?? undefined,
            partnerId: l.partnerId ?? undefined,
            weight: tidy(l.weight),
          })),
      }));
    this.assertValid(await this.resolve(m, rule.businessUnitId, dtoTranches));
    await this.assertEffectiveDateOpen(m, rule.businessUnitId, rule.effectiveFrom);

    // A version approved for the same start date that never applied to a
    // day is replaced, not stacked (e.g. fixing a typo before it goes live).
    await m.update(
      AllocationRule,
      { businessUnitId: rule.businessUnitId, status: S.APPROVED, effectiveFrom: rule.effectiveFrom },
      { status: S.SUPERSEDED, updatedBy: user.id },
    );

    const unit = await m.findOneOrFail(BusinessUnit, { where: { id: rule.businessUnitId } });
    for (const line of rule.tranches.flatMap((t) => t.lines)) {
      if (line.partner) await ensurePartnerReserve(m, unit, line.partner, user.id);
    }

    await m.update(AllocationRule, id, {
      status: S.APPROVED,
      reviewedAt: new Date(),
      reviewedBy: user.id,
      reviewNote: dto.note?.trim() || null,
      updatedBy: user.id,
    });
  }

  async reject(id: string, dto: ReviewAllocationRuleDto, user: AuthenticatedUser) {
    this.assertCanApprove(user);
    await this.dataSource.transaction(async (m) => {
      const rule = await m.findOne(AllocationRule, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rule) throw new NotFoundException('Rule version not found');
      assertUnitAccess(user, rule.businessUnitId);
      if (rule.status !== S.PENDING_APPROVAL) throw new BadRequestException('Only a version awaiting approval can be rejected.');
      await m.update(AllocationRule, id, {
        status: S.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: user.id,
        reviewNote: dto.note?.trim() || null,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  /** Takes back a draft or a pending proposal. The version number stays used. */
  async withdraw(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const rule = await m.findOne(AllocationRule, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rule) throw new NotFoundException('Rule version not found');
      assertUnitAccess(user, rule.businessUnitId);
      if (rule.createdBy !== user.id && !hasPermission(user, Permission.RULES_EDIT_ALLOCATION)) {
        throw new ForbiddenException('Only the author or a Partner can withdraw this version.');
      }
      if (rule.status !== S.DRAFT && rule.status !== S.PENDING_APPROVAL) {
        throw new BadRequestException('Only a draft or pending version can be withdrawn.');
      }
      await m.update(AllocationRule, id, { status: S.WITHDRAWN, updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  // --- preview -------------------------------------------------------------

  /** Σ(credit − debit) on income accounts, per day, for one unit. */
  async incomeByDay(m: EntityManager, unitId: string, from: string, to: string): Promise<Map<string, bigint>> {
    const rows: { date: string; net: string }[] = await m.query(
      `SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS date, SUM(l.credit - l.debit) AS net
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l."entryId"
         JOIN accounts a ON a.id = l."accountId"
        WHERE a.type = 'INCOME' AND l."businessUnitId" = $1
          AND e."entryDate" BETWEEN $2 AND $3
        GROUP BY e."entryDate"`,
      [unitId, from, to],
    );
    return new Map(rows.map((r) => [r.date, toPaisa(String(r.net))]));
  }

  /**
   * "Safe to experiment with" (plan Part 04): what a proposed rule would do
   * to a sample amount, and to the last N days of real income compared with
   * the rules that actually applied on those days.
   */
  async preview(dto: PreviewAllocationRuleDto, user: AuthenticatedUser) {
    assertUnitAccess(user, dto.businessUnitId);
    const m = this.dataSource.manager;
    let input: RuleInput;
    try {
      input = await this.resolve(m, dto.businessUnitId, dto.tranches);
    } catch (err) {
      return { problems: [(err as Error).message], sample: null, history: null };
    }
    const problems = ruleViolations(input);
    if (problems.length) return { problems, sample: null, history: null };

    const sampleGross = toPaisa(dto.sampleAmount ?? '100000');
    const sample = allocate(sampleGross, input);

    const days = dto.days ?? 30;
    const to = businessDate();
    const from = addDays(to, -(days - 1));
    const income = await this.incomeByDay(m, dto.businessUnitId, from, to);

    const proposed = new Map<string, { label: string; amount: bigint }>();
    const actual = new Map<string, { label: string; amount: bigint }>();
    const add = (map: typeof proposed, key: string, label: string, amount: bigint) => {
      const cur = map.get(key);
      map.set(key, { label, amount: (cur?.amount ?? 0n) + amount });
    };

    let total = 0n;
    let unruled = 0n;
    const ruleCache = new Map<string, RuleInput | null>();
    for (const [date, gross] of [...income.entries()].sort()) {
      if (gross === 0n) continue;
      total += gross;
      for (const b of allocate(gross, input).byKey) add(proposed, b.key, b.label, b.amount);

      const rule = await this.effectiveRule(m, dto.businessUnitId, date);
      const cacheKey = rule?.id ?? 'none';
      if (!ruleCache.has(cacheKey)) ruleCache.set(cacheKey, rule ? this.toRuleInput(rule) : null);
      const current = ruleCache.get(cacheKey);
      if (!current) {
        unruled += gross;
        continue;
      }
      for (const b of allocate(gross, current).byKey) add(actual, b.key, b.label, b.amount);
    }

    const keys = [...new Set([...proposed.keys(), ...actual.keys()])];
    return {
      problems: [],
      sample: {
        gross: fromPaisa(sampleGross),
        lines: sample.lines.map((l) => ({
          tranche: input.tranches[l.tranche].name,
          label: l.label,
          key: l.key,
          percentOfIncome: l.percentOfIncome,
          amount: fromPaisa(l.amount),
        })),
      },
      history: {
        from,
        to,
        days,
        daysWithIncome: [...income.values()].filter((v) => v !== 0n).length,
        totalIncome: fromPaisa(total),
        /** Income on days no approved rule covered — not in the "current" column. */
        unruledIncome: fromPaisa(unruled),
        targets: keys.map((key) => {
          const p = proposed.get(key)?.amount ?? 0n;
          const a = actual.get(key)?.amount ?? 0n;
          return {
            key,
            label: proposed.get(key)?.label ?? actual.get(key)?.label ?? key,
            current: fromPaisa(a),
            proposed: fromPaisa(p),
            difference: fromPaisa(p - a),
          };
        }),
      },
    };
  }
}
