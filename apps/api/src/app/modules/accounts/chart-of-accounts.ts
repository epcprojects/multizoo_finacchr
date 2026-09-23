import { EntityManager } from 'typeorm';
import { AccountSubtype, AccountType, BusinessUnitType } from '@multizoo/types';
import { Account } from './entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';

/**
 * The standard chart of accounts — built from the audited workbooks, not a
 * generic template. See docs/module-02-ledger-foundation.md for the sheet
 * each line comes from. Everything here is a STARTING point: the Accounts
 * screen can rename, add, and deactivate after the Phase 0 CoA workshop.
 */

export const SUBTYPE_TO_TYPE: Record<AccountSubtype, AccountType> = {
  [AccountSubtype.CASH]: AccountType.ASSET,
  [AccountSubtype.BANK]: AccountType.ASSET,
  [AccountSubtype.WALLET]: AccountType.ASSET,
  [AccountSubtype.RESERVE]: AccountType.ASSET,
  [AccountSubtype.RECEIVABLE]: AccountType.ASSET,
  [AccountSubtype.PAYABLE]: AccountType.LIABILITY,
  [AccountSubtype.EQUITY]: AccountType.EQUITY,
  [AccountSubtype.INCOME]: AccountType.INCOME,
  [AccountSubtype.EXPENSE]: AccountType.EXPENSE,
};

/** Subtypes that always belong to exactly one business unit. */
export const UNIT_OWNED_SUBTYPES: readonly AccountSubtype[] = [
  AccountSubtype.CASH,
  AccountSubtype.BANK,
  AccountSubtype.WALLET,
  AccountSubtype.RESERVE,
];

/** Subtypes that are always group-wide — the unit lives on the journal line. */
export const GROUP_ONLY_SUBTYPES: readonly AccountSubtype[] = [
  AccountSubtype.INCOME,
  AccountSubtype.EXPENSE,
];

/** Where auto-generated codes start for each subtype. */
export const SUBTYPE_CODE_BASE: Record<AccountSubtype, number> = {
  [AccountSubtype.CASH]: 1100,
  [AccountSubtype.BANK]: 1200,
  [AccountSubtype.WALLET]: 1300,
  [AccountSubtype.RECEIVABLE]: 1400,
  [AccountSubtype.RESERVE]: 1500,
  [AccountSubtype.PAYABLE]: 2100,
  [AccountSubtype.EQUITY]: 3100,
  [AccountSubtype.INCOME]: 4100,
  [AccountSubtype.EXPENSE]: 5100,
};

/**
 * How far each subtype's numbering band runs past its base. Reserves get
 * 1500–1999: Panda Cafe alone has eleven, spaced by 10.
 */
export function subtypeCodeBandEnd(subtype: AccountSubtype): number {
  return SUBTYPE_CODE_BASE[subtype] + (subtype === AccountSubtype.RESERVE ? 499 : 99);
}

export const OPENING_BALANCE_EQUITY_CODE = '3900';

type GroupAccountSeed = {
  code: string;
  name: string;
  subtype: AccountSubtype;
  description?: string;
  isSystem?: boolean;
  children?: { code: string; name: string; description?: string }[];
};

