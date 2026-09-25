import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, HasPrimaryKey } from '@multizoo/interfaces';
import {
  BonusSplitMethod,
  EmploymentType,
  PayBasis,
  PayrollAdjustmentKind,
  PayrollPolicyStatus,
  PayrollRunStatus,
} from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from '../../hr/entities/employee.entity';

export interface TaxBandJson {
  /** Annual income where the band starts, rupees. */
  from: string;
  /** Percent of the income inside the band. */
  rate: string;
}

export interface BonusTierJson {
  tier: string;
  pct: string;
  split: BonusSplitMethod;
  roundUp: boolean;
  /** What BY_UNITS counts ("trips"). */
  unitLabel: string | null;
}

/**
 * One version of the payroll policy — the PolicyRule instance for
 * statutory rates and the commission pool (architecture plan Part 07 §07–08,
 * Fig. 16). The Accountant publishes a new version from a date; a month is
 * paid on the version in force on its last day.
 *
 * Seeded with EOBI, tax and provident fund OFF: the workbook deducts none of
 * them, and the plan leaves switching them on to the accountant's
 * confirmation.
 */
@Entity('payroll_policies')
@Index(['effectiveFrom'])
export class PayrollPolicy extends AuditableEntity {
  @Column({ type: 'int', unique: true })
  version!: number;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'enum', enum: PayrollPolicyStatus, default: PayrollPolicyStatus.ACTIVE })
  status!: PayrollPolicyStatus;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** The sheet's D/30: a day's pay is the monthly salary ÷ this, whatever the month's length. */
  @Column({ type: 'int', default: 30 })
  daysPerMonth!: number;

  @Column({ default: false })
  eobiEnabled!: boolean;

  /** EOBI is charged on the notified minimum wage (higher of federal / provincial), not the salary. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  eobiMinimumWage!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  eobiEmployeePct!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  eobiEmployerPct!: string;

  @Column({ type: 'enum', enum: EmploymentType, array: true })
  eobiEmploymentTypes!: EmploymentType[];

  @Column({ default: false })
  taxEnabled!: boolean;

  @Column({ type: 'jsonb' })
  taxBands!: TaxBandJson[];

  /** Voluntary — off until the partners decide to offer one. */
  @Column({ default: false })
  pfEnabled!: boolean;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  pfEmployeePct!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  pfEmployerPct!: string;

  /** The Bonus Calculator's 5%: the commission pool is this share of qualifying sales. */
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  commissionPct!: string;

  /** Each tier's share of the pool and how it divides (the tiers add up to 100%). */
  @Column({ type: 'jsonb' })
  bonusTiers!: BonusTierJson[];
}

/**
 * A unit's month of pay — the "Nov 2024 Salary Sheet ZOO" block, as a
 * record. While DRAFT its payslips are calculated live every time it's
 * opened, so a late attendance correction or an approved fine just shows
 * up. Finalising snapshots the payslips, posts the month's cost to the
 * ledger and locks those employees' attendance for the month.
 */
@Entity('payroll_runs')
@Index(['businessUnitId', 'month'], { unique: true })
export class PayrollRun extends AuditableEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  /** YYYY-MM. */
  @Column({ length: 7 })
  month!: string;

  @Column({ type: 'enum', enum: PayrollRunStatus, default: PayrollRunStatus.DRAFT })
  status!: PayrollRunStatus;

  /** The policy version it was finalised on. */
  @Column({ type: 'uuid', nullable: true })
  policyId!: string | null;

  /** Dr salaries / bonus / employer contributions, Cr salaries payable / advances / recoveries. */
  @Column({ type: 'uuid', nullable: true })
  accrualEntryId!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finalizedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  finalizedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @OneToMany(() => Payslip, (p) => p.run)
  payslips!: Relation<Payslip>[];

  @OneToMany(() => PayrollAdjustment, (a) => a.run)
  adjustments!: Relation<PayrollAdjustment>[];
}

/**
 * A figure entered by hand for one person in one run — the salary sheet's
 * Remarks column ("5K Transport and 3K food allowance") made explicit.
 * Kept while the run is a draft, so recalculating never loses it.
 */
@Entity('payroll_adjustments')
@Index(['runId', 'employeeId'])
@Check('CHK_payroll_adjustments_amount', `"amount" >= 0`)
export class PayrollAdjustment extends AuditableEntity {
  @Column({ type: 'uuid' })
  runId!: string;

  @ManyToOne(() => PayrollRun, (r) => r.adjustments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run!: Relation<PayrollRun>;

  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ type: 'enum', enum: PayrollAdjustmentKind })
  kind!: PayrollAdjustmentKind;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 200 })
  description!: string;
}

export interface PayslipDetails {
  /** Attendance behind the Absent figure. */
  attendance: {
    employedDays: number;
    workingDays: number;
    present: number;
    halfDays: number;
    absent: number;
    paidLeave: number;
    unpaidLeave: number;
    extraDays: string;
    unmarked: number;
  };
  fines: { id: string; date: string; reason: string; amount: string }[];
  allowances: { description: string; amount: string }[];
  food: { description: string; amount: string }[];
  deductions: { description: string; amount: string }[];
  poolShares: { poolId: string; title: string; tier: string; amount: string }[];
  recoveries: { advanceId: string; issueDate: string; amount: string; outstandingAfter: string }[];
  /** Daily-wage staff: days paid. */
  paidDays: string | null;
}

/**
 * One person's line on the salary sheet, frozen when the run is
 * finalised: every column the sheet has (Salary, Absent, Advance, Gross,
 * Bonus, Fine, Food, Net) plus where each figure came from.
 */
@Entity('payslips')
@Index(['runId', 'employeeId'], { unique: true })
@Index(['employeeId', 'month'])
export class Payslip extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  runId!: string;

  @ManyToOne(() => PayrollRun, (r) => r.payslips, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run!: Relation<PayrollRun>;

  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ length: 7 })
  month!: string;

  @Column({ type: 'uuid' })
  businessUnitId!: string;

  // What the person was, that month.
  @Column({ length: 20 }) employeeCode!: string;
  @Column({ length: 120 }) fullName!: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) designation!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) department!: string | null;
  @Column({ type: 'enum', enum: PayBasis }) payBasis!: PayBasis;

  @Column({ type: 'numeric', precision: 18, scale: 2 }) salary!: string;
  /** The sheet's "Absent": absences + ½ half days + leave not covered − rest days worked. */
  @Column({ type: 'numeric', precision: 5, scale: 1 }) absentDays!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) earned!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) absenceDeduction!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) advance!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) gross!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) poolBonus!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) allowances!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) bonus!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) fines!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) food!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) otherDeductions!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) eobiEmployee!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) eobiEmployer!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) tax!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) pfEmployee!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) pfEmployer!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) net!: string;
  /** Salary + bonus + employer contributions. */
  @Column({ type: 'numeric', precision: 18, scale: 2 }) cost!: string;

  @Column({ type: 'jsonb' })
  details!: PayslipDetails;

  /** The MONEY_OUT entry that paid it; null while unpaid. A zero net needs no payment. */
  @Column({ type: 'uuid', nullable: true })
  paymentEntryId!: string | null;

  @Column({ type: 'date', nullable: true })
  paidOn!: string | null;
}
