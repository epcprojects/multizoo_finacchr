import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { JoinEntity } from '@multizoo/interfaces';
import { User } from './user.entity';
import { BusinessUnit } from '../../business-units/entities/business-unit.entity';

/**
 * Which business units a user works in. Only consulted for users WITHOUT
 * `units.access_all` — a Branch Manager at Panda Cafe gets one row here and
 * can then only see and post to Panda Cafe. See common/scope/unit-scope.ts.
 */
@Entity('user_business_units')
export class UserBusinessUnit extends JoinEntity {
  @Column({ type: 'uuid', primary: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User>;

  @Column({ type: 'uuid', primary: true })
  businessUnitId!: string;

  @ManyToOne(() => BusinessUnit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'businessUnitId' })
  businessUnit!: Relation<BusinessUnit>;

  @Column({ type: 'uuid', nullable: true })
  assignedBy!: string | null;
}
