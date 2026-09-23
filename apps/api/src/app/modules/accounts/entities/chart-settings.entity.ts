import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Chart-of-accounts numbering settings — a single row (id = 1).
 * Changing a pattern affects codes generated from then on; existing codes
 * stay as they are (and can be edited one by one, since codes are labels).
 */
@Entity('chart_settings')
export class ChartSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  /** e.g. "{UNIT}-{NUM}" → CAFE-1100. Must contain {UNIT} and {NUM}. */
  @Column({ length: 24, default: '{UNIT}-{NUM}' })
  unitCodePattern!: string;

  /** e.g. "{NUM}" → 5110. Must contain {NUM}. */
  @Column({ length: 24, default: '{NUM}' })
  groupCodePattern!: string;

  /** Gap between consecutive auto-generated codes, e.g. 10 → 5110, 5120. */
  @Column({ type: 'int', default: 10 })
  codeStep!: number;

  @Column({ type: 'timestamp', nullable: true })
  updatedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
