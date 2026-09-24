import { DataSource, EntityManager } from 'typeorm';
import {
  AllocationMethod,
  AllocationRuleStatus,
  AllocationTargetType,
} from '@multizoo/types';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import { Account } from '../../app/modules/accounts/entities/account.entity';
import { Partner } from '../../app/modules/allocation/entities/partner.entity';
import {
  AllocationLine,
  AllocationRule,
  AllocationTranche,
} from '../../app/modules/allocation/entities/allocation-rule.entity';
import {
  ensurePartnerEquity,
  ensurePartnerReserve,
  ensureReserveOffset,
  isBucketReserve,
} from '../../app/modules/accounts/reserves';
import { ruleViolations } from '../../app/modules/allocation/allocation-math';

/**
 * Partners, each unit's Earmarked Funds offset, and the allocation rules
 * in force today — transcribed from the FORMULAS in `Sample cash flow.xlsx`
 * → Formula (row 1534 onwards, effective 1 Jan 2026), not from the column
 * headers, which have drifted (e.g. Multi Zoo's header says "Salary
 * Reserve 40%"; the formula is 30%). See docs/module-03-income-allocation.md.
 *
 * These are STARTING rules for the Phase 0 sign-off with the partners.
 * Idempotent: a unit that already has any rule version is left alone.
 */

const PARTNERS = [
  { shortName: 'MIK', name: 'Ismail Khan', notes: '"MIK Profit" columns on the Formula sheet.' },
  { shortName: 'MQK', name: 'Qasim Khan', notes: '"MQK Profit" columns on the Formula sheet.' },
  { shortName: 'HAIDER', name: 'Haider', notes: 'Third partner in Jungle Joys ("Haider\'s Profit 1/3 of 10%").' },
];

type LineSeed = [target: string, weight: string];
type TrancheSeed = { name: string; share: string; method: AllocationMethod; lines: LineSeed[] };

const { PERCENT, PARTS } = AllocationMethod;
const EFFECTIVE_FROM = '2026-01-01';

/** Partner lines use the partner's short name; everything else is a reserve bucket. */
const RULES: Record<string, { source: string; tranches: TrancheSeed[] }> = {
  ZOO: {
    source: 'Formula!C1534:N1534 — =(B*30%) … =(B*11%*70%), =(B*11%*30%)',
    tranches: [
      {
        name: 'Reserves',
        share: '89',
        method: PARTS,
        lines: [
          ['Salary', '30'], ['Marketing', '3'], ['Medicine', '3'], ['Development', '11'], ['Utilities', '7'],
          ['Feed', '25'], ['Transport', '1'], ['Maintenance', '3'], ['Capital', '5'], ['Employee Relief', '1'],
        ],
      },
      { name: 'Partners', share: '11', method: PERCENT, lines: [['MIK', '70'], ['MQK', '30']] },
    ],
  },
  CAFE: {
    source: 'Formula!R:AD — =(Q*90%)*19% … =(Q*8/100)*50% (values of row 1786)',
    tranches: [
      {
        name: 'Operations & reserves',
        share: '90',
        method: PERCENT,
        lines: [
          ['Salary', '19'], ['Marketing', '1'], ['Fuel', '7'], ['Utilities', '3'], ['Rent', '5'],
          ['Stock', '43'], ['Oil', '7'], ['Transport', '2'], ['Maintenance', '5'], ['Capital', '8'],
        ],
      },
      { name: 'Employee relief', share: '2', method: PERCENT, lines: [['Employee Relief', '100']] },
      { name: 'Partners', share: '8', method: PERCENT, lines: [['MIK', '50'], ['MQK', '50']] },
    ],
  },
  GIFT: {
    source: 'Formula!AH3:AS3 — =(AG*90%)*25% …, =(AG*10%)/3 per partner',
    tranches: [
      {
        name: 'Operations & reserves',
        share: '90',
        method: PERCENT,
        lines: [
          ['Salary', '25'], ['Utilities', '7'], ['Stock', '50'], ['Rent', '2'], ['Transport', '1'],
          ['Maintenance', '3'], ['Capital', '10'], ['Employee Relief', '1'], ['Marketing', '1'],
        ],
      },
      { name: 'Partners', share: '10', method: PARTS, lines: [['MIK', '1'], ['MQK', '1'], ['HAIDER', '1']] },
    ],
  },
  JOYLAND: {
    source: 'Formula!AW3:BE3 — =AV*0.8*0.25 …, capital =(AV*0.8*0.35)+AV*0.2',
    tranches: [
      {
        name: 'Operations & reserves',
        share: '80',
        method: PERCENT,
        lines: [
          ['Salary', '25'], ['Utilities', '10'], ['Stock', '17'], ['Rent', '2'], ['Transport', '1'],
          ['Maintenance', '8'], ['Capital', '35'], ['Employee Relief', '1'], ['Marketing', '1'],
        ],
      },
      { name: 'Capital (development)', share: '20', method: PERCENT, lines: [['Capital', '100']] },
    ],
  },
};