/** Group-wide accounts. Parents with children are non-postable headers. */
export const GROUP_ACCOUNTS: GroupAccountSeed[] = [
  {
    code: '1400',
    name: 'Accounts Receivable',
    subtype: AccountSubtype.RECEIVABLE,
    description: 'Money owed to the group by customers or other parties.',
  },
  {
    code: '2100',
    name: 'Accounts Payable (Suppliers)',
    subtype: AccountSubtype.PAYABLE,
    description:
      'Unpaid supplier bills — e.g. the chicken and green-fodder suppliers on the Payable & Receivable sheet.',
  },
  {
    code: OPENING_BALANCE_EQUITY_CODE,
    name: 'Opening Balance Equity',
    subtype: AccountSubtype.EQUITY,
    isSystem: true,
    description:
      'The other side of every opening balance when a ledger is first brought into the system.',
  },
  { code: '4100', name: 'Ticket Sales', subtype: AccountSubtype.INCOME, description: 'Multi Zoo gate.' },
  { code: '4200', name: 'Cafe Sales', subtype: AccountSubtype.INCOME, description: 'Panda Cafe and Mini Panda Cafe.' },
  { code: '4300', name: 'Retail Sales', subtype: AccountSubtype.INCOME, description: 'Jungle Joys, Pets Accessories.' },
  { code: '4400', name: 'Ride & Attraction Sales', subtype: AccountSubtype.INCOME, description: 'Joy Land.' },
  { code: '4500', name: 'Livestock Sales', subtype: AccountSubtype.INCOME, description: 'MBF.' },
  { code: '4900', name: 'Other Income', subtype: AccountSubtype.INCOME },
  {
    code: '5100',
    name: 'Animal Feed & Medicine',
    subtype: AccountSubtype.EXPENSE,
    children: [
      { code: '5110', name: 'Carnivores' },
      { code: '5120', name: 'Herbivores' },
      { code: '5130', name: 'Birds' },
      { code: '5140', name: 'Monkeys' },
      { code: '5150', name: 'Fish' },
      { code: '5160', name: 'Medicine' },
    ],
  },
  { code: '5200', name: 'Salaries & Wages', subtype: AccountSubtype.EXPENSE },
  { code: '5300', name: 'Utilities', subtype: AccountSubtype.EXPENSE },
  { code: '5400', name: 'Maintenance', subtype: AccountSubtype.EXPENSE },
  {
    code: '5500',
    name: 'Transport & Fuel',
    subtype: AccountSubtype.EXPENSE,
    children: [
      { code: '5510', name: 'Transport' },
      { code: '5520', name: 'Fuel' },
    ],
  },
  { code: '5600', name: 'Marketing', subtype: AccountSubtype.EXPENSE },
  {
    code: '5700',
    name: 'Stock & Purchases',
    subtype: AccountSubtype.EXPENSE,
    children: [
      { code: '5710', name: 'Stock' },
      { code: '5720', name: 'Cooking Oil' },
    ],
  },
  { code: '5750', name: 'Rent', subtype: AccountSubtype.EXPENSE },
  { code: '5800', name: 'Development & Capital Expenditure', subtype: AccountSubtype.EXPENSE },
  { code: '5850', name: 'Bonus & Employee Relief', subtype: AccountSubtype.EXPENSE },
  { code: '5900', name: 'Bank Charges', subtype: AccountSubtype.EXPENSE },
  { code: '5950', name: 'Miscellaneous', subtype: AccountSubtype.EXPENSE },
  {
    code: '5990',
    name: 'Cash Over / Short',
    subtype: AccountSubtype.EXPENSE,
    description: 'Where a cash-count variance is written off after reconciliation.',
  },
];

/** Every reserve bucket name found across the Formula sheet — the wizard's picker. */
export const RESERVE_BUCKET_CATALOG = [
  'Salary',
  'Marketing',
  'Medicine',
  'Development',
  'Utilities',
  'Feed',
  'Transport',
  'Maintenance',
  'Capital',
  'Employee Relief',
  'Fuel',
  'Rent',
  'Stock',
  'Oil',
  'Assets',
] as const;

const RETAIL_RESERVES = [
  'Salary',
  'Utilities',
  'Stock',
  'Rent',
  'Transport',
  'Maintenance',
  'Capital',
  'Employee Relief',
  'Marketing',
];

type UnitSeed = {
  code: string;
  name: string;
  type: BusinessUnitType;
  description: string;
  reserves: string[];
};

/** The six operating units + holding company. PC NUST is eliminated (plan Part 02). */
export const BUSINESS_UNIT_SEED: UnitSeed[] = [
  {
    code: 'ZOO',
    name: 'Multi Zoo',
    type: BusinessUnitType.WILDLIFE_PARK,
    description: 'Wildlife park — ticketing, feed & medicine by species group.',
    reserves: [
      'Salary', 'Marketing', 'Medicine', 'Development', 'Utilities',
      'Feed', 'Transport', 'Maintenance', 'Capital', 'Employee Relief',
    ],
  },
  {
    code: 'CAFE',
    name: 'Panda Cafe',
    type: BusinessUnitType.FOOD_BEVERAGE,
    description: 'Panda Cafe and Mini Panda Cafe outlets.',
    reserves: [
      'Salary', 'Marketing', 'Fuel', 'Utilities', 'Rent', 'Stock',
      'Oil', 'Transport', 'Maintenance', 'Capital', 'Employee Relief',
    ],
  },
  {
    code: 'GIFT',
    name: 'Jungle Joys Gift Shop',
    type: BusinessUnitType.RETAIL,
    description: 'Gift shop retail sales.',
    reserves: RETAIL_RESERVES,
  },
  {
    code: 'JOYLAND',
    name: 'Joy Land',
    type: BusinessUnitType.ENTERTAINMENT,
    description: 'Rides & attractions.',
    reserves: RETAIL_RESERVES,
  },
  {
    code: 'PETS',
    name: 'Pets Accessories',
    type: BusinessUnitType.RETAIL,
    description: 'Pet accessories retail.',
    reserves: RETAIL_RESERVES,
  },
  {
    code: 'MBF',
    name: 'MBF Breeding Unit',
    type: BusinessUnitType.LIVESTOCK,
    description: 'Livestock and bird breeding — sales and purchases.',
    reserves: ['Assets', 'Utilities', 'Stock', 'Salary', 'Maintenance', 'Feed'],
  },
  {
    code: 'ZCO',
    name: 'Z & Co (Holding)',
    type: BusinessUnitType.HOLDING,
    description: 'Holding company — consolidates bank balances across units.',
    reserves: [],
  },
];

