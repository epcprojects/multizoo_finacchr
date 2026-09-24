import { BeforeInsert, BeforeUpdate, Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { BusinessUnitType } from './business-unit-type.entity';

/**
 * One operating business (Multi Zoo, Panda Cafe, …) or the holding company.
 * Replaces "one tab per unit" in the cash-flow workbook. The code is used
 * when numbering the unit's new accounts; it can be changed (account codes
 * are labels), optionally re-lettering existing account codes.
 */
@Entity('business_units')
export class BusinessUnit extends BaseEntity {
  @Column({ unique: true, length: 12 })
  code!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'uuid' })
  typeId!: string;

  @ManyToOne(() => BusinessUnitType)
  @JoinColumn({ name: 'typeId' })
  unitType!: Relation<BusinessUnitType>;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalise() {
    if (this.code) this.code = this.code.trim().toUpperCase();
  }
}
