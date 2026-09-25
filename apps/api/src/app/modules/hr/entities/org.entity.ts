import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { AuditableEntity, BaseEntity } from '@multizoo/interfaces';
import { BonusTier } from '@multizoo/types';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';

/**
 * A team inside one business unit (Animal Care, Kitchen, …) — architecture
 * plan Part 05, "Department & Designation". Renaming or adding one is a
 * low-impact change and saves immediately.
 */
@Entity('departments')
@Index(['businessUnitId', 'name'], { unique: true })
export class Department extends BaseEntity {
  @Column({ type: 'uuid' })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit)
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ length: 80 })
  name!: string;
}

/**
 * A job title, group-wide ("Zoo Worker", "Supervisor"). Its bonus tier is
 * the default for everyone holding it; an employee can override it.
 */
@Entity('designations')
export class Designation extends BaseEntity {
  @Column({ length: 80, unique: true })
  name!: string;

  @Column({ type: 'enum', enum: BonusTier, default: BonusTier.WORKER })
  bonusTier!: BonusTier;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}

/**
 * A paid rest day for everyone (businessUnitId null) or one unit. Working
 * it counts as an extra day, like working a weekly off day.
 */
@Entity('holidays')
@Index(['date'])
export class Holiday extends AuditableEntity {
  @Column({ type: 'date' })
  date!: string;

  @Column({ length: 80 })
  name!: string;

  @Column({ type: 'uuid', nullable: true })
  businessUnitId!: string | null;

  @ManyToOne(() => BusinessUnit, { nullable: true })
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit> | null;
}
