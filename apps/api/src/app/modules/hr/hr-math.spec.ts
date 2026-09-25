import { AttendanceStatus } from '@multizoo/types';
import {
  addMonths,
  carryInto,
  classifyDay,
  eachDay,
  fromHalves,
  leaveLedger,
  leaveYear,
  monthBounds,
  restReason,
  statusAllowed,
  summarizeDays,
  toHalves,
  workingDays,
  yearEntitlement,
  type DayRecord,
  type LeaveRuleInput,
  type RestCalendar,
} from './hr-math';

const { PRESENT, ABSENT, HALF_DAY, LEAVE, OFF } = AttendanceStatus;
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/** The Shops & Establishments Ordinance defaults seeded as HR policy v1. */
const ANNUAL: LeaveRuleInput = { daysPerYear: 28, availableAfterMonths: 12, carryForward: true, maxBalance: 56, eligible: true };
const CASUAL: LeaveRuleInput = { daysPerYear: 20, availableAfterMonths: 0, carryForward: false, maxBalance: null, eligible: true };
const SICK: LeaveRuleInput = { daysPerYear: 16, availableAfterMonths: 0, carryForward: true, maxBalance: 32, eligible: true };

describe('dates and half-days', () => {
  it('adds months clamped to the month end', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-03-15', 12)).toBe('2026-03-15');
  });

  it('knows month bounds, including leap February', () => {
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthBounds('2024-11')).toEqual({ from: '2024-11-01', to: '2024-11-30' });
    expect(() => monthBounds('2024-13')).toThrow();
  });

  it('round-trips whole and half days, and rejects anything else', () => {
    expect(toHalves('10.5')).toBe(21);
    expect(toHalves('14.0')).toBe(28);
    expect(toHalves('-1')).toBe(-2);
    expect(fromHalves(21)).toBe('10.5');
    expect(fromHalves(-3)).toBe('-1.5');
    expect(fromHalves(0)).toBe('0');
    expect(() => toHalves('1.25')).toThrow();
    expect(() => toHalves('abc')).toThrow();
  });
});

describe('rest days', () => {
  // 2026-09-25 is a Friday.
  const cal: RestCalendar = { weeklyOffDay: 5, holidays: new Set(['2026-09-28']) };

  it('treats the weekly off day and holidays as rest days', () => {
    expect(restReason('2026-09-25', cal)).toBe('WEEKLY_OFF');
    expect(restReason('2026-09-28', cal)).toBe('HOLIDAY');
    expect(restReason('2026-09-26', cal)).toBeNull();
  });

  it('counts leave in working days only', () => {
    // Thu 24 → Mon 28: Fri off, Mon holiday → Thu, Sat, Sun.
    expect(workingDays('2026-09-24', '2026-09-28', cal)).toEqual(['2026-09-24', '2026-09-26', '2026-09-27']);
  });

  it('allows only sensible statuses for each kind of day', () => {
    expect(statusAllowed(ABSENT, true)).toBe(false);
    expect(statusAllowed(LEAVE, true)).toBe(false);
    expect(statusAllowed(PRESENT, true)).toBe(true);
    expect(statusAllowed(OFF, false)).toBe(false);
    expect(statusAllowed(HALF_DAY, false)).toBe(true);
  });
});

describe('leave entitlement', () => {
  it('gives annual leave only after 12 months, pro-rated in the first eligible year', () => {
    // Joined 1 Jul 2025 → eligible 1 Jul 2026; 184 of 365 days left → 14 × 184/365 = 7.05 → 7 days.
    expect(yearEntitlement(2025, '2025-07-01', ANNUAL).entitlement).toBe(0);
    const y2026 = yearEntitlement(2026, '2025-07-01', ANNUAL);
    expect(y2026.eligibleFrom).toBe('2026-07-01');
    expect(fromHalves(y2026.entitlement)).toBe('7');
    expect(fromHalves(yearEntitlement(2027, '2025-07-01', ANNUAL).entitlement)).toBe('14');
  });

  it('pro-rates casual leave from the join date, rounding down to a half day', () => {
    // Joined 1 Oct 2026: 92 of 365 days → 10 × 92/365 = 2.52 → 2.5 days.
    expect(fromHalves(yearEntitlement(2026, '2026-10-01', CASUAL).entitlement)).toBe('2.5');
  });

  it('gives nothing to an employment type the policy excludes', () => {
    expect(yearEntitlement(2026, '2020-01-01', { ...CASUAL, eligible: false }).entitlement).toBe(0);
    expect(yearEntitlement(2026, '2020-01-01', null).entitlement).toBe(0);
  });

  it('carries sick leave up to the 16-day cap, casual not at all', () => {
    expect(carryInto(toHalves(5), SICK, toHalves(8))).toBe(toHalves(5));
    expect(carryInto(toHalves(12), SICK, toHalves(8))).toBe(toHalves(8)); // 8 + 8 = 16
    expect(carryInto(toHalves(6), CASUAL, toHalves(10))).toBe(0);
    expect(carryInto(-4, SICK, toHalves(8))).toBe(0);
  });
});

