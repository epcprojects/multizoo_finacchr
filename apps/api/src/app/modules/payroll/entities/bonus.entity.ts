import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from 'typeorm';
import { AuditableEntity, HasPrimaryKey } from '@multizoo/interfaces';
import { BonusPoolStatus } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';
import { Employee } from '../../hr/entities/employee.entity';
import type { BonusTierJson } from './payroll.entity';

/**
 * A commission pool (architecture plan Part 03 §7, Fig. 9; the hidden
 * "Bonus Calculator" sheet): qualifying sales × commission %, split across
 * the bonus tiers, then between the people in each tier. The rules are
 * copied from the payroll policy when the pool is created, so a later
 * policy change never rewrites it.
 *
 * Once approved, each share is added to that person's "Bonus / Incentive"
 * for the pool's month.
 */
@Entity('bonus_pools')
@Index(['businessUnitId', 'month'])
export class BonusPool extends AuditableEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  /** The payroll month the shares are paid with. */
  @Column({ length: 7 })
  month!: string;

  @Column({ length: 120 })
  title!: string;

  /** What the sales figure is ("School trip sales, November"). Sales records arrive in Module 7. */
  @Column({ type: 'text', nullable: true })
  basis!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  qualifyingSales!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  commissionPct!: string;

  @Column({ type: 'jsonb' })
  tiers!: BonusTierJson[];

  @Column({ type: 'int' })
  policyVersion!: number;

  @Column({ type: 'enum', enum: BonusPoolStatus, default: BonusPoolStatus.DRAFT })
  status!: BonusPoolStatus;

  @Column({ type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt!: Date | null;

  @OneToMany(() => BonusPoolMember, (m) => m.pool)
  members!: Relation<BonusPoolMember>[];
}

@Entity('bonus_pool_members')
@Index(['poolId', 'employeeId'], { unique: true })
@Check('CHK_bonus_pool_members_units', `"units" >= 0`)
export class BonusPoolMember extends HasPrimaryKey {
  @Column({ type: 'uuid' })
  poolId!: string;

  @ManyToOne(() => BonusPool, (p) => p.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poolId' })
  pool!: Relation<BonusPool>;

  @Column({ type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee!: Relation<Employee>;

  /** Their tier in this pool — their bonus tier when added, changeable per pool. */
  @Column({ length: 20 })
  tier!: string;

  /** Trips, visits … for tiers split by units. */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  units!: string;
}
