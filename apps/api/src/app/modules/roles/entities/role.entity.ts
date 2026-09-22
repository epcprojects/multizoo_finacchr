import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  OneToMany,
  Relation,
} from 'typeorm';
import { TimestampEntityWithSoftDelete } from '@multizoo/interfaces';
import { UserRole } from '../../users/entities/user.roles.entity';
import { RoleClaim } from './role.claim.entity';

/**
 * A dynamic, admin-created role — not a fixed enum. The four roles seeded by
 * database/seeds/roles.seed.ts (Partner, Accountant, Branch Manager, Branch
 * Staff) are starting data, not a ceiling: a Partner can create another role
 * from the Admin & Configuration screen (module M13) at any time.
 */
@Entity('roles')
export class Role extends TimestampEntityWithSoftDelete {
  @Column({ unique: true, length: 50 })
  name!: string;

  @Column({ unique: true, length: 50 })
  normalizedName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => UserRole, (ur) => ur.role)
  userRoles!: Relation<UserRole>[];

  @OneToMany(() => RoleClaim, (rc) => rc.role)
  roleClaims!: Relation<RoleClaim>[];

  @BeforeInsert()
  @BeforeUpdate()
  normalise() {
    this.normalizedName = this.name.toUpperCase();
  }
}
