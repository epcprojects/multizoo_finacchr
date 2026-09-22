import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Composable base-entity building blocks. Every entity in the system picks
// the combination it needs rather than re-declaring these columns by hand —
// keeps the audit trail (who/when) and soft-delete behaviour identical
// everywhere, which matters once PolicyRule versioning depends on it.

export abstract class HasPrimaryKey {
  @PrimaryGeneratedColumn('uuid') id!: string;
}

export abstract class HasTimestamps {
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamp', nullable: true, default: null })
  updatedAt?: Date | null;
}

export abstract class HasSoftDelete {
  @DeleteDateColumn({ nullable: true })
  deletedAt!: Date | null;
}

export abstract class HasIsActive {
  @Column({ default: true }) isActive!: boolean;
}

export abstract class HasAuditUser {
  @Column({ type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ type: 'uuid', nullable: true }) updatedBy!: string | null;
}

/** Full convention: uuid PK, timestamps, soft-delete, isActive, audit-by-user. */
export abstract class BaseEntity extends HasPrimaryKey {
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamp', nullable: true, default: null })
  updatedAt?: Date | null;
  @DeleteDateColumn({ nullable: true })
  deletedAt!: Date | null;
  @Column({ default: true }) isActive!: boolean;
  @Column({ type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ type: 'uuid', nullable: true }) updatedBy!: string | null;
}

/** No soft-delete — for entities that are corrected with a new version, not deleted. */
export abstract class AuditableEntity extends HasPrimaryKey {
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamp', nullable: true, default: null })
  updatedAt?: Date | null;
  @Column({ type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ type: 'uuid', nullable: true }) updatedBy!: string | null;
}

export abstract class TimestampEntity extends HasPrimaryKey {
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamp', nullable: true, default: null })
  updatedAt?: Date | null;
}

export abstract class TimestampEntityWithSoftDelete extends TimestampEntity {
  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date | null;
}

/** For pure join rows that only need to record when the link was made. */
export abstract class JoinEntity {
  @CreateDateColumn() assignedAt!: Date;
}

/**
 * The pattern every PolicyRule (allocation %, leave quotas, statutory rates,
 * bonus tiers) is built on: versioned, effective-dated, never mutated in place.
 * Financial and HR modules extend this — Module 1 only defines the shape.
 */
export abstract class VersionedPolicyEntity extends HasPrimaryKey {
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamp' }) effectiveFrom!: Date;
  @Column({ type: 'timestamp', nullable: true }) effectiveTo!: Date | null;
  @Column({ type: 'uuid', nullable: true }) createdBy!: string | null;
}
