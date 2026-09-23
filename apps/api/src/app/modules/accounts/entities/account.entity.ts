import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { AccountType } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { AccountClass } from './account-class.entity';

/**
 * One line of the chart of accounts — every "somewhere" a rupee can live,
 * come from, or be owed to (Follow the Rupee, Part 2).
 *
 * What kind of account it is, whether it belongs to a unit, and how its
 * code is numbered all come from its AccountClass — configurable data, not
 * code. `type` is copied from the class so balance queries don't need the
 * join; a class's bucket can't change once accounts use it.
 *
 * No balance column — balances are always computed from journal lines.
 */
@Entity('accounts')
@Index(['businessUnitId'])
@Index(['parentId'])
@Index(['classId'])
export class Account extends BaseEntity {
  /** A label, unique across the chart. Editable — history references the id. */
  @Column({ unique: true, length: 30 })
  code!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  @Column({ type: 'uuid' })
  classId!: string;

  @ManyToOne(() => AccountClass)
  @JoinColumn({ name: 'classId' })
  accountClass!: Relation<AccountClass>;

  /** Null = group-wide: the unit is recorded on each journal line instead. */
  @Column({ type: 'uuid', nullable: true })
  businessUnitId!: string | null;

  @ManyToOne(() => BusinessUnit, { nullable: true })
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit> | null;

  @Column({ type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent!: Relation<Account> | null;

  /** False for grouping headings like "Animal Feed & Medicine" — post to a child. */
  @Column({ default: true })
  isPostable!: boolean;

  /** Accounts the system itself depends on (Opening Balance Equity). */
  @Column({ default: false })
  isSystem!: boolean;

  /** How code finds a system account — never by its (editable) code or name. */
  @Column({ type: 'varchar', length: 40, nullable: true, unique: true })
  systemKey!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
