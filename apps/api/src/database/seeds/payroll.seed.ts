import { DataSource } from 'typeorm';
import { BonusSplitMethod, BonusTier, EmploymentType, PayrollPolicyStatus } from '@multizoo/types';
import { PayrollPolicy } from '../../app/modules/payroll/entities/payroll.entity';
import { ensurePayrollAccounts } from '../../app/modules/payroll/payroll-accounts';

/**
 * Module 5 starting data (docs/module-05-payroll-incentives-settlement.md):
 *
 * - The payroll accounts (Salaries Payable, Staff Salary Advances, …),
 *   adopting Module 2's Salaries & Wages and Bonus & Employee Relief.
 * - Payroll policy v1, from 2000-01-01:
 *   - a day's pay is Salary ÷ 30, as the salary sheet's D/30;
 *   - EOBI (5% employer / 1% employee of the PKR 40,700 minimum wage),
 *     income tax (FBR salaried slabs, tax year 2026) and provident fund are
 *     loaded but OFF — the workbook deducts none of them, and the plan
 *     leaves switching them on to the accountant's confirmation;
 *   - the Bonus Calculator's commission pool: 5% of qualifying sales;
 *     Supervisors 38% by trips, Ticketers 38% per head, Workers 14% per head
 *     rounded up, Managers 10% per head.
 *
 * Idempotent: only ever adds what's missing.
 */
export async function seedPayroll(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    const accounts = await ensurePayrollAccounts(m);
    console.log(`Payroll accounts ready: ${Object.values(accounts).map((a) => a.code).join(', ')}`);

    if (await m.count(PayrollPolicy)) {
      console.log('Payroll policy already exists — skipped.');
      return;
    }
    await m.save(
      m.create(PayrollPolicy, {
        version: 1,
        effectiveFrom: '2000-01-01',
        status: PayrollPolicyStatus.ACTIVE,
        note: 'Seeded: the salary sheet’s Salary/30 and the Bonus Calculator’s 5% pool. Statutory deductions loaded but off until the accountant confirms them.',
        daysPerMonth: 30,
        eobiEnabled: false,
        eobiMinimumWage: '40700.00',
        eobiEmployeePct: '1',
        eobiEmployerPct: '5',
        eobiEmploymentTypes: [EmploymentType.PERMANENT, EmploymentType.CONTRACT],
        taxEnabled: false,
        taxBands: [
          { from: '0.00', rate: '0' },
          { from: '600000.00', rate: '1' },
          { from: '1200000.00', rate: '11' },
          { from: '2200000.00', rate: '23' },
          { from: '3200000.00', rate: '30' },
          { from: '4100000.00', rate: '35' },
        ],
        pfEnabled: false,
        pfEmployeePct: '0',
        pfEmployerPct: '0',
        commissionPct: '5',
        bonusTiers: [
          { tier: BonusTier.SUPERVISOR, pct: '38', split: BonusSplitMethod.BY_UNITS, roundUp: false, unitLabel: 'trips' },
          { tier: BonusTier.TICKETER, pct: '38', split: BonusSplitMethod.EQUAL, roundUp: false, unitLabel: null },
          { tier: BonusTier.WORKER, pct: '14', split: BonusSplitMethod.EQUAL, roundUp: true, unitLabel: null },
          { tier: BonusTier.MANAGER, pct: '10', split: BonusSplitMethod.EQUAL, roundUp: false, unitLabel: null },
        ],
      }),
    );
    console.log('Payroll policy v1 seeded (statutory deductions off).');
  });
}
