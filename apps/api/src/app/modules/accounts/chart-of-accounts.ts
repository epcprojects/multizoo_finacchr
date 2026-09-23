import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import {
  AccountClassUnitRule,
  AccountType,
  BusinessUnitType,
  SystemAccountClass,
} from '@multizoo/types';
import { Account } from './entities/account.entity';
import { AccountClass } from './entities/account-class.entity';
import { ChartSettings } from './entities/chart-settings.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { buildCode, nextNumber, parseNumber } from './account-codes';

/**
 * The day-one chart of accounts, built from the audited workbooks (see
 * docs/module-02-ledger-foundation.md). Everything here is a STARTING
 * point: classes, numbering and accounts are all editable afterwards from
 * Accounts → Settings. Seeding is idempotent and never overwrites an edit.
 */

export const OPENING_BALANCE_EQUITY_KEY = 'OPENING_BALANCE_EQUITY';

const C = SystemAccountClass;
const R = AccountClassUnitRule;

type ClassSeed = Omit<AccountClass, keyof BaseEntity | 'isSystem'>;

export const SYSTEM_CLASS_SEED: ClassSeed[] = [
  { key: C.CASH, name: 'Cash', type: AccountType.ASSET, unitRule: R.UNIT_REQUIRED, codeStart: 1100, codeEnd: 1199, isLiquid: true, isReserve: false, isReconcilable: true, provisionForNewUnits: true, defaultAccountName: 'Cash in Hand', sortOrder: 10, description: 'Physical cash held at a unit.' },
  { key: C.BANK, name: 'Bank', type: AccountType.ASSET, unitRule: R.UNIT_REQUIRED, codeStart: 1200, codeEnd: 1299, isLiquid: true, isReserve: false, isReconcilable: true, provisionForNewUnits: true, defaultAccountName: 'Bank Account', sortOrder: 20, description: "A unit's share of a bank account." },
  { key: C.WALLET, name: 'Mobile wallet', type: AccountType.ASSET, unitRule: R.UNIT_REQUIRED, codeStart: 1300, codeEnd: 1399, isLiquid: true, isReserve: false, isReconcilable: true, provisionForNewUnits: true, defaultAccountName: 'Easypaisa Wallet', sortOrder: 30, description: 'Easypaisa / JazzCash balances.' },
  { key: C.RECEIVABLE, name: 'Receivable', type: AccountType.ASSET, unitRule: R.EITHER, codeStart: 1400, codeEnd: 1499, isLiquid: false, isReserve: false, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 40, description: 'Money owed to the business.' },
  { key: C.RESERVE, name: 'Reserve', type: AccountType.ASSET, unitRule: R.UNIT_REQUIRED, codeStart: 1500, codeEnd: 1999, isLiquid: false, isReserve: true, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 50, description: 'Earmarked cash — moved only by the income allocation engine.' },
  { key: C.PAYABLE, name: 'Payable', type: AccountType.LIABILITY, unitRule: R.EITHER, codeStart: 2100, codeEnd: 2999, isLiquid: false, isReserve: false, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 60, description: 'Money the business owes.' },
  { key: C.EQUITY, name: 'Equity', type: AccountType.EQUITY, unitRule: R.EITHER, codeStart: 3100, codeEnd: 3999, isLiquid: false, isReserve: false, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 70, description: 'What belongs to the partners.' },
  { key: C.INCOME, name: 'Income', type: AccountType.INCOME, unitRule: R.GROUP_ONLY, codeStart: 4100, codeEnd: 4999, isLiquid: false, isReserve: false, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 80, description: 'Money earned. Shared by all units; each entry records the unit.' },
  { key: C.EXPENSE, name: 'Expense', type: AccountType.EXPENSE, unitRule: R.GROUP_ONLY, codeStart: 5100, codeEnd: 5999, isLiquid: false, isReserve: false, isReconcilable: false, provisionForNewUnits: false, defaultAccountName: null, sortOrder: 90, description: 'Money spent. Shared by all units; each entry records the unit.' },
];

type GroupAccountSeed = {
  num: number;
  name: string;
  classKey: SystemAccountClass;
  description?: string;
  systemKey?: string;
  children?: { num: number; name: string; description?: string }[];
};

