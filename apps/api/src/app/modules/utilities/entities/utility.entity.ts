import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity } from '@multizoo/interfaces';
import { UtilityAllocationMethod, UtilityBillStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Account } from '../../accounts/entities/account.entity';
import type { AllocationResult } from '../utility-math';

/** A unit's share of whatever the sub-meters don't cover (the sheet's "Remaining units 70% charged to zoo"). */
export interface RemainderSplit {
  businessUnitId: string;
  pct: string;
}

/** One line of a shared bill: "CEO Office" owned ½ by Z & Co and ½ by the Zoo. */
export interface BillShare {
  label: string;
  /** businessUnitId → weight. */
  weights: Record<string, string>;
}

/** One sub-meter's reading on one bill — copied from the meter so a later rename doesn't rewrite history. */
export interface MeterReading {
  subMeterId: string;
  name: string;
  businessUnitId: string;
  start: string;
  /** Blank until it’s read. */
  end: string | null;
  /** Days the reading covers when that's only part of the cycle; null = the whole cycle. */
  daysCovered: number | null;
}

/**
 * A utility connection whose bill is shared between units (architecture
 * plan Part 03 §8, Fig. 10): the "Zoo Green Meter" with its sub-meters, or
 * the "Admin Block IESCO" bill divided by offices owned. One unit receives
 * and pays the bill; the others are charged their share through the
 * inter-unit accounts.
 */
@Entity('utility_connections')
export class UtilityConnection extends BaseEntity {
  @Column({ length: 120 })
  name!: string;

  /** Electricity, Gas, Water … */
  @Column({ length: 40, default: 'Electricity' })
  utility!: string;

  /** IESCO, SNGPL … */
  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  /** Reference / meter number on the bill. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference!: string | null;

  /** The unit the bill comes to and that pays it. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'enum', enum: UtilityAllocationMethod })
  method!: UtilityAllocationMethod;

  /** The cycle a part-cycle reading is pro-rated to (the sheet's 30). */
  @Column({ type: 'int', default: 30 })
  standardDays!: number;

  /** Where the cost lands in each unit's P&L. */
  @Column({ type: 'uuid' })
  expenseAccountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'expenseAccountId' })
  expenseAccount!: Relation<Account>;

  /** SUB_METERED: who pays for what the sub-meters don't cover. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  remainderSplit!: RemainderSplit[];

  /** SHARED: the weights the bill is divided by. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  shares!: BillShare[];

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => SubMeter, (s) => s.connection)
  subMeters!: Relation<SubMeter>[];
}

/** A department's own meter on a shared connection — "Incubator room", charged to MBF. */
@Entity('utility_sub_meters')
@Index(['connectionId'])
export class SubMeter extends BaseEntity {
  @Column({ type: 'uuid' })
  connectionId!: string;

  @ManyToOne(() => UtilityConnection, (c) => c.subMeters)
  @JoinColumn({ name: 'connectionId' })
  connection!: Relation<UtilityConnection>;

  @Column({ length: 120 })
  name!: string;

  /** The unit its consumption is charged to. */
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  /** The sheet's "Connection Date". */
  @Column({ type: 'date', nullable: true })
  installedOn!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

/**
 * One billing cycle's bill and how it was shared — the sheet's "Utility
 * Cost Allocation Sheet, per cost-centre, per billing cycle". A draft
 * recalculates as readings are entered; posting charges each unit its
 * share and freezes the figures.
 */
@Entity('utility_bills')
@Index(['connectionId', 'periodTo'], { unique: true })
export class UtilityBill extends AuditableEntity {
  @Column({ type: 'uuid' })
  connectionId!: string;

  @ManyToOne(() => UtilityConnection)
  @JoinColumn({ name: 'connectionId' })
  connection!: Relation<UtilityConnection>;

  @Column({ type: 'date' })
  periodFrom!: string;

  @Column({ type: 'date' })
  periodTo!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  billAmount!: string;

  /** Units on the bill (sub-metered only). */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalUnits!: string | null;

  @Column({ type: 'enum', enum: UtilityBillStatus, default: UtilityBillStatus.DRAFT })
  status!: UtilityBillStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  readings!: MeterReading[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  remainderSplit!: RemainderSplit[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  shares!: BillShare[];

  /** The allocation as posted. */
  @Column({ type: 'jsonb', nullable: true })
  result!: AllocationResult | null;

  /** Optional: the bill's payment, posted with it. */
  @Column({ type: 'uuid', nullable: true })
  paymentEntryId!: string | null;

  @Column({ type: 'date', nullable: true })
  paidOn!: string | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
