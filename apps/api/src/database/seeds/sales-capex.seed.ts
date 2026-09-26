import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CapexFunding, CapexStatus, FootfallKind, SalesPricing } from '@multizoo/types';
import { Account } from '../../app/modules/accounts/entities/account.entity';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import { SalesEvent, SalesItem } from '../../app/modules/sales/entities/sales.entity';
import { CapexItem } from '../../app/modules/capex/entities/capex.entity';
import { parsePaybackMonths } from '../../app/modules/capex/capex-math';

/**
 * Module 7 starting data (docs/module-07-sales-capex-campaigns.md):
 *
 * - Multi Zoo's price list: the 33 ticket types of `sample income.xlsx →
 *   Ticket sales` (Z6:Z38), each credited to the income account it is
 *   (entry and school tickets to 4100 Ticket Sales, rides to 4400, rentals
 *   and fees to 4900). A rate is seeded only where the name carries one
 *   (Jumbo Ticket 370, School Trip 450) or the Eid sheet gives one (adult
 *   290, kids 190 in 2024) — the rest are typed at entry until the
 *   accountant fills the price list in.
 * - The other units' sheets keep a day's total only: one amount-only item
 *   each (Cafe sales, Joy Land sales, Gift shop sales, …).
 * - Eid-ul-Fitr and Eid-ul-Azha, 10 days each, with Pakistan's first day of
 *   Eid for 2022–2026 — the `Eid Sales Comperison` periods.
 * - Outside production only: the `Dir Invst Zoo` log as register-only
 *   capex items (they aren't posted — their payments are history).
 *
 * Idempotent: only adds what's missing.
 */
type ItemSeed = [name: string, category: string, account: string, rate: string | null, footfall?: FootfallKind];

const A = FootfallKind.ADULT;
const K = FootfallKind.KID;
const TICKETS = 'Ticket Sales';
const RIDES = 'Ride & Attraction Sales';
const OTHER = 'Other Income';

const ZOO_ITEMS: ItemSeed[] = [
  ['Entry Ticket Adult', 'Entry', TICKETS, '290', A],
  ['Entry Ticket Kids', 'Entry', TICKETS, '190', K],
  ['Jumbo Ticket 370', 'Entry', TICKETS, '370'],
  ['Golden Ticket Plus Enrty', 'Entry', TICKETS, null],
  ['Member Ship Adult', 'Membership', TICKETS, null],
  ['Member Ship Kids', 'Membership', TICKETS, null],
  ['School Adult Entry 180', 'School', TICKETS, '180', A],
  ['School Kids Entry 180', 'School', TICKETS, '180', K],
  ['School Trip 450', 'School', TICKETS, '450'],
  ['School Trip Staff 150', 'School', TICKETS, '150'],
  ['Deal 1', 'Deals', TICKETS, null],
  ['Deal 2 Plus Entry', 'Deals', TICKETS, null],
  ['Deal 3', 'Deals', TICKETS, null],
  ['Deal 3 Plus Entry', 'Deals', TICKETS, null],
  ['Deal 4 Plus Entry', 'Deals', TICKETS, null],
  ['Alpaka Cage Entry', 'Entry', TICKETS, null],
  ['Birds Feed', 'Animal feed', TICKETS, null],
  ['Deer Feed', 'Animal feed', TICKETS, null],
  ['Fish Feed', 'Animal feed', TICKETS, null],
  ['Monkey Feed', 'Animal feed', TICKETS, null],
  ['Tiger Feed', 'Animal feed', TICKETS, null],
  ['Birds Picture', 'Animal feed', TICKETS, null],
  ['Pony Ride', 'Rides', RIDES, null],
  ['Electric Ride', 'Rides', RIDES, null],
  ['Jumping Castle', 'Rides', RIDES, null],
  ['Bolan Rental', 'Rentals', OTHER, null],
  ['Cafe Rent', 'Rentals', OTHER, null],
  ['Fire Gun Rent', 'Rentals', OTHER, null],
  ['Photographer Rent', 'Rentals', OTHER, null],
  ['Pony Rental', 'Rentals', OTHER, null],
  ['Doctor Fee', 'Fees', OTHER, null],
  ['Employee Charges', 'Fees', OTHER, null],
  ['Washroom Ticket', 'Fees', OTHER, null],
];

/** Units whose sheets keep a day's total: one amount-only item each. */
const DAY_TOTALS: [unit: string, name: string, account: string][] = [
  ['CAFE', 'Cafe sales', 'Cafe Sales'],
  ['JOYLAND', 'Joy Land sales', RIDES],
  ['GIFT', 'Gift shop sales', 'Retail Sales'],
  ['PETS', 'Pets accessories sales', 'Retail Sales'],
  ['MBF', 'Livestock & bird sales', 'Livestock Sales'],
];

