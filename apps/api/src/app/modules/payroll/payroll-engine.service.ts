import { Injectable } from '@nestjs/common';
import { EntityManager, In, IsNull, LessThanOrEqual } from 'typeorm';
import {
  BonusPoolStatus,
  DisciplinaryStatus,
  DisciplinaryType,
  LeaveRequestStatus,
  PayBasis,
  PayrollAdjustmentKind,
  SalaryAdvanceStatus,
} from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { Employee, SalaryRevision } from '../hr/entities/employee.entity';
import { DisciplinaryRecord } from '../hr/entities/attendance.entity';
import { LeaveRequest } from '../hr/entities/leave.entity';
import { AttendanceService } from '../hr/attendance.service';
import { fromHalves, monthBounds, toHalves, type MonthSummary } from '../hr/hr-math';
import { PayrollAdjustment, PayrollPolicy, type PayslipDetails } from './entities/payroll.entity';
import { SalaryAdvance } from './entities/advance.entity';
import { BonusPool } from './entities/bonus.entity';
import { statutoryRules } from './payroll-common';
import {
  bonusPool,
  computePayslip,
  earnedForMonth,
  type AdvanceBalance,
  type PayDay,
  type PayslipResult,
} from './payroll-math';

export interface ComputedPayslip {
  employee: Employee;
  month: string;
  result: PayslipResult;
  /** The sheet's Absent column, e.g. "-1" or "2.5". */
  absentDays: string;
  summary: MonthSummary;
  details: PayslipDetails;
  fineIds: string[];
  advances: (AdvanceBalance & { amount: bigint })[];
  warnings: string[];
  errors: string[];
}

export interface ComputeOptions {
  /** The run's hand-entered allowances, food and deductions. */
  adjustments?: PayrollAdjustment[];
  /**
   * Collect approved fines and recover advances. A payroll run does; a
   * settlement's months don't — the settlement collects them once, over
   * everything it owes.
   */
  collect: boolean;
}

const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

/**
 * Turns the live HR records into payslips for one month (architecture plan
 * Fig. 8 and Fig. 14): attendance → the Absent figure, dated salary →
 * the salary, approved fines, outstanding advances, approved commission
 * pools and the run's own adjustments → the other columns.
 */
@Injectable()
export class PayrollEngine {
  constructor(private readonly attendance: AttendanceService) {}

