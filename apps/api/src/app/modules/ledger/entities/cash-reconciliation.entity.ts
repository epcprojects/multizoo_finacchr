import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity } from '@multizoo/interfaces';
import { Account } from '../../accounts/entities/account.entity';

/**
 * A physical count (cash in the drawer, a bank statement balance) compared
 * against the computed balance on that date. Recording one never posts
 * anything — if there's a variance, the accountant decides whether it needs
 * a correcting entry (e.g. to Cash Over / Short). The record is the audit
 * trail that the check happened.
 */
@Entity('cash_reconciliations')
@Index(['accountId', 'asOfDate'])
export class CashReconciliation extends AuditableEntity {
  @Column({ type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'accountId' })
  account!: Relation<Account>;

  @Column({ type: 'date' })
  asOfDate!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  systemBalance!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  countedBalance!: string;

  /** counted − system: positive means more cash on hand than the books show. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  variance!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
