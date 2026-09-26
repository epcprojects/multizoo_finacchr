import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity, HasPrimaryKey } from '@multizoo/interfaces';
import { FootfallKind, SalesDayStatus, SalesPricing } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Account } from '../../accounts/entities/account.entity';

/**
 * One line of a unit's price list (architecture plan Part 03 §9): what's
 * sold, at what rate by default, and which income account it's income of.
 * The `Ticket sales` sheet's "Ticket Type" column (Entry Ticket Adult,
 * Birds Feed, School Trip 450 …) becomes these rows; the cafe, Joy Land
 * and gift-shop sheets, which only keep a day's total, get an amount-only
 * item.
 *
 * A rate here is only the default — each sales line keeps the rate it was
 * sold at, so a price change never rewrites history.
 */
@Entity('sales_items')
@Index(['businessUnitId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class SalesItem extends BaseEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ length: 120 })
  name!: string;

  /** A grouping for reports: Entry, School, Animal feed, Rides, Rentals … */
  @Column({ length: 60 })
  category!: string;

  /** The income account a sale of it is credited to (4100 Ticket Sales …). */
  @Column({ type: 'uuid' })
  incomeAccountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'incomeAccountId' })
  incomeAccount!: Relation<Account>;

  @Column({ type: 'enum', enum: SalesPricing, default: SalesPricing.PER_UNIT })
  pricing!: SalesPricing;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  defaultRate!: string | null;

  /** Each one sold is an adult or a child through the gate (the Eid sheet's footfall). */
  @Column({ type: 'enum', enum: FootfallKind, default: FootfallKind.NONE })
  footfall!: FootfallKind;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

/** Where a day's takings went: so much into cash, so much into the wallet … */
export interface SalesReceipt {
  accountId: string;
  amount: string;
}

/**
 * A unit's sales for one day — the rows the `Ticket sales` sheet keeps for
 * a date. Filled in as a DRAFT, then POSTED to the ledger as one money-in
 * entry (Dr the cash / bank / wallet it was received into, Cr each line's
 * income account), which is what the allocation engine then splits.
 */
@Entity('sales_days')
@Index(['businessUnitId', 'salesDate'], { unique: true })
export class SalesDay extends AuditableEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'date' })
  salesDate!: string;

  @Column({ type: 'enum', enum: SalesDayStatus, default: SalesDayStatus.DRAFT })
  status!: SalesDayStatus;

  /** The sum of the lines — kept so lists and grids don't re-add them. */
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  total!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  receipts!: SalesReceipt[];

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** The money-in entry while posted. */
  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @OneToMany(() => SalesLine, (l) => l.day)
  lines!: Relation<SalesLine>[];
}

/**
 * One row of a day's sheet: Ticket Type, Qty, Rate, Total. The item's name,
 * category, income account and footfall are copied on, so editing the price
 * list later never changes a past day.
 */
@Entity('sales_lines')
@Index(['dayId'])
@Index(['itemId'])
@Check('CHK_sales_lines_amount', `"amount" >= 0 AND ("quantity" IS NULL OR "quantity" >= 0)`)
export class SalesLine extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  dayId!: string;

  @ManyToOne(() => SalesDay, (d) => d.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dayId' })
  day!: Relation<SalesDay>;

  @Column({ type: 'int' })
  lineNo!: number;

  @Column({ type: 'uuid' })
  itemId!: string;

  @Column({ length: 120 })
  itemName!: string;

  @Column({ length: 60 })
  category!: string;

  @Column({ type: 'uuid' })
  incomeAccountId!: string;

  @Column({ type: 'enum', enum: FootfallKind, default: FootfallKind.NONE })
  footfall!: FootfallKind;

  /** Null for an amount-only item. */
  @Column({ type: 'int', nullable: true })
  quantity!: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  rate!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;
}

/** When a peak event fell in a given year. */
export interface SalesEventOccurrence {
  year: number;
  /** Its first day that year, YYYY-MM-DD. */
  startDate: string;
}

/**
 * A named peak period sales are compared across years — the `Eid Sales
 * Comperison` sheet's Eid-ul-Fitr and Eid-ul-Azha, day 1 to day 10.
 * The dates move every year, so each year's first day is recorded.
 */
@Entity('sales_events')
export class SalesEvent extends BaseEntity {
  @Column({ length: 80 })
  @Index({ unique: true, where: '"deletedAt" IS NULL' })
  name!: string;

  /** How many days are compared (10 on the sheet). */
  @Column({ type: 'int', default: 10 })
  days!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  occurrences!: SalesEventOccurrence[];

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