  async computeMonth(
    m: EntityManager,
    employees: Employee[],
    month: string,
    policy: PayrollPolicy,
    opts: ComputeOptions,
  ): Promise<ComputedPayslip[]> {
    if (!employees.length) return [];
    const { from, to } = monthBounds(month);
    const ids = employees.map((e) => e.id);
    const monthDays = Number(to.slice(8, 10));

    const register = await this.attendance.buildRegister(m, employees, null, month);
    const revisions = await m.find(SalaryRevision, {
      where: { employeeId: In(ids), effectiveFrom: LessThanOrEqual(to) },
      order: { effectiveFrom: 'ASC' },
    });

    const fines = opts.collect
      ? await m.find(DisciplinaryRecord, {
          where: {
            employeeId: In(ids),
            type: DisciplinaryType.FINE,
            status: DisciplinaryStatus.APPROVED,
            payslipId: IsNull(),
            settlementId: IsNull(),
            incidentDate: LessThanOrEqual(to),
          },
          order: { incidentDate: 'ASC' },
        })
      : [];
    const pendingFines = await m.find(DisciplinaryRecord, {
      where: { employeeId: In(ids), type: DisciplinaryType.FINE, status: DisciplinaryStatus.PENDING_APPROVAL, incidentDate: LessThanOrEqual(to) },
    });
    const pendingLeave = await m
      .createQueryBuilder(LeaveRequest, 'l')
      .where('l.employeeId IN (:...ids)', { ids })
      .andWhere('l.status = :s', { s: LeaveRequestStatus.PENDING })
      .andWhere('l.startDate <= :to AND l.endDate >= :from', { from, to })
      .getMany();

    const advances = opts.collect ? await outstandingAdvances(m, ids, to) : new Map<string, AdvanceBalance[]>();
    const shares = await poolShares(m, ids, month);
    const adjustments = opts.adjustments ?? [];

    return register.map(({ employee, days, summary }) => {
      const own = revisions.filter((r) => r.employeeId === employee.id);
      const warnings: string[] = [];
      const errors: string[] = [];
      const rateOn = (date: string) => [...own].reverse().find((r) => r.effectiveFrom <= date) ?? null;

      const payDays: PayDay[] = [];
      for (const d of days) {
        if (d.kind === 'NOT_EMPLOYED') continue;
        const rev = rateOn(d.date);
        if (!rev) continue;
        payDays.push({ date: d.date, kind: d.kind, rate: toPaisa(rev.baseSalary), basis: rev.payBasis });
      }
      if (!own.length) errors.push(`${employee.fullName} has no salary recorded.`);

      const earned = earnedForMonth({
        days: payDays,
        monthDays,
        daysPerMonth: policy.daysPerMonth,
        payrollAbsentHalves: toHalves(summary.payrollAbsentDays),
      });

      const mine = adjustments.filter((a) => a.employeeId === employee.id);
      const of = (kind: PayrollAdjustmentKind) => mine.filter((a) => a.kind === kind);
      const override = of(PayrollAdjustmentKind.ADVANCE_RECOVERY)[0];
      const myFines = fines.filter((f) => f.employeeId === employee.id);
      const myShares = shares.get(employee.id) ?? [];

      const result = computePayslip({
        earned,
        poolBonus: sum(myShares.map((s) => s.amount)),
        allowances: sum(of(PayrollAdjustmentKind.ALLOWANCE).map((a) => toPaisa(a.amount))),
        fines: sum(myFines.map((f) => toPaisa(f.amount as string))),
        food: sum(of(PayrollAdjustmentKind.FOOD).map((a) => toPaisa(a.amount))),
        otherDeductions: sum(of(PayrollAdjustmentKind.DEDUCTION).map((a) => toPaisa(a.amount))),
        advances: advances.get(employee.id) ?? [],
        advanceOverride: override ? toPaisa(override.amount) : null,
        statutory: statutoryRules(policy, employee),
      });

      const unmarked = days.filter((d) => d.kind === 'UNMARKED').length;
      if (unmarked) warnings.push(`${unmarked} working ${unmarked === 1 ? 'day is' : 'days are'} not marked — paid as worked.`);
      const pl = pendingLeave.filter((l) => l.employeeId === employee.id).length;
      if (pl) warnings.push(`${pl} leave ${pl === 1 ? 'request is' : 'requests are'} still waiting for approval.`);
      const pf = pendingFines.filter((f) => f.employeeId === employee.id).length;
      if (pf) warnings.push(`${pf} ${pf === 1 ? 'fine is' : 'fines are'} awaiting approval — not deducted until approved.`);
      const owed = sum((advances.get(employee.id) ?? []).map((a) => a.outstanding));
      if (opts.collect && owed > result.advanceRecovered && !override) {
        const later = owed - result.advanceRecovered;
        warnings.push(`Rs ${fromPaisa(later)} of advances stays outstanding for later months.`);
      }
      if (result.net < 0n) {
        errors.push(`${employee.fullName}'s deductions come to Rs ${fromPaisa(-result.net)} more than their pay — reduce a deduction.`);
      }

      const balances = advances.get(employee.id) ?? [];
      const details: PayslipDetails = {
        attendance: {
          employedDays: summary.employedDays,
          workingDays: summary.workingDays,
          present: summary.present,
          halfDays: summary.halfDays,
          absent: summary.absent,
          paidLeave: summary.paidLeave,
          unpaidLeave: summary.unpaidLeave,
          extraDays: summary.extraDays,
          unmarked,
        },
        fines: myFines.map((f) => ({ id: f.id, date: f.incidentDate, reason: f.reason, amount: f.amount as string })),
        allowances: of(PayrollAdjustmentKind.ALLOWANCE).map((a) => ({ description: a.description, amount: a.amount })),
        food: of(PayrollAdjustmentKind.FOOD).map((a) => ({ description: a.description, amount: a.amount })),
        deductions: of(PayrollAdjustmentKind.DEDUCTION).map((a) => ({ description: a.description, amount: a.amount })),
        poolShares: myShares.map((s) => ({ poolId: s.poolId, title: s.title, tier: s.tier, amount: fromPaisa(s.amount) })),
        recoveries: result.recoveries.map((r) => {
          const a = balances.find((b) => b.id === r.id) as AdvanceBalance;
          return { advanceId: r.id, issueDate: a.issueDate, amount: fromPaisa(r.amount), outstandingAfter: fromPaisa(a.outstanding - r.amount) };
        }),
        paidDays: earned.basis === PayBasis.DAILY ? fromHalves(earned.paidHalves) : null,
      };

      return {
        employee,
        month,
        result,
        absentDays: summary.payrollAbsentDays,
        summary,
        details,
        fineIds: myFines.map((f) => f.id),
        advances: balances.map((b) => ({ ...b, amount: result.recoveries.find((r) => r.id === b.id)?.amount ?? 0n })),
        warnings,
        errors,
      };
    });
  }
}

/** Every outstanding advance issued by a date, with what's left of it. */
export async function outstandingAdvances(m: EntityManager, employeeIds: string[], asOf: string) {
  const out = new Map<string, AdvanceBalance[]>();
  if (!employeeIds.length) return out;
  const rows = await m.find(SalaryAdvance, {
    where: { employeeId: In(employeeIds), status: SalaryAdvanceStatus.OUTSTANDING, issueDate: LessThanOrEqual(asOf) },
    relations: { recoveries: true },
    order: { issueDate: 'ASC' },
  });
  for (const a of rows) {
    const outstanding = toPaisa(a.amount) - sum(a.recoveries.map((r) => toPaisa(r.amount)));
    if (outstanding <= 0n) continue;
    out.set(a.employeeId, [
      ...(out.get(a.employeeId) ?? []),
      { id: a.id, issueDate: a.issueDate, outstanding, installment: a.installment ? toPaisa(a.installment) : null },
    ]);
  }
  return out;
}

/** Approved commission-pool shares paid with a month, by employee. */
export async function poolShares(m: EntityManager, employeeIds: string[], month: string) {
  const out = new Map<string, { poolId: string; title: string; tier: string; amount: bigint }[]>();
  const pools = await m.find(BonusPool, { where: { month, status: BonusPoolStatus.APPROVED }, relations: { members: true } });
  for (const pool of pools) {
    if (!pool.members.some((x) => employeeIds.includes(x.employeeId))) continue;
    const r = bonusPool(toPaisa(pool.qualifyingSales), pool.commissionPct, pool.tiers, pool.members);
    for (const s of r.shares) {
      if (!employeeIds.includes(s.employeeId) || s.amount === 0n) continue;
      out.set(s.employeeId, [...(out.get(s.employeeId) ?? []), { poolId: pool.id, title: pool.title, tier: s.tier, amount: s.amount }]);
    }
  }
  return out;
}
