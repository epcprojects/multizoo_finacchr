import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity, HasPrimaryKey } from '@multizoo/interfaces';
import { RelativePeriod, ScheduleCadence } from '../report-periods';

/**
 * Every PDF the system has produced (architecture plan Part 05,
 * "ReportArchive"): retained and searchable by report, period and unit.
 * Rows are never edited or deleted — a corrected figure is a new report.
 * The bytes live in `report_files` so listing the archive never loads them.
 */
@Entity('report_archive')
@Index(['reportKey', 'createdAt'])
export class ReportArchive extends HasPrimaryKey {
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** Which report from the catalogue (`cash-position`, `pnl`, `payslips` …). */
  @Column({ length: 40 })
  reportKey!: string;

  @Column({ length: 200 })
  title!: string;

  /** The period / record in words: "August 2026 · Multi Zoo". */
  @Column({ type: 'varchar', length: 300, nullable: true })
  subtitle!: string | null;

  /** The params it was generated with, as given (relative periods already resolved). */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  params!: Record<string, unknown>;

  /**
   * The business units it covers. Empty = the whole group. Someone without
   * every-unit access sees a report only when all of its units are theirs.
   */
  @Column({ type: 'uuid', array: true, default: () => `'{}'` })
  unitIds!: string[];

  @Column({ type: 'date', nullable: true })
  periodFrom!: string | null;

  @Column({ type: 'date', nullable: true })
  periodTo!: string | null;

  /** The report's headline figures ("Net profit 23,705,000.00"), shown in the archive list. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  highlights!: { label: string; value: string }[];

  @Column({ length: 200 })
  fileName!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  /** Of the PDF bytes — proof the file hasn't changed since it was generated. */
  @Column({ type: 'char', length: 64 })
  sha256!: string;

  /** Who asked for it; null when a schedule produced it. */
  @Column({ type: 'uuid', nullable: true })
  generatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  scheduleId!: string | null;
}

/** The PDF itself, one row per archive entry. Backed up with the database. */
@Entity('report_files')
export class ReportFile {
  @PrimaryColumn('uuid')
  archiveId!: string;

  @Column({ type: 'bytea' })
  content!: Buffer;
}

export enum ScheduleRunStatus {
  OK = 'OK',
  FAILED = 'FAILED',
}

/**
 * A report produced on a timetable (architecture plan Part 04, "Scheduled
 * workers": nightly cash position, weekly reports, monthly P&L). The period
 * is relative — "yesterday", "last month" — and worked out afresh on each
 * run. Schedules run with the whole group in view; `params.businessUnitId`
 * narrows one to a unit.
 */
@Entity('report_schedules')
export class ReportSchedule extends BaseEntity {
  @Column({ length: 120 })
  name!: string;

  @Column({ length: 40 })
  reportKey!: string;

  @Column({ type: 'enum', enum: ScheduleCadence })
  cadence!: ScheduleCadence;

  /** HH:MM, Pakistan time. */
  @Column({ length: 5 })
  runAt!: string;

  /** WEEKLY: 1 = Monday … 7 = Sunday. */
  @Column({ type: 'int', nullable: true })
  weekday!: number | null;

  /** MONTHLY: 1–28. */
  @Column({ type: 'int', nullable: true })
  dayOfMonth!: number | null;

  @Column({ type: 'enum', enum: RelativePeriod, nullable: true })
  period!: RelativePeriod | null;

  /** Fixed params besides the period — e.g. `businessUnitId`. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  params!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  @Index()
  nextRunAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt!: Date | null;

  @Column({ type: 'enum', enum: ScheduleRunStatus, nullable: true })
  lastStatus!: ScheduleRunStatus | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastArchiveId!: string | null;
}