const EVENTS: { name: string; notes: string; occurrences: [number, string][] }[] = [
  {
    name: 'Eid-ul-Fitr',
    notes: 'Day 1–10 from the first day of Eid in Pakistan, as on the Eid Sales Comperison sheet. Confirm each year’s date with the accountant (moon sighting).',
    occurrences: [[2022, '2022-05-03'], [2023, '2023-04-22'], [2024, '2024-04-10'], [2025, '2025-03-31'], [2026, '2026-03-21']],
  },
  {
    name: 'Eid-ul-Azha',
    notes: 'Day 1–10 from the first day of Eid in Pakistan. Confirm each year’s date with the accountant (moon sighting).',
    occurrences: [[2022, '2022-07-10'], [2023, '2023-06-29'], [2024, '2024-06-17'], [2025, '2025-06-07'], [2026, '2026-05-27']],
  },
];

/** `Dir Invst Zoo` A2:E10 (dates from the sheet's serials 45620 … 45642). */
const INVESTMENT_LOG: [date: string, amount: string, purpose: string, roi: string, nature: string][] = [
  ['2024-11-24', '219000', 'Boxing machine', '8 Months', 'Entertainment'],
  ['2024-11-25', '500000', 'Claw Machine', '8 Months', 'Entertainment'],
  ['2024-11-26', '500000', 'Riding Machine', '5 Months', 'Entertainment'],
  ['2024-11-27', '200000', 'Hammer Machine', '8 Months', 'Entertainment'],
  ['2024-11-28', '2700000', 'Train', '5 Months', 'Entertainment'],
  ['2024-11-29', '1200000', 'Take away cafe', '6 Months', 'Food'],
  ['2024-11-30', '600000', 'Event Booking Area', '8 Months', 'Service'],
  ['2024-12-01', '20000', 'Coffee take away', '2 months', 'Food'],
  ['2024-12-16', '27000', 'Madam kiran', '', 'Ismail'],
];

export async function seedSalesCapex(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    const income = async (name: string) => m.findOne(Account, { where: { name, businessUnitId: IsNull() } });
    const unit = (code: string) => m.findOne(BusinessUnit, { where: { code } });

    const zoo = await unit('ZOO');
    if (zoo) {
      const added = await seedItems(m, zoo, ZOO_ITEMS, income);
      console.log(`Sales: Multi Zoo price list — ${added} of ${ZOO_ITEMS.length} ticket types added.`);
    }
    for (const [code, name, account] of DAY_TOTALS) {
      const u = await unit(code);
      if (u) await seedItems(m, u, [[name, 'Day total', account, null]], income, SalesPricing.AMOUNT);
    }

    for (const e of EVENTS) {
      if (await m.findOne(SalesEvent, { where: { name: e.name }, withDeleted: true })) continue;
      await m.save(
        m.create(SalesEvent, {
          name: e.name,
          days: 10,
          occurrences: e.occurrences.map(([year, startDate]) => ({ year, startDate })),
          notes: e.notes,
        }),
      );
      console.log(`Sales: event ${e.name} seeded (2022–2026).`);
    }

    if (process.env.NODE_ENV === 'production' || process.env.SEED_SAMPLE_CAPEX === 'false') return;
    if (!zoo || (await m.count(CapexItem, { withDeleted: true })) > 0) return;
    await m.save(
      INVESTMENT_LOG.map(([purchaseDate, amount, name, roi, nature]) =>
        m.create(CapexItem, {
          businessUnitId: zoo.id,
          purchaseDate,
          name,
          nature,
          amount,
          paybackMonths: parsePaybackMonths(roi),
          funding: CapexFunding.NOT_RECORDED,
          accountId: null,
          journalEntryId: null,
          earningItemIds: [],
          status: CapexStatus.ACTIVE,
          note:
            nature === 'Ismail'
              ? 'On the sheet with nature “Ismail” — looks like a personal payment for MIK rather than capex. Confirm, and move it to his loan account if so.'
              : 'From Dir Invst Zoo (sample data — the real register comes in at cutover).',
        }),
      ),
    );
    console.log(`Capex: ${INVESTMENT_LOG.length} items from Dir Invst Zoo (register only, 5,966,000).`);
  });
}

async function seedItems(
  m: EntityManager,
  unit: BusinessUnit,
  items: ItemSeed[],
  income: (name: string) => Promise<Account | null>,
  pricing = SalesPricing.PER_UNIT,
): Promise<number> {
  let added = 0;
  for (const [i, [name, category, accountName, rate, footfall]] of items.entries()) {
    if (await m.findOne(SalesItem, { where: { businessUnitId: unit.id, name }, withDeleted: true })) continue;
    const account = await income(accountName);
    if (!account) {
      console.log(`Sales: income account “${accountName}” is missing — ${name} skipped.`);
      continue;
    }
    await m.save(
      m.create(SalesItem, {
        businessUnitId: unit.id,
        name,
        category,
        incomeAccountId: account.id,
        pricing,
        defaultRate: rate,
        footfall: footfall ?? FootfallKind.NONE,
        sortOrder: i,
      }),
    );
    added++;
  }
  return added;
}
