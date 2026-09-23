import { Check, Column, Entity } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { AccountClassUnitRule, AccountType } from '@multizoo/types';

/**
 * A kind of account — Cash, Bank, Reserve, Receivable, Fixed Asset, … —
 * and the rules every account of that kind follows. Configurable by the
 * Accountant; the nine seeded classes are `isSystem` (key and bucket fixed,
 * everything else editable).
 *
 * The ledger never switches on a class's key or name: it reads the flags.
 * That's what lets the Accountant add "Loan Payable" or "Petty Cash" without
 * a code change.
 */
@Entity('account_classes')
@Check('CHK_account_classes_range', `"codeStart" <= "codeEnd"`)
@Check('CHK_account_classes_liquid_or_reserve', `NOT ("isLiquid" AND "isReserve")`)
export class AccountClass extends BaseEntity {
  /** Stable identifier (CASH, FIXED_ASSET). Generated from the name; never changes. */
  @Column({ unique: true, length: 40 })
  key!: string;

  @Column({ length: 60 })
  name!: string;

  /** Which of the five fixed buckets this class sits in. */
  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  @Column({ type: 'enum', enum: AccountClassUnitRule })
  unitRule!: AccountClassUnitRule;

  /** Auto-generated codes for this class are numbered within [codeStart, codeEnd]. */
  @Column({ type: 'int' })
  codeStart!: number;

  @Column({ type: 'int' })
  codeEnd!: number;

  /** Counts as money on hand: cash position, money in/out, transfers. */
  @Column({ default: false })
  isLiquid!: boolean;

  /** Earmarked cash — only the income allocation engine may post to it. */
  @Column({ default: false })
  isReserve!: boolean;

  /** Can be checked against a physical count or statement. */
  @Column({ default: false })
  isReconcilable!: boolean;

  /** Created automatically for every new business unit (wizard pre-ticks it). */
  @Column({ default: false })
  provisionForNewUnits!: boolean;

  /** Name used when provisioned for a new unit, e.g. "Cash in Hand". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  defaultAccountName!: string | null;

  @Column({ type: 'int', default: 100 })
  sortOrder!: number;

  @Column({ default: false })
  isSystem!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
