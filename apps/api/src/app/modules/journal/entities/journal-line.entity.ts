import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { HasPrimaryKey } from '@multizoo/interfaces';
import { Account } from '../../accounts/entities/account.entity';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { JournalEntry } from './journal-entry.entity';

/**
 * One side of a journal entry. Exactly one of debit / credit is non-zero —
 * enforced by the database, not just the service, so no future code path
 * can write a line that is both, neither, or negative.
 *
 * Money is NUMERIC(18,2); the pg driver returns it as a string and it stays
 * a string (see @multizoo/utils money helpers) — never a JS number.
 */
@Entity('journal_lines')
@Index(['accountId'])
@Index(['entryId'])
@Check(
  'CHK_journal_lines_one_side',
  `"debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0))`,
)
export class JournalLine extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'entryId' })
  entry!: Relation<JournalEntry>;

  @Column({ type: 'int' })
  lineNo!: number;

  @Column({ type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'accountId' })
  account!: Relation<Account>;

  /** The unit this line belongs to — the P&L dimension for group-wide accounts. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  debit!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  credit!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  memo!: string | null;

  /** Reserved for Module 6's cost-centre cross-charges (the "342" sheets). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  costCentre!: string | null;
}
