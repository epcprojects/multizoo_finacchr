import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';

/**
 * A kind of business — Wildlife park, Retail, Holding company, … —
 * configurable from the type dropdown's "Add new type". The six seeded
 * types are `isSystem` (key fixed; name and flags editable).
 *
 * The only behaviour a type carries is `isHolding`: a holding / non-trading
 * entity has no daily income to allocate, so the wizard defaults it to a
 * bank account and no reserves.
 */
@Entity('business_unit_types')
export class BusinessUnitType extends BaseEntity {
  /** Stable identifier generated from the name; never changes. */
  @Column({ unique: true, length: 40 })
  key!: string;

  @Column({ unique: true, length: 60 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ default: false })
  isHolding!: boolean;

  @Column({ type: 'int', default: 100 })
  sortOrder!: number;

  @Column({ default: false })
  isSystem!: boolean;
}
