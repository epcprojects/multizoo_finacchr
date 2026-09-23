import { DataSource } from 'typeorm';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import {
  BUSINESS_UNIT_SEED,
  ensureGroupAccounts,
  provisionUnitAccounts,
} from '../../app/modules/accounts/chart-of-accounts';

/**
 * The six operating units + holding company and the standard chart of
 * accounts (docs/module-02-ledger-foundation.md). Idempotent: units and
 * accounts are matched by code and only ever added, never overwritten — so
 * re-running after the accountant renames "Bank Account" to the real bank
 * leaves their name alone.
 */
export async function seedLedger(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    const groupCreated = await ensureGroupAccounts(m);
    console.log(`Group-wide accounts: ${groupCreated} created`);

    for (const seed of BUSINESS_UNIT_SEED) {
      let unit = await m.findOne(BusinessUnit, { where: { code: seed.code }, withDeleted: true });
      if (!unit) {
        unit = await m.save(
          m.create(BusinessUnit, {
            code: seed.code,
            name: seed.name,
            type: seed.type,
            description: seed.description,
          }),
        );
        console.log(`Created business unit: ${seed.code} ${seed.name}`);
      }
      const created = await provisionUnitAccounts(m, unit, seed.reserves);
      console.log(`  -> ${created.length} unit accounts created`);
    }
  });
}
