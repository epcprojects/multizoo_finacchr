import {
  businessDateOf,
  businessInstant,
  isoWeekday,
  monthEnd,
  nextRunAfter,
  PeriodKind,
  RelativePeriod,
  resolvePeriod,
  ScheduleCadence,
} from './report-periods';

describe('resolvePeriod', () => {
  // Saturday 26 September 2026.
  const today = '2026-09-26';

  it('days', () => {
    expect(isoWeekday(today)).toBe(6);
    expect(resolvePeriod(PeriodKind.DATE, RelativePeriod.TODAY, today)).toEqual({ asOf: '2026-09-26' });
    expect(resolvePeriod(PeriodKind.DATE, RelativePeriod.YESTERDAY, today)).toEqual({ asOf: '2026-09-25' });
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.YESTERDAY, today)).toEqual({ from: '2026-09-25', to: '2026-09-25' });
  });

  it('weeks: last Monday–Sunday, and the seven days to yesterday', () => {
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.PREVIOUS_WEEK, today)).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    // Run on a Monday, last week is the week that just ended.
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.PREVIOUS_WEEK, '2026-09-21')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    // …and on a Sunday it is still the week before.
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.PREVIOUS_WEEK, '2026-09-27')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.LAST_7_DAYS, today)).toEqual({ from: '2026-09-19', to: '2026-09-25' });
  });

  it('months and years, across a year end and February', () => {
    expect(resolvePeriod(PeriodKind.MONTH, RelativePeriod.PREVIOUS_MONTH, '2026-01-01')).toEqual({ month: '2025-12' });
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.PREVIOUS_MONTH, '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolvePeriod(PeriodKind.RANGE, RelativePeriod.MONTH_TO_DATE, today)).toEqual({ from: '2026-09-01', to: '2026-09-26' });
    expect(resolvePeriod(PeriodKind.MONTH, RelativePeriod.CURRENT_MONTH, today)).toEqual({ month: '2026-09' });
    expect(resolvePeriod(PeriodKind.YEAR, RelativePeriod.PREVIOUS_YEAR, today)).toEqual({ year: 2025 });
    expect(monthEnd('2026-02')).toBe('2026-02-28');
  });

  it('refuses a period that doesn’t fit the report', () => {
    expect(() => resolvePeriod(PeriodKind.DATE, RelativePeriod.PREVIOUS_MONTH, today)).toThrow(/doesn't apply/);
    expect(() => resolvePeriod(PeriodKind.RECORD, RelativePeriod.TODAY, today)).toThrow();
  });
});

describe('schedule timing (Asia/Karachi, UTC+5)', () => {
  it('business time ↔ UTC', () => {
    expect(businessInstant('2026-09-26', '23:30').toISOString()).toBe('2026-09-26T18:30:00.000Z');
    expect(businessInstant('2026-09-26', '02:00').toISOString()).toBe('2026-09-25T21:00:00.000Z');
    // 21:00 UTC on the 25th is already the 26th in Pakistan.
    expect(businessDateOf(new Date('2026-09-25T21:00:00Z'))).toBe('2026-09-26');
  });

  it('daily: later today, or tomorrow once today’s time has passed', () => {
    const t = { cadence: ScheduleCadence.DAILY, runAt: '23:30' };
    expect(nextRunAfter(t, new Date('2026-09-26T10:00:00Z')).toISOString()).toBe('2026-09-26T18:30:00.000Z');
    expect(nextRunAfter(t, new Date('2026-09-26T18:30:00Z')).toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('weekly on Mondays at 07:00', () => {
    const t = { cadence: ScheduleCadence.WEEKLY, runAt: '07:00', weekday: 1 };
    expect(nextRunAfter(t, new Date('2026-09-26T10:00:00Z')).toISOString()).toBe('2026-09-28T02:00:00.000Z');
  });

  it('monthly on the 1st at 07:00, across a year end', () => {
    const t = { cadence: ScheduleCadence.MONTHLY, runAt: '07:00', dayOfMonth: 1 };
    expect(nextRunAfter(t, new Date('2026-09-26T10:00:00Z')).toISOString()).toBe('2026-10-01T02:00:00.000Z');
    expect(nextRunAfter(t, new Date('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-01T02:00:00.000Z');
  });
});
