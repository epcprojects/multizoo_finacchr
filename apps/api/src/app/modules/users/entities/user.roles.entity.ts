import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { JoinEntity } from '@multizoo/interfaces';
import { User } from './user.entity';
import { Role } from '../../roles/entities/role.entity';

@Entity('user_roles')
export class UserRole extends JoinEntity {
  @Column({ type: 'uuid', primary: true })
  userId!: string;

  @ManyToOne(() => User, (u) => u.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User>;

  @Column({ type: 'uuid', primary: true })
  roleId!: string;

  @ManyToOne(() => Role, (r) => r.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role!: Relation<Role>;

  @Column({ type: 'uuid', nullable: true })
  assignedBy!: string | null;
}
