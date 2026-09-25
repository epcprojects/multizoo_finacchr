import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity } from '@multizoo/interfaces';
import { PayrollAdjustmentKind, SettlementStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from '../../hr/entities/employee.entity';

export interface SettlementAdjustmentJson {
  kind: PayrollAdjustmentKind.ALLOWANCE | PayrollAdjustmentKind.DEDUCTION;
  amount: string;
  description: string;
}

/** The frozen calculation, written when the settlement is finalised. */
export interface SettlementSnapshot {
  months: {
    month: string;
    salary: string;
    absentDays: string;
    earned: string;
    absenceDeduction: string;
    salaryForDays: string;
    poolBonus: string;
    eobiEmployee: string;
    eobiEmployer: string;
    tax: string;
    pfEmployee: string;
    pfEmployer: string;
  }[];
  salaryForDays: string;
  poolBonus: string;
  encashment: { leaveTypeId: string; name: string; days: string; amount: string }[];
  leaveEncashment: string;
  additions: string;
  fines: { id: string; date: string; reason: string; amount: string }[];
  finesTotal: string;
  deductions: string;
  statutoryEmployee: string;
  statutoryEmployer: string;
  eobiEmployee: string;
  eobiEmployer: string;
  tax: string;
  pfEmployee: string;
  pfEmployer: string;
  advances: { advanceId: string; issueDate: string; outstanding: string; recovered: string }[];
  advanceRecovered: string;
  /** Advances still owed after everything due was set against them. */
  stillOwed: string;
  net: string;
  cost: string;
}

/**
 * Full & final settlement (architecture plan Part 07 §06, Fig. 15; module
 * M16): what is owed to someone on their last day — salary not yet paid
 * through a payroll run, plus leave encashment where the policy allows it,
 * less outstanding advances and unrecovered fines. One per exit.
 *
 * Same life as a payroll run: a draft is recalculated live; finalising
 * freezes it, posts it to the ledger and recovers the advances; paying it
 * posts the cash out.
 */
@Entity('final_settlements')
@Index(['businessUnitId', 'status'])
export class FinalSettlement extends AuditableEntity {
  @Column({ type: 'uuid' })
  @Index({ unique: true })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  /** Their last working day, copied from the employee when finalised. */
  @Column({ type: 'date' })
  exitDate!: string;

  /** The first month it pays — the month after their last payroll. */
  @Column({ length: 7 })
  fromMonth!: string;

  @Column({ type: 'enum', enum: SettlementStatus, default: SettlementStatus.DRAFT })
  status!: SettlementStatus;

  /** Anything else owed either way (notice pay, a damaged uniform …), with a reason. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  adjustments!: SettlementAdjustmentJson[];

  @Column({ type: 'jsonb', nullable: true })
  snapshot!: SettlementSnapshot | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  net!: string | null;

  @Column({ type: 'uuid', nullable: true })
  policyId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  accrualEntryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  paymentEntryId!: string | null;

  @Column({ type: 'date', nullable: true })
  paidOn!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finalizedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  finalizedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
