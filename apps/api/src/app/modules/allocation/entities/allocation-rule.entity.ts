import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Relation,
} from 'typeorm';
import { AuditableEntity, HasPrimaryKey } from '@multizoo/interfaces';
import {
  AllocationMethod,
  AllocationRuleStatus,
  AllocationTargetType,
} from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Account } from '../../accounts/entities/account.entity';
import { Partner } from './partner.entity';

/**
 * One version of a unit's income allocation waterfall — the first
 * PolicyRule instance (architecture plan Part 07 §08, Fig. 16).
 *
 * Versions are never edited once approved. A change is a new version with
 * a later effective date, so a day in March is always allocated by March's
 * rule. The version in force on a date is the APPROVED one with the latest
 * `effectiveFrom` on or before it; its end is simply the next one's start.
 *
 * Effective dates are business dates (`date`), not timestamps — which is
 * why this doesn't extend VersionedPolicyEntity's timestamp columns.
 */
@Entity('allocation_rules')
@Index(['businessUnitId', 'version'], { unique: true })
@Index(['businessUnitId', 'status', 'effectiveFrom'])
export class AllocationRule extends AuditableEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  /** 1, 2, 3 … per unit, in the order versions were drafted. */
  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({
    type: 'enum',
    enum: AllocationRuleStatus,
    default: AllocationRuleStatus.DRAFT,
  })
  status!: AllocationRuleStatus;

  /** Why this version exists — shown in the version history. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  submittedBy!: string | null;

  /** Who approved or rejected it, and when. */
  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @OneToMany(() => AllocationTranche, (t) => t.rule, { cascade: ['insert'] })
  tranches!: Relation<AllocationTranche>[];
}

/** A slice of the day's gross income, divided among its lines. */
@Entity('allocation_tranches')
@Index(['ruleId'])
export class AllocationTranche extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  ruleId!: string;

  @ManyToOne(() => AllocationRule, (r) => r.tranches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ruleId' })
  rule!: Relation<AllocationRule>;

  @Column({ type: 'int' })
  sortOrder!: number;

  @Column({ length: 80 })
  name!: string;

  /** % of gross income, e.g. 65.0000. */
  @Column({ type: 'numeric', precision: 7, scale: 4 })
  share!: string;

  @Column({ type: 'enum', enum: AllocationMethod })
  method!: AllocationMethod;

  @OneToMany(() => AllocationLine, (l) => l.tranche, { cascade: ['insert'] })
  lines!: Relation<AllocationLine>[];
}

/** Where one part of a tranche is earmarked: a reserve, or a partner. */
@Entity('allocation_lines')
@Index(['trancheId'])
@Check(
  'CHK_allocation_lines_target',
  `("targetType" = 'RESERVE' AND "accountId" IS NOT NULL AND "partnerId" IS NULL)
   OR ("targetType" = 'PARTNER' AND "partnerId" IS NOT NULL AND "accountId" IS NULL)`,
)
@Check('CHK_allocation_lines_weight', `"weight" > 0`)
export class AllocationLine extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  trancheId!: string;

  @ManyToOne(() => AllocationTranche, (t) => t.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trancheId' })
  tranche!: Relation<AllocationTranche>;

  @Column({ type: 'int' })
  sortOrder!: number;

  @Column({ type: 'enum', enum: AllocationTargetType })
  targetType!: AllocationTargetType;

  /** The reserve account, for RESERVE lines. */
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account!: Relation<Account> | null;

  /** The partner, for PARTNER lines — their profit reserve in the unit receives it. */
  @Column({ type: 'uuid', nullable: true })
  partnerId!: string | null;

  @ManyToOne(() => Partner, { nullable: true })
  @JoinColumn({ name: 'partnerId' })
  partner!: Relation<Partner> | null;

  /** % of the tranche (PERCENT) or a number of parts (PARTS). */
  @Column({ type: 'numeric', precision: 10, scale: 4 })
  weight!: string;
}