describe('leave coverage (Fig. 14)', () => {
  const days = (n: number, from = '2026-03-02') => eachDay(from, '2026-12-31').slice(0, n);

  it('covers leave while the balance lasts — exactly exhausted leaves zero', () => {
    const r = leaveYear({
      year: 2026, isPaid: true, entitlement: toHalves(10), eligibleFrom: '2020-01-01',
      carriedIn: 0, adjustments: 0, leaveDays: days(10), pending: 0,
    });
    expect(r.covered).toHaveLength(10);
    expect(r.uncovered).toHaveLength(0);
    expect(r.closing).toBe(0);
    expect(r.available).toBe(0);
  });

  it('marks days beyond the quota as uncovered, oldest covered first', () => {
    const leave = days(12);
    const r = leaveYear({
      year: 2026, isPaid: true, entitlement: toHalves(10), eligibleFrom: '2020-01-01',
      carriedIn: 0, adjustments: 0, leaveDays: [...leave].reverse(), pending: 0,
    });
    expect(r.covered).toEqual(leave.slice(0, 10));
    expect(r.uncovered).toEqual(leave.slice(10));
    expect(r.closing).toBe(0);
  });

  it('does not let entitlement cover days before eligibility, but carried and adjusted days can', () => {
    const r = leaveYear({
      year: 2026, isPaid: true, entitlement: toHalves(7), eligibleFrom: '2026-07-01',
      carriedIn: 0, adjustments: toHalves(1), leaveDays: ['2026-03-02', '2026-03-03', '2026-07-06'], pending: 0,
    });
    expect(r.covered).toEqual(['2026-03-02', '2026-07-06']);
    expect(r.uncovered).toEqual(['2026-03-03']);
    expect(fromHalves(r.closing)).toBe('6');
  });

  it('never covers unpaid leave', () => {
    const r = leaveYear({
      year: 2026, isPaid: false, entitlement: 0, eligibleFrom: '2020-01-01',
      carriedIn: 0, adjustments: 0, leaveDays: days(2), pending: 0,
    });
    expect(r.uncovered).toHaveLength(2);
    expect(r.available).toBe(0);
  });

  it('subtracts pending requests from what is available, not from the balance', () => {
    const r = leaveYear({
      year: 2026, isPaid: true, entitlement: toHalves(8), eligibleFrom: '2020-01-01',
      carriedIn: toHalves(3), adjustments: 0, leaveDays: days(2), pending: toHalves(4),
    });
    expect(fromHalves(r.closing)).toBe('9');
    expect(fromHalves(r.available)).toBe('5');
  });

  it('walks years, carrying sick leave forward under the cap', () => {
    const ledger = leaveLedger({
      joinDate: '2024-01-01',
      toYear: 2026,
      isPaid: true,
      ruleForYear: () => SICK,
      adjustmentsByYear: new Map(),
      daysByYear: new Map([[2024, days(2, '2024-05-01')]]),
      pendingByYear: new Map(),
    });
    // 2024: 8 − 2 = 6 → 2025: 6 + 8 = 14 → 2026: min(14, 16 − 8) + 8 = 16.
    expect(ledger.map((y) => fromHalves(y.closing))).toEqual(['6', '14', '16']);
    expect(fromHalves(ledger[2].carriedIn)).toBe('8');
  });
});

