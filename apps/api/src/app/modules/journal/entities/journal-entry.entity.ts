import {
  Column,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Relation,
} from 'typeorm';
import { AuditableEntity } from '@multizoo/interfaces';
import { JournalEntryKind, JournalEntrySource } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { JournalLine } from './journal-line.entity';

/**
 * One recorded event — the atomic unit that replaces a row typed into a
 * ledger sheet (architecture plan Fig. 4). Always ≥ 2 balanced lines.
 *
 * Deliberately AuditableEntity (no soft delete): a posted entry is never
 * edited or deleted. A mistake is corrected by a REVERSAL entry, linked
 * both ways via reversalOfId / reversedById.
 */
@Entity('journal_entries')
@Index(['businessUnitId', 'entryDate'])
export class JournalEntry extends AuditableEntity {
  @Column()
  @Generated('increment')
  @Index({ unique: true })
  entryNo!: number;

  @Column({ type: 'date' })
  entryDate!: string;

  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ length: 500 })
  description!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference!: string | null;

  @Column({ type: 'enum', enum: JournalEntryKind })
  kind!: JournalEntryKind;

  @Column({
    type: 'enum',
    enum: JournalEntrySource,
    default: JournalEntrySource.MANUAL,
  })
  source!: JournalEntrySource;

  @Column({ type: 'uuid', nullable: true })
  reversalOfId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversedById!: string | null;

  @OneToMany(() => JournalLine, (line) => line.entry, { cascade: ['insert'] })
  lines!: Relation<JournalLine>[];
}
