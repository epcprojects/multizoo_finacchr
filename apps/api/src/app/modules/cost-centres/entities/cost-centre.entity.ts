import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { CostCentreCharge } from '@multizoo/types';
import { Partner } from '../../allocation/entities/partner.entity';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';

/**
 * A cost centre (architecture plan Part 03 §10, Fig. 12) — a tag on spending
 * that says what it was really for, and whose it is.
 *
 * The "342" media office is the audit's example: paid out of Multi Zoo's
 * cash but "Paid from Zoo MIK Profit" — charged to MIK, not the Zoo. Today
 * that's a note typed into each row ("MIK(…342 expense…)"), acted on by
 * whoever reconciles the sheet. Here, tagging an entry with the centre
 * routes it: the expense is kept (so the centre's spending by category is
 * reported), and the ledger adds Dr MIK — Capital & Current / Cr the
 * expense, and releases MIK's profit reserve in the unit, the same way a
 * drawing does. The unit's P&L is left untouched.
 */
@Entity('cost_centres')
export class CostCentre extends BaseEntity {
  /** How the workbook refers to it: "342". Unique. */
  @Column({ length: 20 })
  @Index({ unique: true, where: '"deletedAt" IS NULL' })
  code!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: CostCentreCharge, default: CostCentreCharge.UNIT })
  chargeTo!: CostCentreCharge;

  /** Set when chargeTo = PARTNER. */
  @Column({ type: 'uuid', nullable: true })
  partnerId!: string | null;

  @ManyToOne(() => Partner, { nullable: true })
  @JoinColumn({ name: 'partnerId' })
  partner!: Relation<Partner> | null;

  /** Only this unit's entries may use it; null = any unit. */
  @Column({ type: 'uuid', nullable: true })
  businessUnitId!: string | null;

  @ManyToOne(() => BusinessUnit, { nullable: true })
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit> | null;
}