describe('a month of attendance', () => {
  const nov = monthBounds('2024-11');
  const employed = { joinDate: '2020-01-01', exitDate: null };

  /**
   * Build a month where every working day is PRESENT, then apply the given
   * overrides — the way a Branch Manager's month actually looks.
   */
  function month(
    cal: RestCalendar,
    overrides: Record<string, DayRecord>,
    employment: { joinDate: string; exitDate: string | null } = employed,
  ) {
    const days = eachDay(nov.from, nov.to).map((date) => {
      const rest = restReason(date, cal) !== null;
      const record = date in overrides ? overrides[date] : rest ? undefined : { status: PRESENT, restDay: false };
      return classifyDay(date, employment, cal, record);
    });
    return summarizeDays(days);
  }

  /** The salary sheet's own gross formula: =D − (D/30 × E) − F, in paisa. */
  const workbookGross = (salary: number, absent: string, advance = 0) =>
    Math.round((salary - (salary / 30) * Number(absent) - advance) * 100);

  // Sundays off; November 2024 has 4 Sundays (3, 10, 17, 24).
  const sundays: RestCalendar = { weeklyOffDay: 0, holidays: NO_HOLIDAYS };

  it('a clean month is zero absent days', () => {
    const s = month(sundays, {});
    expect(s.payrollAbsentDays).toBe('0');
    expect(s.present).toBe(26);
    expect(s.off).toBe(4);
    expect(s.unmarked).toBe(0);
  });

  it('Majid Husain, row 27: 5 absences → Absent 5, Gross 19,166.67 (sheet typed 19,150)', () => {
    const absent = ['2024-11-04', '2024-11-05', '2024-11-06', '2024-11-07', '2024-11-08'];
    const s = month(sundays, Object.fromEntries(absent.map((d) => [d, { status: ABSENT, restDay: false }])));
    expect(s.payrollAbsentDays).toBe('5');
    expect(workbookGross(23000, s.payrollAbsentDays)).toBe(1916667);
  });

  it('Qasim, row 18: one Sunday worked → Absent −1, Gross 28,416.67 as on the sheet', () => {
    const s = month(sundays, { '2024-11-10': { status: PRESENT, restDay: true } });
    expect(s.extraDays).toBe('1');
    expect(s.payrollAbsentDays).toBe('-1');
    expect(workbookGross(27500, s.payrollAbsentDays)).toBe(2841667);
  });

  it('Shahid Imran, row 23: two rest days worked → Absent −2, Gross 29,333.33 as on the sheet', () => {
    const s = month(sundays, {
      '2024-11-17': { status: PRESENT, restDay: true },
      '2024-11-24': { status: PRESENT, restDay: true },
    });
    expect(s.payrollAbsentDays).toBe('-2');
    expect(workbookGross(27500, s.payrollAbsentDays)).toBe(2933333);
  });

  it('Zain Ali, row 46: three absent days → Gross 27,000 as on the sheet', () => {
    const s = month(sundays, {
      '2024-11-12': { status: ABSENT, restDay: false },
      '2024-11-13': { status: ABSENT, restDay: false },
      '2024-11-14': { status: HALF_DAY, restDay: false },
      '2024-11-15': { status: HALF_DAY, restDay: false },
    });
    expect(s.payrollAbsentDays).toBe('3');
    expect(workbookGross(30000, s.payrollAbsentDays)).toBe(2700000);
  });

  it('covered leave costs nothing; uncovered leave is deducted like an absence', () => {
    const s = month(sundays, {
      '2024-11-04': { status: LEAVE, restDay: false, covered: true },
      '2024-11-05': { status: LEAVE, restDay: false, covered: true },
      '2024-11-06': { status: LEAVE, restDay: false, covered: false },
    });
    expect(s.paidLeave).toBe(2);
    expect(s.unpaidLeave).toBe(1);
    expect(s.payrollAbsentDays).toBe('1');
  });

  it('an absence and a worked rest day cancel out; a half rest day counts half', () => {
    const s = month(sundays, {
      '2024-11-05': { status: ABSENT, restDay: false },
      '2024-11-10': { status: PRESENT, restDay: true },
      '2024-11-17': { status: HALF_DAY, restDay: true },
    });
    expect(s.extraDays).toBe('1.5');
    expect(s.payrollAbsentDays).toBe('-0.5');
  });

  it('a holiday is a paid rest day', () => {
    const s = month({ weeklyOffDay: 0, holidays: new Set(['2024-11-09']) }, {});
    expect(s.off).toBe(5);
    expect(s.payrollAbsentDays).toBe('0');
  });

  it('only counts the days they were employed, and flags unmarked days', () => {
    const s = month(sundays, { '2024-11-29': undefined as unknown as DayRecord }, { joinDate: '2024-11-18', exitDate: '2024-11-29' });
    // 18–29 Nov: 12 days, one Sunday (24th); the 29th left unmarked.
    expect(s.employedDays).toBe(12);
    expect(s.off).toBe(1);
    expect(s.unmarked).toBe(1);
    expect(s.present).toBe(10);
  });

  it('keeps the rest-day snapshot when the calendar changes later', () => {
    // Marked ABSENT on a working day; a holiday is added on that date afterwards.
    const cal: RestCalendar = { weeklyOffDay: 0, holidays: new Set(['2024-11-05']) };
    const day = classifyDay('2024-11-05', employed, cal, { status: ABSENT, restDay: false });
    expect(day.kind).toBe('ABSENT');
    expect(classifyDay('2024-11-05', employed, cal, undefined).kind).toBe('OFF');
  });
});