function reserveName(bucket: string) {
  return `${bucket} Reserve`;
}

/**
 * Ensures the group-wide accounts exist. Idempotent: matched by code, never
 * overwrites a name the accountant has since changed.
 */
export async function ensureGroupAccounts(manager: EntityManager): Promise<number> {
  const repo = manager.getRepository(Account);
  let created = 0;

  for (const seed of GROUP_ACCOUNTS) {
    let parent = await repo.findOne({ where: { code: seed.code }, withDeleted: true });
    if (!parent) {
      parent = await repo.save(
        repo.create({
          code: seed.code,
          name: seed.name,
          type: SUBTYPE_TO_TYPE[seed.subtype],
          subtype: seed.subtype,
          businessUnitId: null,
          parentId: null,
          isPostable: !seed.children?.length,
          isSystem: seed.isSystem ?? false,
          description: seed.description ?? null,
        }),
      );
      created++;
    }

    for (const child of seed.children ?? []) {
      const exists = await repo.findOne({ where: { code: child.code }, withDeleted: true });
      if (exists) continue;
      await repo.save(
        repo.create({
          code: child.code,
          name: child.name,
          type: SUBTYPE_TO_TYPE[seed.subtype],
          subtype: seed.subtype,
          businessUnitId: null,
          parentId: parent.id,
          isPostable: true,
          isSystem: false,
          description: child.description ?? null,
        }),
      );
      created++;
    }
  }
  return created;
}

/**
 * Provisions a unit's standard account set: cash / bank / wallet (holding
 * company: bank only) plus the chosen reserve buckets. Idempotent by code,
 * so re-running it after adding a bucket only adds the missing one.
 */
export async function provisionUnitAccounts(
  manager: EntityManager,
  unit: BusinessUnit,
  reserveBuckets: string[],
  actorId: string | null = null,
): Promise<Account[]> {
  const repo = manager.getRepository(Account);

  const liquid: { subtype: AccountSubtype; name: string }[] =
    unit.type === BusinessUnitType.HOLDING
      ? [{ subtype: AccountSubtype.BANK, name: 'Bank Account' }]
      : [
          { subtype: AccountSubtype.CASH, name: 'Cash in Hand' },
          { subtype: AccountSubtype.BANK, name: 'Bank Account' },
          { subtype: AccountSubtype.WALLET, name: 'Easypaisa Wallet' },
        ];

  const wanted = [
    ...liquid.map((l) => ({
      ...l,
      code: `${unit.code}-${SUBTYPE_CODE_BASE[l.subtype]}`,
    })),
    ...[...new Set(reserveBuckets.map((b) => b.trim()).filter(Boolean))].map(
      (bucket, i) => ({
        subtype: AccountSubtype.RESERVE,
        name: reserveName(bucket),
        code: `${unit.code}-${SUBTYPE_CODE_BASE[AccountSubtype.RESERVE] + 10 + i * 10}`,
      }),
    ),
  ];

  const existing = await repo.find({
    where: { businessUnitId: unit.id },
    withDeleted: true,
  });
  const existingNames = new Set(existing.map((a) => a.name.toUpperCase()));
  const existingCodes = new Set(existing.map((a) => a.code));

  const toCreate: Account[] = [];
  for (const w of wanted) {
    if (existingNames.has(w.name.toUpperCase())) continue;
    let code = w.code;
    // A reserve added later may collide with an earlier one's slot.
    let n = parseInt(code.split('-').pop() as string, 10);
    while (existingCodes.has(code)) {
      n += 1;
      code = `${unit.code}-${n}`;
    }
    existingCodes.add(code);
    toCreate.push(
      repo.create({
        code,
        name: w.name,
        type: SUBTYPE_TO_TYPE[w.subtype],
        subtype: w.subtype,
        businessUnitId: unit.id,
        parentId: null,
        isPostable: true,
        isSystem: false,
        description:
          w.subtype === AccountSubtype.RESERVE
            ? 'Earmarked cash — moved only by the income allocation engine.'
            : null,
        createdBy: actorId,
      }),
    );
  }
  return toCreate.length ? repo.save(toCreate) : [];
}
