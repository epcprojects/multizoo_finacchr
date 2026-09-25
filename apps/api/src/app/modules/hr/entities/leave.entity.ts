import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Relation,
} from 'typeorm';
import { AuditableEntity, BaseEntity, HasPrimaryKey } from '@multizoo/interfaces';
import { EmploymentType, HrPolicyStatus, LeaveRequestStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from './employee.entity';

/** Annual, Casual, Sick, Unpaid … — data, so the Accountant can add Maternity tomorrow. */
@Entity('leave_types')
export class LeaveType extends BaseEntity {
  @Column({ length: 20, unique: true })
  code!: string;

  @Column({ length: 60 })
  name!: string;

  /** Unpaid leave is authorised absence: recorded, never covered by a balance. */
  @Column({ default: true })
  isPaid!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}

/**
 * One version of the leave & attendance policy — a PolicyRule instance
 * (architecture plan Part 07 §03 and §08, Fig. 16). Seeded with the Shops &
 * Establishments Ordinance minimums; the Accountant publishes a new
 * version from a date instead of editing this one.
 *
 * Entitlements for a leave year come from the version in force on 1 Jan
 * (or the join date); per-request rules (max consecutive days) from the
 * version in force when the leave starts.
 */
@Entity('hr_policies')
@Index(['effectiveFrom'])
export class HrPolicy extends AuditableEntity {
  @Column({ type: 'int', unique: true })
  version!: number;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'enum', enum: HrPolicyStatus, default: HrPolicyStatus.ACTIVE })
  status!: HrPolicyStatus;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** How many days back a Branch Manager may mark or correct attendance. */
  @Column({ type: 'int', default: 7 })
  attendanceBackdateDays!: number;

  @OneToMany(() => HrPolicyLeaveRule, (r) => r.policy, { cascade: ['insert'] })
  leaveRules!: Relation<HrPolicyLeaveRule>[];
}

@Entity('hr_policy_leave_rules')
@Index(['policyId', 'leaveTypeId'], { unique: true })
@Check('CHK_hr_policy_leave_rules_days', `"daysPerYear" >= 0`)
export class HrPolicyLeaveRule extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  policyId!: string;

  @ManyToOne(() => HrPolicy, (p) => p.leaveRules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy!: Relation<HrPolicy>;

  @Column({ type: 'uuid' })
  leaveTypeId!: string;

  @ManyToOne(() => LeaveType)
  @JoinColumn({ name: 'leaveTypeId' })
  leaveType!: Relation<LeaveType>;

  @Column({ type: 'numeric', precision: 5, scale: 1 })
  daysPerYear!: string;

  /** Service needed before it can be used — annual leave: 12. */
  @Column({ type: 'int', default: 0 })
  availableAfterMonths!: number;

  /** Longest single stretch — casual leave: 3. Null = no limit. */
  @Column({ type: 'int', nullable: true })
  maxConsecutiveDays!: number | null;

  @Column({ default: false })
  carryForward!: boolean;

  /** Most that can be held at the start of a year (carried + new). Null = no cap. */
  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true })
  maxBalance!: string | null;

  /** Paid out on exit in the full & final settlement (Module 5). */
  @Column({ default: false })
  encashable!: boolean;

  @Column({ type: 'enum', enum: EmploymentType, array: true })
  employmentTypes!: EmploymentType[];
}

/**
 * A request for leave, entered by the Branch Manager (most staff have no
 * login). Approving it writes a LEAVE attendance record for each working
 * day; cancelling removes them.
 */
@Entity('leave_requests')
@Index(['employeeId', 'startDate'])
@Index(['businessUnitId', 'status'])
@Check('CHK_leave_requests_range', `"endDate" >= "startDate"`)
export class LeaveRequest extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  /** The unit that approves it — the employee's unit when requested. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'uuid' })
  leaveTypeId!: string;

  @ManyToOne(() => LeaveType)
  @JoinColumn({ name: 'leaveTypeId' })
  leaveType!: Relation<LeaveType>;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  /** Working days in the range — rest days aren't leave. */
  @Column({ type: 'numeric', precision: 5, scale: 1 })
  days!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'enum', enum: LeaveRequestStatus, default: LeaveRequestStatus.PENDING })
  status!: LeaveRequestStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;
}

/**
 * A correction to a leave balance — most often the opening balance each
 * employee brings across at cutover. Never edited: a mistake is a new
 * adjustment the other way.
 */
@Entity('leave_adjustments')
@Index(['employeeId', 'leaveYear'])
export class LeaveAdjustment extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ type: 'uuid' })
  leaveTypeId!: string;

  @ManyToOne(() => LeaveType)
  @JoinColumn({ name: 'leaveTypeId' })
  leaveType!: Relation<LeaveType>;

  @Column({ type: 'int' })
  leaveYear!: number;

  /** ± days, whole or half. */
  @Column({ type: 'numeric', precision: 5, scale: 1 })
  days!: string;

  @Column({ type: 'text' })
  reason!: string;
}
