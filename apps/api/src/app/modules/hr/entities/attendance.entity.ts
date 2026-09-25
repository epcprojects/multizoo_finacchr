import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity } from '@multizoo/interfaces';
import {
  AttendanceSource,
  AttendanceStatus,
  DisciplinaryStatus,
  DisciplinaryType,
} from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from './employee.entity';
import { LeaveRequest, LeaveType } from './leave.entity';

/**
 * One employee's day (architecture plan Part 05, "Attendance"; Fig. 14).
 * Marked by hand today; `source`, `checkIn`/`checkOut` and `externalRef`
 * are there so a biometric device can post the same rows later without
 * anything downstream changing.
 *
 * A working day with no record is "not marked"; a rest day with no record
 * is simply off.
 */
@Entity('attendance_records')
@Index(['employeeId', 'date'], { unique: true })
@Index(['businessUnitId', 'date'])
@Check(
  'CHK_attendance_records_leave',
  `("status" = 'LEAVE' AND "leaveTypeId" IS NOT NULL) OR ("status" != 'LEAVE' AND "leaveTypeId" IS NULL)`,
)
export class AttendanceRecord extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  /** The unit they worked for that day — stays put if they transfer later. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'enum', enum: AttendanceStatus })
  status!: AttendanceStatus;

  /** Whether the day was a rest day (weekly off / holiday) when it was marked. */
  @Column({ default: false })
  restDay!: boolean;

  @Column({ type: 'uuid', nullable: true })
  leaveTypeId!: string | null;

  @ManyToOne(() => LeaveType, { nullable: true })
  @JoinColumn({ name: 'leaveTypeId' })
  leaveType!: Relation<LeaveType> | null;

  /** Set when an approved leave request wrote this day. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  leaveRequestId!: string | null;

  @ManyToOne(() => LeaveRequest, { nullable: true })
  @JoinColumn({ name: 'leaveRequestId' })
  leaveRequest!: Relation<LeaveRequest> | null;

  @Column({ type: 'enum', enum: AttendanceSource, default: AttendanceSource.MANUAL })
  source!: AttendanceSource;

  /** Device punches, when a biometric feed is connected. */
  @Column({ type: 'time', nullable: true })
  checkIn!: string | null;

  @Column({ type: 'time', nullable: true })
  checkOut!: string | null;

  /** The device's own id for the punch, to make re-sends idempotent. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  externalRef!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

/**
 * A fine or a warning (architecture plan Part 05, "DisciplinaryRecord") —
 * reason, amount, who raised it, who approved it — instead of a bare
 * number in the salary sheet's Fine column. A Branch Manager raises it for
 * their unit; the Accountant approves. An approved fine comes off the
 * first payroll (or settlement) finalised for a month it falls in or
 * before — so one approved late is still collected, once.
 */
@Entity('disciplinary_records')
@Index(['employeeId', 'incidentDate'])
@Index(['businessUnitId', 'status'])
@Check(
  'CHK_disciplinary_records_amount',
  `("type" = 'FINE' AND "amount" > 0) OR ("type" = 'WARNING' AND "amount" IS NULL)`,
)
export class DisciplinaryRecord extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'enum', enum: DisciplinaryType })
  type!: DisciplinaryType;

  @Column({ type: 'date' })
  incidentDate!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  amount!: string | null;

  @Column({ type: 'enum', enum: DisciplinaryStatus, default: DisciplinaryStatus.PENDING_APPROVAL })
  status!: DisciplinaryStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  /** The month whose pay it came off — set when a payroll run or settlement is finalised. */
  @Column({ type: 'varchar', length: 7, nullable: true })
  deductedMonth!: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  payslipId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  settlementId!: string | null;
}
