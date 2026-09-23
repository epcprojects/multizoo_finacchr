import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { AccountSubtype, AccountType } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';

/**
 * One line of the chart of accounts — every "somewhere" a rupee can live,
 * come from, or be owed to (Follow the Rupee, Part 2).
 *
 * Cash, bank, wallet and reserve accounts are OWNED by a business unit.
 * Income and expense accounts are group-wide: the unit is recorded on each
 * journal line instead, so the expense tree exists once and per-unit P&L is
 * a GROUP BY rather than six copies of every category.
 *
 * No balance column — balances are always computed from journal lines.
 */
@Entity('accounts')
@Index(['businessUnitId'])
@Index(['parentId'])
export class Account extends BaseEntity {
  @Column({ unique: true, length: 30 })
  code!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  @Column({ type: 'enum', enum: AccountSubtype })
  subtype!: AccountSubtype;

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

  /** False for grouping headers like "Animal Feed & Medicine" — post to a child. */
  @Column({ default: true })
  isPostable!: boolean;

  /** Accounts the system itself depends on (Opening Balance Equity). */
  @Column({ default: false })
  isSystem!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
