import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  OneToMany,
  Relation,
} from 'typeorm';
import { BaseEntity } from '@multizoo/interfaces';
import { UserRole } from './user.roles.entity';

/**
 * A login credential — nothing more. Deliberately does NOT know about
 * Employee or Partner: those tables carry an optional, unique `userId` FK
 * pointing back here (Employee.userId, Partner.userId), set only when that
 * person is actually invited. Most of the 100+ eventual HR headcount will
 * never have a row here at all. See Fig. 17 of the architecture plan.
 */
@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true })
  email!: string;

  @Column({ unique: true, length: 255 })
  normalizedEmail!: string;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column()
  fullName!: string;

  @Column({ length: 150 })
  normalizedFullName!: string;

  @Column({ type: 'varchar', nullable: true })
  inviteToken!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  inviteExpiresAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  resetPasswordToken!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resetPasswordExpiresAt!: Date | null;

  @Column({ default: false })
  isInvitationAccepted!: boolean;

  @OneToMany(() => UserRole, (ur) => ur.user)
  userRoles!: Relation<UserRole>[];

  @BeforeInsert()
  @BeforeUpdate()
  normalise() {
    if (this.email) this.normalizedEmail = this.email.toUpperCase();
    if (this.fullName) this.normalizedFullName = this.fullName.toUpperCase();
  }
}
