import { BeforeInsert, BeforeUpdate, Column, Entity } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { BusinessUnitType } from '@multizoo/types';

/**
 * One operating business (Multi Zoo, Panda Cafe, …) or the holding company.
 * Replaces "one tab per unit" in the cash-flow workbook. The `code` is
 * immutable once created because every unit-owned account code is prefixed
 * with it (ZOO-1100 Cash in Hand).
 */
@Entity('business_units')
export class BusinessUnit extends BaseEntity {
  @Column({ unique: true, length: 12 })
  code!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: BusinessUnitType })
  type!: BusinessUnitType;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalise() {
    if (this.code) this.code = this.code.trim().toUpperCase();
  }
}