async function seedPartners(m: EntityManager) {
  let created = 0;
  const byShort = new Map<string, Partner>();
  for (const seed of PARTNERS) {
    let partner = await m.findOne(Partner, { where: { shortName: seed.shortName }, withDeleted: true });
    if (!partner) {
      partner = await m.save(m.create(Partner, { ...seed, userId: null }));
      created++;
    }
    await ensurePartnerEquity(m, partner);
    byShort.set(seed.shortName, partner);
  }
  console.log(`Partners: ${created} created`);
  return byShort;
}

async function seedRule(m: EntityManager, unit: BusinessUnit, partners: Map<string, Partner>) {
  const seed = RULES[unit.code];
  if (!seed) return false;
  if (await m.count(AllocationRule, { where: { businessUnitId: unit.id } })) return false;

  const accounts = await m.find(Account, { where: { businessUnitId: unit.id }, relations: { accountClass: true } });
  const reserveFor = (bucket: string) => {
    const a = accounts.find((x) => isBucketReserve(x) && x.name.toUpperCase() === `${bucket} RESERVE`.toUpperCase());
    if (!a) throw new Error(`${unit.code} has no "${bucket} Reserve" account — re-run the ledger seed.`);
    return a;
  };

  const tranches = seed.tranches.map((t, ti) =>
    m.create(AllocationTranche, {
      sortOrder: ti + 1,
      name: t.name,
      share: t.share,
      method: t.method,
      lines: t.lines.map(([target, weight], li) => {
        const partner = partners.get(target);
        return m.create(AllocationLine, {
          sortOrder: li + 1,
          targetType: partner ? AllocationTargetType.PARTNER : AllocationTargetType.RESERVE,
          accountId: partner ? null : reserveFor(target).id,
          partnerId: partner ? partner.id : null,
          weight,
        });
      }),
    }),
  );

  const problems = ruleViolations({
    tranches: seed.tranches.map((t) => ({
      name: t.name,
      share: t.share,
      method: t.method,
      lines: t.lines.map(([key, weight]) => ({ key, label: key, weight })),
    })),
  });
  if (problems.length) throw new Error(`${unit.code} seed rule is invalid: ${problems.join(' ')}`);

  await m.save(
    m.create(AllocationRule, {
      businessUnitId: unit.id,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      status: AllocationRuleStatus.APPROVED,
      note: `Seeded from the workbook (${seed.source}). Confirm with the partners before go-live — the Formula sheet's column headers disagree with its formulas.`,
      createdBy: null,
      updatedBy: null,
      submittedAt: null,
      submittedBy: null,
      reviewedAt: new Date(),
      reviewedBy: null,
      reviewNote: 'Seed data — pending Phase 0 sign-off.',
      tranches,
    }),
  );

  for (const [target] of seed.tranches.flatMap((t) => t.lines)) {
    const partner = partners.get(target);
    if (partner) await ensurePartnerReserve(m, unit, partner);
  }
  return true;
}

export async function seedAllocation(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    const partners = await seedPartners(m);
    const units = await m.find(BusinessUnit, { order: { code: 'ASC' } });
    let rules = 0;
    for (const unit of units) {
      const own = await m.find(Account, { where: { businessUnitId: unit.id }, relations: { accountClass: true } });
      // Units without reserves (the holding company) get an offset only if one is ever needed.
      if (own.some(isBucketReserve)) await ensureReserveOffset(m, unit);
      if (await seedRule(m, unit, partners)) rules++;
    }
    console.log(`Allocation rules: ${rules} created (effective ${EFFECTIVE_FROM})`);
  });
}