/** Group-wide accounts. Parents with children are non-postable headings. */
export const GROUP_ACCOUNTS: GroupAccountSeed[] = [
  { num: 1400, name: 'Accounts Receivable', classKey: C.RECEIVABLE, description: 'Money owed to the group by customers or other parties.' },
  { num: 2100, name: 'Accounts Payable (Suppliers)', classKey: C.PAYABLE, description: 'Unpaid supplier bills — e.g. the chicken and green-fodder suppliers on the Payable & Receivable sheet.' },
  { num: 3900, name: 'Opening Balance Equity', classKey: C.EQUITY, systemKey: OPENING_BALANCE_EQUITY_KEY, description: 'The other side of every opening balance when a ledger is first brought into the system.' },
  { num: 4100, name: 'Ticket Sales', classKey: C.INCOME, description: 'Multi Zoo gate.' },
  { num: 4200, name: 'Cafe Sales', classKey: C.INCOME, description: 'Panda Cafe and Mini Panda Cafe.' },
  { num: 4300, name: 'Retail Sales', classKey: C.INCOME, description: 'Jungle Joys, Pets Accessories.' },
  { num: 4400, name: 'Ride & Attraction Sales', classKey: C.INCOME, description: 'Joy Land.' },
  { num: 4500, name: 'Livestock Sales', classKey: C.INCOME, description: 'MBF.' },
  { num: 4900, name: 'Other Income', classKey: C.INCOME },
  {
    num: 5100,
    name: 'Animal Feed & Medicine',
    classKey: C.EXPENSE,
    children: [
      { num: 5110, name: 'Carnivores' },
      { num: 5120, name: 'Herbivores' },
      { num: 5130, name: 'Birds' },
      { num: 5140, name: 'Monkeys' },
      { num: 5150, name: 'Fish' },
      { num: 5160, name: 'Medicine' },
    ],
  },
  { num: 5200, name: 'Salaries & Wages', classKey: C.EXPENSE },
  { num: 5300, name: 'Utilities', classKey: C.EXPENSE },
  { num: 5400, name: 'Maintenance', classKey: C.EXPENSE },
  {
    num: 5500,
    name: 'Transport & Fuel',
    classKey: C.EXPENSE,
    children: [
      { num: 5510, name: 'Transport' },
      { num: 5520, name: 'Fuel' },
    ],
  },
  { num: 5600, name: 'Marketing', classKey: C.EXPENSE },
  {
    num: 5700,
    name: 'Stock & Purchases',
    classKey: C.EXPENSE,
    children: [
      { num: 5710, name: 'Stock' },
      { num: 5720, name: 'Cooking Oil' },
    ],
  },
  { num: 5750, name: 'Rent', classKey: C.EXPENSE },
  { num: 5800, name: 'Development & Capital Expenditure', classKey: C.EXPENSE },
  { num: 5850, name: 'Bonus & Employee Relief', classKey: C.EXPENSE },
  { num: 5900, name: 'Bank Charges', classKey: C.EXPENSE },
  { num: 5950, name: 'Miscellaneous', classKey: C.EXPENSE },
  { num: 5990, name: 'Cash Over / Short', classKey: C.EXPENSE, description: 'Where a cash-count variance is written off after reconciliation.' },
];

/** Every reserve bucket name found across the Formula sheet — the wizard's picker. */
export const RESERVE_BUCKET_CATALOG = [
  'Salary', 'Marketing', 'Medicine', 'Development', 'Utilities', 'Feed', 'Transport',
  'Maintenance', 'Capital', 'Employee Relief', 'Fuel', 'Rent', 'Stock', 'Oil', 'Assets',
] as const;

const RETAIL_RESERVES = [
  'Salary', 'Utilities', 'Stock', 'Rent', 'Transport', 'Maintenance', 'Capital', 'Employee Relief', 'Marketing',
];

type UnitSeed = {
  code: string;
  name: string;
  type: BusinessUnitType;
  description: string;
  reserves: string[];
  /** Overrides the classes marked provisionForNewUnits. */
  classKeys?: SystemAccountClass[];
};

