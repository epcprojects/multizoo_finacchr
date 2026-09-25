import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CostCentreCharge, UtilityAllocationMethod } from '@multizoo/types';
import { Account } from '../../app/modules/accounts/entities/account.entity';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import { Partner } from '../../app/modules/allocation/entities/partner.entity';
import { CostCentre } from '../../app/modules/cost-centres/entities/cost-centre.entity';
import { SubMeter, UtilityConnection } from '../../app/modules/utilities/entities/utility.entity';
import { ensurePartnerCounterparties, ensureWriteOffAccount } from '../../app/modules/loans/loans-accounts';

/**
 * Module 6 starting data (docs/module-06-loans-utilities-cost-centres.md):
 *
 * - 5960 Loans & Advances Written Off, and every partner as a counterparty.
 * - Cost centre 342 "Media Office", charged to MIK — the `342 Expense`
 *   sheets' "Paid from Zoo MIK Profit".
 * - The two shared electricity connections on `Sub Meters Details`:
 *   - Zoo Green Meter, paid by Multi Zoo: seven sub-meters, each charged
 *     to the unit it serves, the unmetered rest to Multi Zoo (the rule
 *     from Sep 2023 on; Aug 2023's 70 / 30 with Panda Cafe is on the bill);
 *   - Admin Block IESCO, divided by the ten offices each unit owns
 *     (Z & Co 5.5, Zoo 4.5).
 *
 * Idempotent: only ever adds what's missing, and never overwrites an edit.
 */
export async function seedLoansUtilities(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    const writeOff = await ensureWriteOffAccount(m);
    await ensurePartnerCounterparties(m);
    console.log(`Loans: write-off account ${writeOff.code}; partners are counterparties.`);

    await seedCostCentre(m);

    // One at a time: a transaction's connection runs one query at once.
    const unit = (code: string) => m.findOne(BusinessUnit, { where: { code } });
    const zoo = await unit('ZOO');
    const cafe = await unit('CAFE');
    const mbf = await unit('MBF');
    const zco = await unit('ZCO');
    const utilities = await m.findOne(Account, { where: { name: 'Utilities', businessUnitId: IsNull() } });
    if (!zoo || !cafe || !mbf || !zco || !utilities) {
      console.log('Utilities: the seeded units or the Utilities account are missing — connections skipped.');
      return;
    }

    if (!(await m.findOne(UtilityConnection, { where: { name: 'Zoo Green Meter' }, withDeleted: true }))) {
      const green = await m.save(
        m.create(UtilityConnection, {
          name: 'Zoo Green Meter',
          utility: 'Electricity',
          provider: 'IESCO',
          reference: null,
          businessUnitId: zoo.id,
          method: UtilityAllocationMethod.SUB_METERED,
          standardDays: 30,
          expenseAccountId: utilities.id,
          remainderSplit: [{ businessUnitId: zoo.id, pct: '100' }],
          shares: [],
          notes: 'From Sub Meters Details. Sub-meters were installed on different dates in Jul–Aug 2023; the first cycle pro-rated them to 30 days and split the unmetered units 70% Zoo / 30% Panda Cafe.',
        }),
      );
      const meters: [string, BusinessUnit, string, boolean][] = [
        ['Incubator room', mbf, '2023-08-08', true],
        ['Brooder room', mbf, '2023-08-08', true],
        ['Zoo workers room', zoo, '2023-08-23', true],
        ['Zoo staff room', zoo, '2023-08-23', true],
        ['Panda Cafe', cafe, '2023-08-23', true],
        ['Z & Co Store', zco, '2023-08-08', true],
        ['Z & Co Engineers Room', zco, '2023-08-08', true],
        ['Cafe Bonanza', cafe, '2023-07-26', false],
      ];
      await m.save(
        meters.map(([name, u, installedOn, isActive], i) =>
          m.create(SubMeter, { connectionId: green.id, name, businessUnitId: u.id, installedOn, sortOrder: i, isActive }),
        ),
      );
      console.log('Utilities: Zoo Green Meter seeded with 7 sub-meters (+ Cafe Bonanza, retired).');
    }

    if (!(await m.findOne(UtilityConnection, { where: { name: 'Admin Block IESCO' }, withDeleted: true }))) {
      const both = (z: string, o: string) => ({ [zco.id]: z, [zoo.id]: o });
      await m.save(
        m.create(UtilityConnection, {
          name: 'Admin Block IESCO',
          utility: 'Electricity',
          provider: 'IESCO',
          reference: null,
          businessUnitId: zoo.id,
          method: UtilityAllocationMethod.SHARED,
          standardDays: 30,
          expenseAccountId: utilities.id,
          remainderSplit: [],
          shares: [
            { label: 'CEO Office', weights: both('0.5', '0.5') },
            { label: 'PA Office', weights: both('0.5', '0.5') },
            { label: 'Manager Office', weights: { [zoo.id]: '1' } },
            { label: 'Design Office', weights: { [zco.id]: '1' } },
            { label: 'PM Office', weights: { [zco.id]: '1' } },
            { label: 'Zoo Director Office', weights: { [zoo.id]: '1' } },
            { label: 'Z&C Director Office', weights: { [zco.id]: '1' } },
            { label: 'Procurement Office', weights: { [zco.id]: '1' } },
            { label: 'Accounts Office', weights: both('0.5', '0.5') },
            { label: 'Ticket Ghar', weights: { [zoo.id]: '1' } },
          ],
          notes: 'The Admin Block IESCO Bill Division on Sub Meters Details: each office is owned by Z & Co, the Zoo, or half each. Who receives and pays the bill is to be confirmed (seeded as Multi Zoo).',
        }),
      );
      console.log('Utilities: Admin Block IESCO seeded (Z & Co 5.5 / Zoo 4.5 offices).');
    }
  });
}

async function seedCostCentre(m: EntityManager) {
  if (await m.findOne(CostCentre, { where: { code: '342' }, withDeleted: true })) {
    console.log('Cost centre 342 already exists — skipped.');
    return;
  }
  const mik = await m.findOne(Partner, { where: { shortName: 'MIK' } });
  await m.save(
    m.create(CostCentre, {
      code: '342',
      name: 'Media Office',
      description: 'The 342 media office and influencer team — "Paid from Zoo MIK Profit" on the 342 Expense sheets.',
      chargeTo: mik ? CostCentreCharge.PARTNER : CostCentreCharge.UNIT,
      partnerId: mik?.id ?? null,
      businessUnitId: null,
    }),
  );
  console.log(`Cost centre 342 seeded${mik ? ', charged to MIK' : ' (no MIK partner — charged to the unit)'}.`);
}
