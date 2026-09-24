import { DataSource } from 'typeorm';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import {
  BUSINESS_UNIT_SEED,
  defaultProvisionClassIds,
  ensureAccountClasses,
  ensureGroupAccounts,
  ensureUnitTypes,
  getChartSettings,
  provisionUnitAccounts,
} from '../../app/modules/accounts/chart-of-accounts';
import { BusinessUnitType } from '../../app/modules/business-units/entities/business-unit-type.entity';

/**
 * Account classes, numbering settings, the six operating units + holding
 * company, and the standard chart of accounts
 * (docs/module-02-ledger-foundation.md). Idempotent: everything is only
 * ever added, never overwritten — re-running after the accountant renames
 * a class or an account leaves their edit alone.
 */
export async function seedLedger(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    console.log(`Account classes: ${await ensureAccountClasses(m)} created`);
    const settings = await getChartSettings(m);
    console.log(`Numbering: unit ${settings.unitCodePattern}, group ${settings.groupCodePattern}, step ${settings.codeStep}`);
    console.log(`Group-wide accounts: ${await ensureGroupAccounts(m)} created`);

    console.log(`Business-unit types: ${await ensureUnitTypes(m)} created`);

    for (const seed of BUSINESS_UNIT_SEED) {
      let unit = await m.findOne(BusinessUnit, { where: { code: seed.code }, withDeleted: true });
      if (!unit) {
        const unitType = await m.findOneOrFail(BusinessUnitType, { where: { key: seed.typeKey } });
        unit = await m.save(
          m.create(BusinessUnit, {
            code: seed.code,
            name: seed.name,
            typeId: unitType.id,
            description: seed.description,
          }),
        );
        console.log(`Created business unit: ${seed.code} ${seed.name}`);
      }
      const classIds = await defaultProvisionClassIds(m, seed.classKeys);
      const created = await provisionUnitAccounts(m, unit, { classIds, reserveBuckets: seed.reserves });
      console.log(`  ${seed.code}: ${created.length} unit accounts created`);
    }
  });
}
