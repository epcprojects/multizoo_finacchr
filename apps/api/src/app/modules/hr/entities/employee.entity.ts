import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity } from '@multizoo/interfaces';
import { BonusTier, EmployeeStatus, EmploymentType, PayBasis } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Department, Designation } from './org.entity';

/**
 * The master HR record (architecture plan Part 05, "Employee"; Part 07 §01).
 * An Employee is an HR fact that exists whether or not the person ever
 * logs in: `userId` is set only for the few who are invited (Fig. 17).
 *
 * Salary is not a column here — it lives in dated SalaryRevision rows, so a
 * payroll run for last March still sees March's salary after a raise.
 */
@Entity('employees')
@Index(['businessUnitId', 'status'])
@Check('CHK_employees_exit', `"exitDate" IS NULL OR "exitDate" >= "joinDate"`)
@Check('CHK_employees_weekly_off', `"weeklyOffDay" IS NULL OR "weeklyOffDay" BETWEEN 0 AND 6`)
export class Employee extends BaseEntity {
  /** E-0001, E-0002 … assigned on creation. */
  @Column({ length: 20, unique: true })
  employeeCode!: string;

  @Column({ length: 120 })
  fullName!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  fatherName!: string | null;

  /** National ID, 13 digits as 00000-0000000-0. */
  @Column({ type: 'varchar', length: 15, nullable: true })
  @Index({ unique: true, where: '"cnic" IS NOT NULL' })
  cnic!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  /** The unit they work for now. Attendance records keep the unit they were marked in. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department!: Relation<Department> | null;

  @Column({ type: 'uuid' })
  designationId!: string;

  @ManyToOne(() => Designation)
  @JoinColumn({ name: 'designationId' })
  designation!: Relation<Designation>;

  /** Overrides the designation's tier for this one person; null = the designation's. */
  @Column({ type: 'enum', enum: BonusTier, nullable: true })
  bonusTier!: BonusTier | null;

  @Column({ type: 'enum', enum: EmploymentType, default: EmploymentType.PERMANENT })
  employmentType!: EmploymentType;

  @Column({ type: 'date' })
  joinDate!: string;

  /** 0 = Sunday … 6 = Saturday. Working it is an extra day. */
  @Column({ type: 'smallint', nullable: true })
  weeklyOffDay!: number | null;

  @Column({ type: 'enum', enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  status!: EmployeeStatus;

  /** Last working day. May be in the future ("leaving on"). */
  @Column({ type: 'date', nullable: true })
  exitDate!: string | null;

  @Column({ type: 'text', nullable: true })
  exitReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"userId" IS NOT NULL' })
  userId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

/**
 * Base salary from a date. The one in force on a day is the latest
 * `effectiveFrom` on or before it; the first starts on the join date.
 */
@Entity('salary_revisions')
@Index(['employeeId', 'effectiveFrom'], { unique: true })
@Check('CHK_salary_revisions_amount', `"baseSalary" >= 0`)
export class SalaryRevision extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  baseSalary!: string;

  @Column({ type: 'enum', enum: PayBasis, default: PayBasis.MONTHLY })
  payBasis!: PayBasis;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;
}
