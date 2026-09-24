import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity } from '@multizoo/interfaces';
import { AllocationRunStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { JournalEntry } from '../../journal/entities/journal-entry.entity';
import { AllocationRule } from './allocation-rule.entity';

export interface RunBreakdownLine {
  tranche: string;
  trancheShare: string;
  label: string;
  targetType: string;
  accountId: string;
  percentOfIncome: string;
  amount: string;
}

/**
 * One day's waterfall for one unit — the replacement for a row of the
 * Formula sheet. The money itself is in the linked journal entry; this
 * records which income it was based on and which rule version split it,
 * so a later change to that day's income shows up as "changed since".
 *
 * At most one POSTED run per unit per day (partial unique index). A re-run
 * reverses the old entry and posts a new one; the old run stays, REVERSED.
 */
@Entity('allocation_runs')
@Index(['businessUnitId', 'allocationDate'], {
  unique: true,
  where: `"status" = 'POSTED'`,
})
@Index(['businessUnitId', 'allocationDate', 'status'])
export class AllocationRun extends AuditableEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  allocationDate!: string;

  @Column({ type: 'uuid' })
  ruleId!: string;

  @ManyToOne(() => AllocationRule)
  @JoinColumn({ name: 'ruleId' })
  rule!: Relation<AllocationRule>;

  /** The day's net income (Σ credits − debits on income accounts) when it ran. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  grossIncome!: string;

  @Column({ type: 'uuid' })
  journalEntryId!: string;

  @ManyToOne(() => JournalEntry)
  @JoinColumn({ name: 'journalEntryId' })
  journalEntry!: Relation<JournalEntry>;

  @Column({
    type: 'enum',
    enum: AllocationRunStatus,
    default: AllocationRunStatus.POSTED,
  })
  status!: AllocationRunStatus;

  @Column({ type: 'uuid', nullable: true })
  reversalEntryId!: string | null;

  /** Per-line split as posted (tranche, bucket, % of income, amount). */
  @Column({ type: 'jsonb' })
  breakdown!: RunBreakdownLine[];
}