/** The six operating units + holding company. PC NUST is eliminated (plan Part 02). */
export const BUSINESS_UNIT_SEED: UnitSeed[] = [
  { code: 'ZOO', name: 'Multi Zoo', type: BusinessUnitType.WILDLIFE_PARK, description: 'Wildlife park — ticketing, feed & medicine by species group.', reserves: ['Salary', 'Marketing', 'Medicine', 'Development', 'Utilities', 'Feed', 'Transport', 'Maintenance', 'Capital', 'Employee Relief'] },
  { code: 'CAFE', name: 'Panda Cafe', type: BusinessUnitType.FOOD_BEVERAGE, description: 'Panda Cafe and Mini Panda Cafe outlets.', reserves: ['Salary', 'Marketing', 'Fuel', 'Utilities', 'Rent', 'Stock', 'Oil', 'Transport', 'Maintenance', 'Capital', 'Employee Relief'] },
  { code: 'GIFT', name: 'Jungle Joys Gift Shop', type: BusinessUnitType.RETAIL, description: 'Gift shop retail sales.', reserves: RETAIL_RESERVES },
  { code: 'JOYLAND', name: 'Joy Land', type: BusinessUnitType.ENTERTAINMENT, description: 'Rides & attractions.', reserves: RETAIL_RESERVES },
  { code: 'PETS', name: 'Pets Accessories', type: BusinessUnitType.RETAIL, description: 'Pet accessories retail.', reserves: RETAIL_RESERVES },
  { code: 'MBF', name: 'MBF Breeding Unit', type: BusinessUnitType.LIVESTOCK, description: 'Livestock and bird breeding — sales and purchases.', reserves: ['Assets', 'Utilities', 'Stock', 'Salary', 'Maintenance', 'Feed'] },
  { code: 'ZCO', name: 'Z & Co (Holding)', type: BusinessUnitType.HOLDING, description: 'Holding company — consolidates bank balances across units.', reserves: [], classKeys: [C.BANK] },
];

// ---------------------------------------------------------------------------

export async function ensureAccountClasses(m: EntityManager): Promise<number> {
  let created = 0;
  for (const seed of SYSTEM_CLASS_SEED) {
    const exists = await m.findOne(AccountClass, { where: { key: seed.key }, withDeleted: true });
    if (exists) continue;
    await m.save(m.create(AccountClass, { ...seed, isSystem: true }));
    created++;
  }
  return created;
}

export async function getChartSettings(m: EntityManager): Promise<ChartSettings> {
  let settings = await m.findOne(ChartSettings, { where: { id: 1 } });
  if (!settings) {
    settings = await m.save(
      m.create(ChartSettings, {
        id: 1,
        unitCodePattern: '{UNIT}-{NUM}',
        groupCodePattern: '{NUM}',
        codeStep: 10,
        updatedAt: null,
        updatedBy: null,
      }),
    );
  }
  return settings;
}

/**
 * Picks the next code for a new account from configuration: the unit or
 * group pattern, the class's range (or the band just under a numbered
 * heading), and the step.
 */
export async function generateAccountCode(
  m: EntityManager,
  cls: AccountClass,
  unit: BusinessUnit | null,
  parent: Account | null,
): Promise<string> {
  const settings = await getChartSettings(m);
  const pattern = unit ? settings.unitCodePattern : settings.groupCodePattern;
  const allCodes = (await m.find(Account, { select: { code: true }, withDeleted: true })).map((a) => a.code);
  const taken = allCodes
    .map((code) => parseNumber(pattern, code, unit?.code))
    .filter((n): n is number => n !== null);

  let start = cls.codeStart;
  let end = cls.codeEnd;
  const parentNum = parent ? parseNumber(pattern, parent.code, unit?.code) : null;
  if (parentNum !== null) {
    // Children live in the 99 numbers after their heading (5100 → 5101–5199).
    start = parentNum + 1;
    end = parentNum + 99;
    // A heading's first child sits one step in (5100 → 5110).
    const firstChild = parentNum + settings.codeStep;
    if (!taken.some((n) => n > parentNum && n <= end) && firstChild <= end) start = firstChild;
  }

  const num = nextNumber(taken, start, end, settings.codeStep);
  if (num === null) {
    throw new BadRequestException(
      `No free codes left in ${cls.name}'s range (${start}–${end}). Widen the range in Accounts → Settings or enter a code manually.`,
    );
  }
  const code = buildCode(pattern, num, unit?.code);
  if (allCodes.includes(code)) {
    throw new BadRequestException(`Generated code ${code} is already in use — enter a code manually.`);
  }
  return code;
}

async function classByKey(m: EntityManager, key: string): Promise<AccountClass> {
  const cls = await m.findOne(AccountClass, { where: { key } });
  if (!cls) throw new Error(`Account class ${key} is missing — run the seed.`);
  return cls;
}

/**
 * Ensures the group-wide accounts exist. Matched by name within the
 * group-wide chart, so a code or pattern change never causes duplicates.
 */
