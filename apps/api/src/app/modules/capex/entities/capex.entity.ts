import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity } from '@multizoo/interfaces';
import { CampaignEntryStatus, CampaignEntryType, CampaignStatus, CapexFunding, CapexStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';

/**
 * One capital purchase (architecture plan Part 03 §11, M11) — a row of the
 * `Dir Invst Zoo` log: date, amount, purpose, "Roi Time Expct", nature.
 *
 * The purchase reaches the ledger one of three ways (`funding`): paid here
 * from the unit's cash (source CAPEX, undone by removing the item), linked
 * to an entry already recorded elsewhere (a partner paid for it on their
 * loan), or not at all (history from before the system). Linking items on
 * the price list (the boxing machine's rides) lets the register show how
 * much of its cost it has earned back.
 */
@Entity('capex_items')
@Index(['businessUnitId', 'purchaseDate'])
export class CapexItem extends BaseEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  purchaseDate!: string;

  /** "Purpose" — Boxing machine, Train, Take away cafe. */
  @Column({ length: 160 })
  name!: string;

  /** "Nature" — Entertainment, Food, Service. */
  @Column({ length: 60 })
  nature!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  /** "Roi Time Expct", in months. */
  @Column({ type: 'int', nullable: true })
  paybackMonths!: number | null;

  @Column({ type: 'enum', enum: CapexFunding })
  funding!: CapexFunding;

  /** Paid here: the asset or expense account charged (5800 Development & Capital Expenditure, or a fixed-asset account). */
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null;

  /** Paid here, or linked: the entry that records the purchase. */
  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  /** Price-list items whose takings are this purchase's earnings. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  earningItemIds!: string[];

  @Column({ type: 'enum', enum: CapexStatus, default: CapexStatus.ACTIVE })
  status!: CapexStatus;

  @Column({ type: 'date', nullable: true })
  retiredOn!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

/** A line of a campaign's budget — "Total Amount Required For 30 Days @25000". */
export interface CampaignBudgetLine {
  label: string;
  amount: string;
}

/**
 * A seasonal campaign — the `Ramazan 2023` iftari drive: money received for
 * it, money spent on it, and its balance, as a P&L of its own, date-bounded
 * and outside the unit's monthly cycle.
 *
 * Its money runs through its own fund account in the host unit, so a
 * donation never becomes unit income the waterfall would split, and its
 * spending never lands in the unit's expenses. Closing it charges any
 * shortfall to (or takes any surplus into) the unit's P&L in one entry.
 */
@Entity('campaigns')
export class Campaign extends AuditableEntity {
  @Column({ length: 120 })
  @Index({ unique: true })
  name!: string;

  /** The unit whose cash it runs through. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.OPEN })
  status!: CampaignStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  budget!: CampaignBudgetLine[];

  /** Its fund, in the host unit's payable class. */
  @Column({ type: 'uuid', nullable: true })
  fundAccountId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Closed: where the balance went, and the entry that took it there. */
  @Column({ type: 'uuid', nullable: true })
  closeAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  closingEntryId!: string | null;

  @Column({ type: 'date', nullable: true })
  closedOn!: string | null;

  @Column({ type: 'uuid', nullable: true })
  closedBy!: string | null;
}

/** Money raised for, or spent on, a campaign — a row of the Ramazan sheet. */
@Entity('campaign_entries')
@Index(['campaignId', 'entryDate'])
export class CampaignEntry extends AuditableEntity {
  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaignId' })
  campaign!: Relation<Campaign>;

  @Column({ type: 'date' })
  entryDate!: string;

  @Column({ type: 'enum', enum: CampaignEntryType })
  type!: CampaignEntryType;

  /** Donations, Food, Gas, Cash to cooks … */
  @Column({ length: 60 })
  category!: string;

  @Column({ length: 300 })
  description!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  /** The cash, bank or wallet it came into or went out of. */
  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'enum', enum: CampaignEntryStatus, default: CampaignEntryStatus.POSTED })
  status!: CampaignEntryStatus;

  @Column({ type: 'uuid' })
  journalEntryId!: string;

  @Column({ type: 'uuid', nullable: true })
  reversalEntryId!: string | null;
}
