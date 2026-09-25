import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, HasPrimaryKey } from '@multizoo/interfaces';
import { SalaryAdvanceStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from '../../hr/entities/employee.entity';

/**
 * Money paid to an employee ahead of their salary (architecture plan
 * Part 05 "Advance", Part 07 §04) — a loan against future pay, with a
 * history, instead of a number in the sheet's Advance column. Issuing it
 * posts Dr Staff Salary Advances / Cr cash; each payroll recovers it
 * (in instalments, or all at once) until it's cleared.
 *
 * Module 6 reads these for the counterparty ledger (an employee's loans
 * beside their advances) and writes off what a leaver's settlement
 * couldn't cover.
 */
@Entity('salary_advances')
@Index(['employeeId', 'issueDate'])
@Index(['businessUnitId', 'status'])
@Check('CHK_salary_advances_amount', `"amount" > 0 AND ("installment" IS NULL OR "installment" > 0)`)
export class SalaryAdvance extends AuditableEntity {
  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  /** The unit whose cash paid it. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  issueDate!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  /** Recovered per payroll; null = the whole balance at the next payroll (the sheet's habit). */
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  installment!: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'enum', enum: SalaryAdvanceStatus, default: SalaryAdvanceStatus.OUTSTANDING })
  status!: SalaryAdvanceStatus;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  paidFromAccountId!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  /** WRITTEN_OFF: what was still outstanding, and the entry that wrote it off (Module 6). */
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  writtenOff!: string | null;

  @Column({ type: 'uuid', nullable: true })
  writeOffEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  writeOffReason!: string | null;

  @OneToMany(() => AdvanceRecovery, (r) => r.advance)
  recoveries!: Relation<AdvanceRecovery>[];
}

/** One recovery of an advance — by a finalised payslip or a settlement. */
@Entity('advance_recoveries')
@Index(['advanceId'])
@Index(['payslipId'])
@Index(['settlementId'])
@Check('CHK_advance_recoveries_amount', `"amount" > 0`)
@Check('CHK_advance_recoveries_source', `("payslipId" IS NULL) <> ("settlementId" IS NULL)`)
export class AdvanceRecovery extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  advanceId!: string;

  @ManyToOne(() => SalaryAdvance, (a) => a.recoveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'advanceId' })
  advance!: Relation<SalaryAdvance>;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  /** The payroll month (or exit month) it came out of. */
  @Column({ length: 7 })
  month!: string;

  @Column({ type: 'uuid', nullable: true })
  payslipId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  settlementId!: string | null;
}
