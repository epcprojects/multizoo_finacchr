import { Check, Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity } from '@multizoo/interfaces';
import {
  CounterpartyKind,
  LoanDirection,
  LoanMovementEffect,
  LoanMovementMethod,
  LoanMovementStatus,
  LoanStatus,
} from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Partner } from '../../allocation/entities/partner.entity';
import { Employee } from '../../hr/entities/employee.entity';
import { Account } from '../../accounts/entities/account.entity';

/**
 * Someone money moves to and from outside the normal buying and selling
 * (architecture plan Part 02 "Holding & partners", Part 03 §4): a partner
 * lending to a unit, an officer spending the company's cash float, another
 * unit, an outside person or company. The workbooks keep one sheet each —
 * `Qasim Khan Loan Account`, `Officers Expenses Sheet`, `Ismail Khan`,
 * `Payable & Receiveable` — and the plan says they migrate as first-class
 * loan accounts, not "personal stuff".
 *
 * A partner, employee or unit counterparty links its record, so their
 * statement can bring everything together (a partner's loans beside their
 * profit share, an employee's loans beside their salary advances).
 */
@Entity('counterparties')
export class Counterparty extends BaseEntity {
  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: CounterpartyKind })
  kind!: CounterpartyKind;

  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"partnerId" IS NOT NULL AND "deletedAt" IS NULL' })
  partnerId!: string | null;

  @ManyToOne(() => Partner, { nullable: true })
  @JoinColumn({ name: 'partnerId' })
  partner!: Relation<Partner> | null;

  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"employeeId" IS NOT NULL AND "deletedAt" IS NULL' })
  employeeId!: string | null;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee> | null;

  /** The unit itself, for inter-unit loans. */
  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"businessUnitId" IS NOT NULL AND "deletedAt" IS NULL' })
  businessUnitId!: string | null;

  @ManyToOne(() => BusinessUnit, { nullable: true })
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit> | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

/**
 * One loan account (Part 05 "LoanAccount", Fig. 5): a counterparty, the
 * unit whose books carry it, and which way the money went. Its balance is
 * always principal − Σ repayments, computed from its movements — each its
 * own posted entry — never a typed "remaining" cell.
 *
 * A Partner approves a loan before anything posts (roles table: "Approve
 * loans & inter-unit transfers — Partner ✓, Accountant initiate only"),
 * and sets how far it may run: further advances within `limit` post
 * straight away, anything past it (or with no limit) waits for a Partner.
 *
 * Between two units the loan is a mirrored pair — "Due from Joy Land" in
 * Multi Zoo's books, "Due to Multi Zoo" in Joy Land's — and every movement
 * posts to both.
 */
@Entity('loans')
@Index(['counterpartyId'])
@Index(['businessUnitId', 'status'])
@Check('CHK_loans_limit', `"limit" IS NULL OR "limit" > 0`)
export class Loan extends AuditableEntity {
  /** Shown as LN-0001. */
  @Column()
  @Generated('increment')
  @Index({ unique: true })
  loanNo!: number;

  @Column({ type: 'uuid' })
  counterpartyId!: string;

  @ManyToOne(() => Counterparty)
  @JoinColumn({ name: 'counterpartyId' })
  counterparty!: Relation<Counterparty>;

  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'enum', enum: LoanDirection })
  direction!: LoanDirection;

  @Column({ type: 'text' })
  purpose!: string;

  /** The approved ceiling; null = every further advance needs approval. */
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  limit!: string | null;

  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.PENDING_APPROVAL })
  status!: LoanStatus;

  /** The loan's own ledger account — created when it's approved. */
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account!: Relation<Account> | null;

  /** The other unit's side of an inter-unit loan. */
  @Column({ type: 'uuid', nullable: true })
  mirrorLoanId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt!: Date | null;

  @OneToMany(() => LoanMovement, (mv) => mv.loan)
  movements!: Relation<LoanMovement>[];
}

/**
 * One row of a loan's history: money lent or borrowed, a bill paid on the
 * other's behalf, a charge, a repayment, a set-off against profit. Posted
 * as its own journal entry (source LOANS), or waiting for a Partner.
 */
@Entity('loan_movements')
@Index(['loanId', 'movementDate'])
@Index(['status'])
@Check('CHK_loan_movements_amount', `"amount" > 0`)
export class LoanMovement extends AuditableEntity {
  @Column({ type: 'uuid' })
  loanId!: string;

  @ManyToOne(() => Loan, (l) => l.movements)
  @JoinColumn({ name: 'loanId' })
  loan!: Relation<Loan>;

  @Column({ type: 'date' })
  movementDate!: string;

  @Column({ type: 'enum', enum: LoanMovementEffect })
  effect!: LoanMovementEffect;

  @Column({ type: 'enum', enum: LoanMovementMethod })
  method!: LoanMovementMethod;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ length: 500 })
  description!: string;

  /** The other side: cash / bank / wallet, an expense or income account, a partner's equity, Opening Balance Equity. */
  @Column({ type: 'uuid' })
  otherAccountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'otherAccountId' })
  otherAccount!: Relation<Account>;

  /** Money out only: paid out of this reserve bucket. */
  @Column({ type: 'uuid', nullable: true })
  reserveAccountId!: string | null;

  @Column({ type: 'enum', enum: LoanMovementStatus, default: LoanMovementStatus.PENDING_APPROVAL })
  status!: LoanMovementStatus;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalEntryId!: string | null;

  /** The other unit's half of an inter-unit movement. */
  @Column({ type: 'uuid', nullable: true })
  mirrorMovementId!: string | null;

  /** Posted by a utility bill's allocation — undone by unposting the bill. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  utilityBillId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;
}
