/**
 * The periods a report covers, and when a scheduled report next runs.
 * All dates are business dates (YYYY-MM-DD in Asia/Karachi) — a schedule
 * set for 23:30 runs at 23:30 in Pakistan whatever the server's clock is.
 */

/** What a report's period is made of. */
export enum PeriodKind {
  /** One day (asOf). */
  DATE = 'DATE',
  /** A date range (from–to). */
  RANGE = 'RANGE',
  /** A calendar month (YYYY-MM). */
  MONTH = 'MONTH',
  /** A calendar year. */
  YEAR = 'YEAR',
  /** A particular record (a payroll run, a bill) — generated on demand, not scheduled. */
  RECORD = 'RECORD',
  /** As things stand when it's generated (the capex register). */
  NONE = 'NONE',
}

/** A schedule's period, worked out afresh each time it runs. */
export enum RelativePeriod {
  TODAY = 'TODAY',
  YESTERDAY = 'YESTERDAY',
  /** Monday to Sunday of last week. */
  PREVIOUS_WEEK = 'PREVIOUS_WEEK',
  /** The seven days up to and including yesterday. */
  LAST_7_DAYS = 'LAST_7_DAYS',
  MONTH_TO_DATE = 'MONTH_TO_DATE',
  PREVIOUS_MONTH = 'PREVIOUS_MONTH',
  CURRENT_MONTH = 'CURRENT_MONTH',
  CURRENT_YEAR = 'CURRENT_YEAR',
  PREVIOUS_YEAR = 'PREVIOUS_YEAR',
}

export enum ScheduleCadence {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

/** Which relative periods make sense for each kind of report. */
export const PERIODS_FOR: Record<PeriodKind, RelativePeriod[]> = {
  [PeriodKind.DATE]: [RelativePeriod.TODAY, RelativePeriod.YESTERDAY],
  [PeriodKind.RANGE]: [
    RelativePeriod.YESTERDAY,
    RelativePeriod.PREVIOUS_WEEK,
    RelativePeriod.LAST_7_DAYS,
    RelativePeriod.MONTH_TO_DATE,
    RelativePeriod.PREVIOUS_MONTH,
  ],
  [PeriodKind.MONTH]: [RelativePeriod.PREVIOUS_MONTH, RelativePeriod.CURRENT_MONTH],
  [PeriodKind.YEAR]: [RelativePeriod.CURRENT_YEAR, RelativePeriod.PREVIOUS_YEAR],
  [PeriodKind.RECORD]: [],
  [PeriodKind.NONE]: [],
};

export const RELATIVE_PERIOD_LABELS: Record<RelativePeriod, string> = {
  TODAY: 'The day it runs',
  YESTERDAY: 'Yesterday',
  PREVIOUS_WEEK: 'Last week (Mon–Sun)',
  LAST_7_DAYS: 'The last 7 days',
  MONTH_TO_DATE: 'This month so far',
  PREVIOUS_MONTH: 'Last month',
  CURRENT_MONTH: 'This month',
  CURRENT_YEAR: 'This year',
  PREVIOUS_YEAR: 'Last year',
};

/** Date arithmetic on YYYY-MM-DD strings, in UTC so no time zone can shift a day. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export interface ResolvedPeriod {
  asOf?: string;
  from?: string;
  to?: string;
  month?: string;
  year?: number;
}

/** A relative period on a given business date → the report's own params. */
export function resolvePeriod(kind: PeriodKind, period: RelativePeriod, today: string): ResolvedPeriod {
  if (!PERIODS_FOR[kind].includes(period)) {
    throw new Error(`"${RELATIVE_PERIOD_LABELS[period] ?? period}" doesn't apply to this report.`);
  }
  const yesterday = addDays(today, -1);
  switch (period) {
    case RelativePeriod.TODAY:
      return { asOf: today };
    case RelativePeriod.YESTERDAY:
      return kind === PeriodKind.DATE ? { asOf: yesterday } : { from: yesterday, to: yesterday };
    case RelativePeriod.PREVIOUS_WEEK: {
      const lastSunday = addDays(today, -isoWeekday(today));
      return { from: addDays(lastSunday, -6), to: lastSunday };
    }
    case RelativePeriod.LAST_7_DAYS:
      return { from: addDays(today, -7), to: yesterday };
    case RelativePeriod.MONTH_TO_DATE:
      return { from: monthStart(today), to: today };
    case RelativePeriod.PREVIOUS_MONTH: {
      const month = previousMonth(today.slice(0, 7));
      return kind === PeriodKind.MONTH ? { month } : { from: `${month}-01`, to: monthEnd(month) };
    }
    case RelativePeriod.CURRENT_MONTH:
      return { month: today.slice(0, 7) };
    case RelativePeriod.CURRENT_YEAR:
      return { year: Number(today.slice(0, 4)) };
    case RelativePeriod.PREVIOUS_YEAR:
      return { year: Number(today.slice(0, 4)) - 1 };
  }
}

export interface ScheduleTiming {
  cadence: ScheduleCadence;
  /** HH:MM, business time. */
  runAt: string;
  /** WEEKLY: 1 = Monday … 7 = Sunday. */
  weekday?: number | null;
  /** MONTHLY: 1–28, so every month has it. */
  dayOfMonth?: number | null;
}

/** Pakistan has no daylight saving: business time is always UTC+5. */
const BUSINESS_OFFSET_MINUTES = 5 * 60;

/** A business date + HH:MM → the UTC instant. */
export function businessInstant(date: string, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const utc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  return new Date(utc - BUSINESS_OFFSET_MINUTES * 60_000);
}

/** The business date an instant falls on. */
export function businessDateOf(at: Date): string {
  return new Date(at.getTime() + BUSINESS_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function matchesDay(timing: ScheduleTiming, date: string): boolean {
  switch (timing.cadence) {
    case ScheduleCadence.DAILY:
      return true;
    case ScheduleCadence.WEEKLY:
      return isoWeekday(date) === (timing.weekday ?? 1);
    case ScheduleCadence.MONTHLY:
      return Number(date.slice(8, 10)) === (timing.dayOfMonth ?? 1);
  }
}

/** The first run strictly after `after`. */
export function nextRunAfter(timing: ScheduleTiming, after: Date): Date {
  let date = businessDateOf(after);
  // At most a month and a bit of days to look through.
  for (let i = 0; i < 40; i++, date = addDays(date, 1)) {
    if (!matchesDay(timing, date)) continue;
    const at = businessInstant(date, timing.runAt);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('Could not work out the next run.');
}
