import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';

/**
 * A profit-sharing partner (architecture plan Part 05, "Partner &
 * ProfitShareRule"). Their share of each unit's daily income is a line in
 * that unit's allocation rule; it lands in their profit reserve in the
 * unit, and cash they take is a drawing against their capital & current
 * account.
 *
 * `userId` links the login of a partner who uses the system; `employeeId`
 * links the Employee record of a partner who also holds an operational
 * title (Director, CEO) — any salary runs through payroll on that record,
 * entirely separate from the profit share here (Part 05 worked example).
 */
@Entity('partners')
export class Partner extends BaseEntity {
  @Column({ length: 120 })
  name!: string;

  /** How the workbooks label them: MIK, MQK. Unique, shown on narrow screens. */
  @Column({ length: 20, unique: true })
  shortName!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"userId" IS NOT NULL' })
  userId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"employeeId" IS NOT NULL' })
  employeeId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
