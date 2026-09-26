import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { REPORT_BY_KEY, REPORTS } from './report-catalogue';
import { nextRunAfter, PERIODS_FOR, PeriodKind, RELATIVE_PERIOD_LABELS, resolvePeriod, ScheduleCadence, type RelativePeriod } from './report-periods';
import { ReportSchedule, ScheduleRunStatus } from './entities/report.entity';
import { ReportsService, SCHEDULER } from './reports.service';
import type { CreateScheduleDto, UpdateScheduleDto } from './dto/reports.dto';

/** The params a schedule fills in itself from its period — never stored as fixed params. */
const PERIOD_PARAMS = ['asOf', 'from', 'to', 'month', 'year'];

/**
 * Scheduled reports (architecture plan Part 04, "Scheduled workers"): each
 * minute, any schedule that's due is generated into the archive and moved
 * on to its next run. A missed run (the server was down) runs once when it
 * comes back, not once per miss.
 */
@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);
  private ticking = false;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly reports: ReportsService,
  ) {}

  private shape(s: ReportSchedule, users: Map<string, string>) {
    const def = REPORT_BY_KEY.get(s.reportKey);
    return {
      id: s.id,
      name: s.name,
      reportKey: s.reportKey,
      reportTitle: def?.title ?? s.reportKey,
      cadence: s.cadence,
      runAt: s.runAt,
      weekday: s.weekday,
      dayOfMonth: s.dayOfMonth,
      period: s.period,
      periodLabel: s.period ? RELATIVE_PERIOD_LABELS[s.period] : null,
      params: s.params,
      isActive: s.isActive,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastStatus: s.lastStatus,
      lastError: s.lastError,
      lastArchiveId: s.lastArchiveId,
      createdByName: s.createdBy ? (users.get(s.createdBy) ?? null) : null,
      createdAt: s.createdAt,
    };
  }

  async list(user: AuthenticatedUser) {
    const keys = REPORTS.filter((d) => this.reports.canSchedule(d, user)).map((d) => d.key);
    if (!keys.length) return [];
    const rows = await this.dataSource.manager.find(ReportSchedule, {
      where: { reportKey: In(keys) },
      order: { isActive: 'DESC', nextRunAt: 'ASC' },
    });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter(Boolean) as string[])];
    const users = ids.length ? await this.dataSource.manager.find(User, { where: { id: In(ids) }, withDeleted: true }) : [];
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => this.shape(r, names));
  }

  private async one(id: string, user: AuthenticatedUser) {
    const s = await this.dataSource.manager.findOne(ReportSchedule, { where: { id } });
    if (!s) throw new NotFoundException('Schedule not found');
    const def = REPORT_BY_KEY.get(s.reportKey);
    if (!def || !this.reports.canSchedule(def, user)) throw new ForbiddenException(`You can't manage schedules for this report.`);
    return s;
  }

  /** Checks a schedule's report, period, timing and fixed params; fills in what the cadence needs. */
  private validate(s: Pick<ReportSchedule, 'reportKey' | 'cadence' | 'weekday' | 'dayOfMonth' | 'period' | 'params'>, user: AuthenticatedUser) {
    const def = this.reports.definition(s.reportKey);
    if (!this.reports.canSchedule(def, user)) {
      throw new ForbiddenException(`The ${def.title.toLowerCase()} can't be scheduled by you — it needs a particular record, or reports on every unit.`);
    }
    const periods = PERIODS_FOR[def.period];
    if (def.period === PeriodKind.NONE) {
      s.period = null;
    } else if (!s.period || !periods.includes(s.period)) {
      throw new BadRequestException(`Pick which period each run covers: ${periods.map((p) => RELATIVE_PERIOD_LABELS[p].toLowerCase()).join(', ')}.`);
    }
    for (const key of Object.keys(s.params ?? {})) {
      if (PERIOD_PARAMS.includes(key)) throw new BadRequestException(`"${key}" comes from the schedule’s period — don’t set it.`);
    }
    // The fixed params must be valid for the report once the period is filled in.
    const sample = s.period ? resolvePeriod(def.period, s.period, businessDate()) : {};
    this.reports.validateParams(def, { ...s.params, ...sample });
    if (s.cadence === ScheduleCadence.WEEKLY) s.weekday = s.weekday ?? 1;
    else s.weekday = null;
    if (s.cadence === ScheduleCadence.MONTHLY) s.dayOfMonth = s.dayOfMonth ?? 1;
    else s.dayOfMonth = null;
  }

  async create(dto: CreateScheduleDto, user: AuthenticatedUser) {
    const s = this.dataSource.manager.create(ReportSchedule, {
      name: dto.name.trim(),
      reportKey: dto.reportKey,
      cadence: dto.cadence,
      runAt: dto.runAt,
      weekday: dto.weekday ?? null,
      dayOfMonth: dto.dayOfMonth ?? null,
      period: dto.period ?? null,
      params: dto.params ?? {},
      isActive: dto.isActive ?? true,
      createdBy: user.id,
    });
    this.validate(s, user);
    s.nextRunAt = nextRunAfter(s, new Date());
    const saved = await this.dataSource.manager.save(s);
    return (await this.list(user)).find((x) => x.id === saved.id);
  }

  async update(id: string, dto: UpdateScheduleDto, user: AuthenticatedUser) {
    const s = await this.one(id, user);
    if (dto.name !== undefined) s.name = dto.name.trim();
    if (dto.cadence !== undefined) s.cadence = dto.cadence;
    if (dto.runAt !== undefined) s.runAt = dto.runAt;
    if (dto.weekday !== undefined) s.weekday = dto.weekday;
    if (dto.dayOfMonth !== undefined) s.dayOfMonth = dto.dayOfMonth;
    if (dto.period !== undefined) s.period = dto.period;
    if (dto.params !== undefined) s.params = dto.params;
    if (dto.isActive !== undefined) s.isActive = dto.isActive;
    this.validate(s, user);
    s.nextRunAt = nextRunAfter(s, new Date());
    s.updatedBy = user.id;
    await this.dataSource.manager.save(s);
    return (await this.list(user)).find((x) => x.id === id);
  }

  async remove(id: string, user: AuthenticatedUser) {
    const s = await this.one(id, user);
    s.updatedBy = user.id;
    await this.dataSource.manager.save(s);
    await this.dataSource.manager.softDelete(ReportSchedule, { id });
    return { id };
  }

  /** Generate it now, as the schedule would — the next timed run is unaffected. */
  async runNow(id: string, user: AuthenticatedUser) {
    const s = await this.one(id, user);
    await this.run(s);
    return (await this.list(user)).find((x) => x.id === id);
  }

  /** One run: the period worked out for today, generated as the scheduler, the outcome recorded. */
  private async run(s: ReportSchedule) {
    const def = REPORT_BY_KEY.get(s.reportKey);
    const now = new Date();
    s.lastRunAt = now;
    try {
      if (!def) throw new Error(`Unknown report ${s.reportKey}`);
      const period = s.period ? resolvePeriod(def.period, s.period as RelativePeriod, businessDate(now)) : {};
      const archive = await this.reports.generate(def.key, { ...s.params, ...period }, SCHEDULER, {
        scheduleId: s.id,
        generatedByName: `Scheduled: ${s.name}`,
      });
      s.lastStatus = ScheduleRunStatus.OK;
      s.lastError = null;
      s.lastArchiveId = archive.id;
    } catch (err) {
      s.lastStatus = ScheduleRunStatus.FAILED;
      s.lastError = err instanceof Error ? err.message.slice(0, 1000) : String(err);
      this.logger.warn(`Schedule "${s.name}" failed: ${s.lastError}`);
    }
    await this.dataSource.manager.save(s);
  }

  @Interval('report-schedules', 60_000)
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.dataSource.manager.find(ReportSchedule, {
        where: { isActive: true, nextRunAt: LessThanOrEqual(new Date()) },
        order: { nextRunAt: 'ASC' },
      });
      for (const s of due) {
        // Claim the run: only the instance that moves nextRunAt on generates it,
        // so two API processes never produce the same scheduled report twice.
        const next = nextRunAfter(s, new Date());
        const claimed = await this.dataSource
          .createQueryBuilder()
          .update(ReportSchedule)
          .set({ nextRunAt: next })
          .where('id = :id AND "nextRunAt" <= now()', { id: s.id })
          .execute();
        if (!claimed.affected) continue;
        s.nextRunAt = next;
        await this.run(s);
      }
    } catch (err) {
      this.logger.error(`Report scheduler: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.ticking = false;
    }
  }
}
