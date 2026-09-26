import { DataSource } from 'typeorm';
import { ReportSchedule } from '../../app/modules/reports/entities/report.entity';
import { nextRunAfter, RelativePeriod, ScheduleCadence } from '../../app/modules/reports/report-periods';

/**
 * The scheduled reports the architecture plan names (Part 04, "Scheduled
 * workers"): the nightly cash position, a weekly expense report and the
 * monthly P&L. Added once by name — edited or switched off from Reports →
 * Schedules, and a re-seed never overwrites those changes.
 */
const SCHEDULES = [
  {
    name: 'Nightly cash position',
    reportKey: 'cash-position',
    cadence: ScheduleCadence.DAILY,
    runAt: '23:30',
    period: RelativePeriod.TODAY,
  },
  {
    name: 'Weekly expense report',
    reportKey: 'expenses',
    cadence: ScheduleCadence.WEEKLY,
    runAt: '07:00',
    weekday: 1,
    period: RelativePeriod.PREVIOUS_WEEK,
  },
  {
    name: 'Monthly profit & loss',
    reportKey: 'pnl',
    cadence: ScheduleCadence.MONTHLY,
    runAt: '07:00',
    dayOfMonth: 1,
    period: RelativePeriod.PREVIOUS_MONTH,
  },
];

export async function seedReports(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(ReportSchedule);
  let created = 0;
  for (const seed of SCHEDULES) {
    if (await repo.findOne({ where: { name: seed.name }, withDeleted: true })) continue;
    const s = repo.create({
      ...seed,
      weekday: seed.weekday ?? null,
      dayOfMonth: seed.dayOfMonth ?? null,
      params: {},
      isActive: true,
    });
    s.nextRunAt = nextRunAfter(s, new Date());
    await repo.save(s);
    created++;
  }
  console.log(`Report schedules: ${created} created`);
}
