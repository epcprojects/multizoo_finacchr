import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Permission, PayrollPolicyStatus } from '@multizoo/types';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { Account } from '../accounts/entities/account.entity';
import { assertUnitAccess } from '../../../common/scope/unit-scope';
import type { Employee } from '../hr/entities/employee.entity';
import { monthBounds } from '../hr/hr-math';
import { PayrollPolicy } from './entities/payroll.entity';
import type { StatutoryRules } from './payroll-math';

/** Payroll registers and payslips: whoever runs payroll, and the partners (who see pay already). */
export const PAYROLL_VIEWERS = [Permission.PAYROLL_RUN, Permission.EMPLOYEE_VIEW];

export async function activePayrollPolicies(m: EntityManager): Promise<PayrollPolicy[]> {
  return m.find(PayrollPolicy, {
    where: { status: PayrollPolicyStatus.ACTIVE },
    order: { effectiveFrom: 'ASC', version: 'ASC' },
  });
}

/** The version in force on a date — for a month, its last day. */
export function payrollPolicyOn(policies: PayrollPolicy[], date: string): PayrollPolicy | null {
  let found: PayrollPolicy | null = null;
  for (const p of policies) if (p.effectiveFrom <= date) found = p;
  return found;
}

export async function payrollPolicyFor(m: EntityManager, month: string): Promise<PayrollPolicy> {
  const policy = payrollPolicyOn(await activePayrollPolicies(m), monthBounds(month).to);
  if (!policy) throw new BadRequestException('No payroll policy is in force for that month — publish one under Payroll → Settings.');
  return policy;
}

export function statutoryRules(policy: PayrollPolicy, employee: Pick<Employee, 'employmentType'>): StatutoryRules {
  return {
    eobiEnabled: policy.eobiEnabled,
    eobiMinimumWage: policy.eobiMinimumWage,
    eobiEmployeePct: policy.eobiEmployeePct,
    eobiEmployerPct: policy.eobiEmployerPct,
    eobiApplies: policy.eobiEmploymentTypes.includes(employee.employmentType),
    taxEnabled: policy.taxEnabled,
    taxBands: policy.taxBands,
    pfEnabled: policy.pfEnabled,
    pfEmployeePct: policy.pfEmployeePct,
    pfEmployerPct: policy.pfEmployerPct,
  };
}

/** Serialises everything that changes one unit's month of pay. */
export async function lockPayMonth(m: EntityManager, unitId: string, month: string): Promise<void> {
  await m.query(`SELECT pg_advisory_xact_lock(hashtext('payroll:' || $1 || ':' || $2))`, [unitId, month]);
}

/** A cash, bank or wallet account of the unit, to pay from. */
export async function payingAccount(m: EntityManager, accountId: string, unitId: string): Promise<Account> {
  const account = await m.findOne(Account, { where: { id: accountId }, relations: { accountClass: true } });
  if (!account) throw new NotFoundException('Account not found');
  if (!account.accountClass.isLiquid || !account.isActive || !account.isPostable) {
    throw new BadRequestException('Pay from an active cash, bank or wallet account.');
  }
  if (account.businessUnitId && account.businessUnitId !== unitId) {
    throw new BadRequestException(`${account.name} belongs to another unit — pay from this unit's own cash, bank or wallet.`);
  }
  return account;
}

/** Payments can't be dated before what they pay, or in the future. */
export function assertPaymentDate(date: string, notBefore: string): void {
  if (date > businessDate()) throw new BadRequestException('A payment can’t be dated in the future.');
  if (date < notBefore) throw new BadRequestException(`A payment can’t be dated before ${notBefore}.`);
}

export function assertUnit(user: AuthenticatedUser, unitId: string): void {
  assertUnitAccess(user, unitId);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}