export async function ensureGroupAccounts(m: EntityManager): Promise<number> {
  const settings = await getChartSettings(m);
  const code = (num: number) => buildCode(settings.groupCodePattern, num);
  let created = 0;

  const findOrCreate = async (
    seed: { num: number; name: string; description?: string; systemKey?: string },
    cls: AccountClass,
    parentId: string | null,
    isPostable: boolean,
  ) => {
    const existing = seed.systemKey
      ? await m.findOne(Account, { where: { systemKey: seed.systemKey }, withDeleted: true })
      : await m.findOne(Account, { where: { name: seed.name, businessUnitId: IsNull(), classId: cls.id }, withDeleted: true });
    if (existing) return existing;
    created++;
    return m.save(
      m.create(Account, {
        code: code(seed.num),
        name: seed.name,
        type: cls.type,
        classId: cls.id,
        businessUnitId: null,
        parentId,
        isPostable,
        isSystem: Boolean(seed.systemKey),
        systemKey: seed.systemKey ?? null,
        description: seed.description ?? null,
      }),
    );
  };

  for (const seed of GROUP_ACCOUNTS) {
    const cls = await classByKey(m, seed.classKey);
    const parent = await findOrCreate(seed, cls, null, !seed.children?.length);
    for (const child of seed.children ?? []) await findOrCreate(child, cls, parent.id, true);
  }
  return created;
}

export async function reserveClass(m: EntityManager): Promise<AccountClass | null> {
  return m.findOne(AccountClass, { where: { isReserve: true, isActive: true }, order: { sortOrder: 'ASC' } });
}

/**
 * Provisions a unit's account set: one account per chosen class (named by
 * the class's defaultAccountName) plus one reserve account per bucket.
 * Idempotent by name within the unit, so re-running only adds what's new.
 */
export async function provisionUnitAccounts(
  m: EntityManager,
  unit: BusinessUnit,
  opts: { classIds: string[]; reserveBuckets: string[] },
  actorId: string | null = null,
): Promise<Account[]> {
  const classes = opts.classIds.length
    ? await m.find(AccountClass, { where: opts.classIds.map((id) => ({ id })), order: { sortOrder: 'ASC' } })
    : [];
  for (const cls of classes) {
    if (cls.unitRule === AccountClassUnitRule.GROUP_ONLY) {
      throw new BadRequestException(`${cls.name} accounts are group-wide and can't be created for a single unit.`);
    }
    if (cls.isReserve) {
      throw new BadRequestException('Reserves are added through the reserve buckets, not as a standard account.');
    }
  }

  const buckets = [...new Set(opts.reserveBuckets.map((b) => b.trim()).filter(Boolean))];
  const resCls = buckets.length ? await reserveClass(m) : null;
  if (buckets.length && !resCls) throw new BadRequestException('No active reserve class is configured.');

  const wanted: { cls: AccountClass; name: string; description: string | null }[] = [
    ...classes.map((cls) => ({ cls, name: cls.defaultAccountName || cls.name, description: null })),
    ...buckets.map((b) => ({ cls: resCls as AccountClass, name: `${b} Reserve`, description: resCls?.description ?? null })),
  ];

  const existing = await m.find(Account, { where: { businessUnitId: unit.id }, withDeleted: true });
  const names = new Set(existing.map((a) => a.name.toUpperCase()));
  const created: Account[] = [];

  // One at a time: each generated code must see the ones just created.
  for (const w of wanted) {
    if (names.has(w.name.toUpperCase())) continue;
    names.add(w.name.toUpperCase());
    created.push(
      await m.save(
        m.create(Account, {
          code: await generateAccountCode(m, w.cls, unit, null),
          name: w.name,
          type: w.cls.type,
          classId: w.cls.id,
          businessUnitId: unit.id,
          parentId: null,
          isPostable: true,
          isSystem: false,
          systemKey: null,
          description: w.description,
          createdBy: actorId,
        }),
      ),
    );
  }
  return created;
}

/** Class ids a new unit gets by default (or the given keys). */
export async function defaultProvisionClassIds(m: EntityManager, keys?: string[]): Promise<string[]> {
  const classes = keys
    ? await m.find(AccountClass, { where: keys.map((key) => ({ key })) })
    : await m.find(AccountClass, { where: { provisionForNewUnits: true, isActive: true } });
  return classes.filter((c) => !c.isReserve && c.unitRule !== AccountClassUnitRule.GROUP_ONLY).map((c) => c.id);
}
