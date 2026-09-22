import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { TimestampEntity } from '@multizoo/interfaces';
import { Role } from './role.entity';

/**
 * One permission grant on a role — claimType is a Permission key
 * (@multizoo/types), claimValue is always 'true'. This is what makes roles
 * dynamic: a role's capabilities are rows in this table, not a switch
 * statement in code.
 */
@Entity('role_claims')
export class RoleClaim extends TimestampEntity {
  @Column({ type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Role, (r) => r.roleClaims, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role!: Relation<Role>;

  @Column({ length: 200 })
  claimType!: string;

  @Column({ length: 500 })
  claimValue!: string;
}
