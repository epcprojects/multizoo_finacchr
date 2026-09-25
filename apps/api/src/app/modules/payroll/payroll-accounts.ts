import { EntityManager, IsNull } from 'typeorm';
import { SystemAccountClass } from '@multizoo/types';
import { Account } from '../accounts/entities/account.entity';
import { AccountClass } from '../accounts/entities/account-class.entity';
import { buildCode } from '../accounts/account-codes';
import { generateAccountCode, getChartSettings } from '../accounts/chart-of-accounts';

/**
 * The group-wide accounts payroll posts to, found by system key — never by
 * their (editable) code or name. The Salaries & Wages and Bonus & Employee
 * Relief expense accounts already exist from Module 2; they're adopted, not
 * duplicated.
 *
 *   finalise a run   Dr Salaries & Wages          (salary for the days worked)
 *                    Dr Bonus & Employee Relief   (pool shares + allowances)
 *                    Dr Employer EOBI & PF        (employer contributions)
 *                       Cr Salaries Payable       (net pay)
 *                       Cr Staff Salary Advances  (advances recovered)
 *                       Cr Staff Fines & Recoveries (fines, food, other deductions)
 *                       Cr EOBI / Tax / PF payable
 *   pay it           Dr Salaries Payable  Cr cash / bank (optionally out of the Salary reserve)
 *   issue an advance Dr Staff Salary Advances  Cr cash / bank
 */
export const PAYROLL_ACCOUNTS = {
  SALARIES_EXPENSE: { num: 5200, name: 'Salaries & Wages', classKey: SystemAccountClass.EXPENSE },
  BONUS_EXPENSE: { num: 5850, name: 'Bonus & Employee Relief', classKey: SystemAccountClass.EXPENSE },
  STATUTORY_EXPENSE: {
    num: 5210,
    name: 'Employer EOBI & Provident Fund',
    classKey: SystemAccountClass.EXPENSE,
    description: 'The employer’s share of EOBI and provident fund, when payroll deducts them.',
  },
  STAFF_ADVANCES: {
    num: 1450,
    name: 'Staff Salary Advances',
    classKey: SystemAccountClass.RECEIVABLE,
    description: 'Salary paid ahead to staff — recovered from their payroll or settlement (the salary sheet’s Advance column).',
  },
  SALARIES_PAYABLE: {
    num: 2200,
    name: 'Salaries Payable',
    classKey: SystemAccountClass.PAYABLE,
    description: 'Net pay owed from a finalised payroll run or settlement, until it’s paid out.',
  },
  EOBI_PAYABLE: { num: 2210, name: 'EOBI Payable', classKey: SystemAccountClass.PAYABLE },
  TAX_WITHHELD: { num: 2220, name: 'Income Tax Withheld (Salaries)', classKey: SystemAccountClass.PAYABLE },
  PF_PAYABLE: { num: 2230, name: 'Provident Fund Payable', classKey: SystemAccountClass.PAYABLE },
  STAFF_RECOVERIES: {
    num: 4910,
    name: 'Staff Fines & Recoveries',
    classKey: SystemAccountClass.INCOME,
    description: 'Fines, food and other deductions taken from pay.',
  },
} as const;

export type PayrollAccountKey = keyof typeof PAYROLL_ACCOUNTS;
export type PayrollAccounts = Record<PayrollAccountKey, Account>;

/** Ensures every payroll account exists (idempotent) and returns them by key. */
export async function ensurePayrollAccounts(m: EntityManager): Promise<PayrollAccounts> {
  const settings = await getChartSettings(m);
  const out = {} as PayrollAccounts;
  for (const key of Object.keys(PAYROLL_ACCOUNTS) as PayrollAccountKey[]) {
    const seed = PAYROLL_ACCOUNTS[key];
    const systemKey = `PAYROLL_${key}`;
    let account = await m.findOne(Account, { where: { systemKey }, withDeleted: true });
    if (!account) {
      const cls = await m.findOne(AccountClass, { where: { key: seed.classKey } });
      if (!cls) throw new Error(`Account class ${seed.classKey} is missing — run the seed.`);
      const existing = await m.findOne(Account, { where: { name: seed.name, businessUnitId: IsNull(), classId: cls.id } });
      if (existing) {
        existing.systemKey = systemKey;
        existing.isSystem = true;
        account = await m.save(existing);
      } else {
        const wanted = buildCode(settings.groupCodePattern, seed.num);
        const taken = await m.findOne(Account, { where: { code: wanted }, withDeleted: true });
        account = await m.save(
          m.create(Account, {
            code: taken ? await generateAccountCode(m, cls, null, null) : wanted,
            name: seed.name,
            type: cls.type,
            classId: cls.id,
            businessUnitId: null,
            parentId: null,
            isPostable: true,
            isSystem: true,
            systemKey,
            description: 'description' in seed ? seed.description : null,
          }),
        );
      }
    }
    out[key] = account;
  }
  return out;
}
