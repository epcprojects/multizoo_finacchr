import { AttendanceStatus } from '@multizoo/types';

/**
 * The pure arithmetic behind attendance and leave — no framework, no
 * database, no floats. Leave is counted in HALF-DAYS (integers), so a
 * "10.5 days" balance is 21 and never drifts.
 *
 * Two ideas carry the module (architecture plan Fig. 14):
 *
 * 1. A day is either a WORKING day or a REST day for an employee (their
 *    weekly off, or a holiday). Working a rest day is an extra day — which
 *    is what the salary sheet's negative "Absent" figures (−1, −2) are.
 * 2. A leave day is only paid if the employee's balance covers it.
 *    Balance is walked day by day, oldest first; days beyond it are
 *    "uncovered" and reduce pay exactly like an absence.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

function toUtc(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar months later, clamped to the month's end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: IsoDate): number {
  return toUtc(iso).getUTCDay();
}

/** Both ends included; 0 when `to` is before `from`. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  if (to < from) return 0;
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / MS_PER_DAY) + 1;
}

export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function yearOf(iso: IsoDate): number {
  return Number(iso.slice(0, 4));
}

/** "2026-02" → 1–28 Feb 2026. */
export function monthBounds(month: string): { from: IsoDate; to: IsoDate } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month: "${month}"`);
  const from = `${month}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

// ---------------------------------------------------------------------------
// Half-days
// ---------------------------------------------------------------------------

const HALF_DAYS = /^-?\d{1,4}(\.(0|5|00|50))?$/;

/** "10.5" → 21. Rejects anything that isn't a whole or half day. */
export function toHalves(days: string | number): number {
  const text = typeof days === 'number' ? String(days) : days.trim();
  if (!HALF_DAYS.test(text)) throw new Error(`"${days}" is not a whole or half number of days`);
  const negative = text.startsWith('-');
  const [whole, fraction = '0'] = text.replace('-', '').split('.');
  const halves = Number(whole) * 2 + (fraction.startsWith('5') ? 1 : 0);
  return negative ? -halves : halves;
}

/** 21 → "10.5", 28 → "14", -2 → "-1". */
export function fromHalves(halves: number): string {
  const negative = halves < 0;
  const abs = Math.abs(halves);
  const text = abs % 2 === 0 ? String(abs / 2) : `${(abs - 1) / 2}.5`;
  return negative && abs !== 0 ? `-${text}` : text;
}

// ---------------------------------------------------------------------------
// Working days and rest days
// ---------------------------------------------------------------------------

export type RestReason = 'WEEKLY_OFF' | 'HOLIDAY';

export interface RestCalendar {
  /** 0 = Sunday … 6 = Saturday; null when they have no fixed day off. */
  weeklyOffDay: number | null;
  holidays: ReadonlySet<IsoDate>;
}

export function restReason(date: IsoDate, cal: RestCalendar): RestReason | null {
  if (cal.holidays.has(date)) return 'HOLIDAY';
  if (cal.weeklyOffDay !== null && weekday(date) === cal.weeklyOffDay) return 'WEEKLY_OFF';
  return null;
}

export function workingDays(from: IsoDate, to: IsoDate, cal: RestCalendar): IsoDate[] {
  return eachDay(from, to).filter((d) => !restReason(d, cal));
}

const WORKING_DAY_STATUSES = new Set([
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.HALF_DAY,
  AttendanceStatus.LEAVE,
]);
const REST_DAY_STATUSES = new Set([AttendanceStatus.OFF, AttendanceStatus.PRESENT, AttendanceStatus.HALF_DAY]);

/**
 * Nobody is absent or on leave on their day off, and nobody is "off" on a
 * working day — a closure is a holiday, not a status.
 */
export function statusAllowed(status: AttendanceStatus, restDay: boolean): boolean {
  return (restDay ? REST_DAY_STATUSES : WORKING_DAY_STATUSES).has(status);
}

// ---------------------------------------------------------------------------
// Leave entitlement and balances
// ---------------------------------------------------------------------------

export interface LeaveRuleInput {
  /** Days per leave year, in half-days. */
  daysPerYear: number;
  /** Service needed before the entitlement can be used (annual leave: 12). */
  availableAfterMonths: number;
  carryForward: boolean;
  /** Most that can be held at the start of a year (carried + new), half-days; null = no cap. */
  maxBalance: number | null;
  /** Whether the employee's employment type gets this leave at all. */
  eligible: boolean;
}

export function eligibleFrom(joinDate: IsoDate, availableAfterMonths: number): IsoDate {
  return availableAfterMonths > 0 ? addMonths(joinDate, availableAfterMonths) : joinDate;
}

/**
 * A leave year is the calendar year. The full entitlement is credited on
 * 1 Jan; in the year someone first becomes eligible it is pro-rated to the
 * days left from that date, rounded DOWN to a half-day (never promise more
 * leave than the policy gives).
 */
export function yearEntitlement(
  year: number,
  joinDate: IsoDate,
  rule: LeaveRuleInput | null,
): { entitlement: number; eligibleFrom: IsoDate } {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!rule || !rule.eligible || rule.daysPerYear <= 0) {
    return { entitlement: 0, eligibleFrom: joinDate };
  }
  const from = eligibleFrom(joinDate, rule.availableAfterMonths);
  if (from > yearEnd) return { entitlement: 0, eligibleFrom: from };
  if (from <= yearStart) return { entitlement: rule.daysPerYear, eligibleFrom: from };
  const share = Math.floor((rule.daysPerYear * daysInclusive(from, yearEnd)) / daysInclusive(yearStart, yearEnd));
  return { entitlement: share, eligibleFrom: from };
}

/** What comes across into a new year — the NEW year's rule decides (casual: nothing). */
export function carryInto(previousClosing: number, rule: LeaveRuleInput | null, newEntitlement: number): number {
  if (!rule?.carryForward || previousClosing <= 0) return 0;
  if (rule.maxBalance === null) return previousClosing;
  return Math.min(previousClosing, Math.max(0, rule.maxBalance - newEntitlement));
}

export interface LeaveYearInput {
  year: number;
  isPaid: boolean;
  entitlement: number;
  eligibleFrom: IsoDate;
  carriedIn: number;
  /** Manual corrections and opening balances at cutover, half-days (±). */
  adjustments: number;
  /** Every day marked as this leave type in the year. */
  leaveDays: IsoDate[];
  /** Days on requests still waiting for approval, half-days. */
  pending: number;
}

export interface LeaveYearResult {
  year: number;
  carriedIn: number;
  entitlement: number;
  adjustments: number;
  eligibleFrom: IsoDate;
  /** Paid days used — each covered by the balance. */
  taken: number;
  covered: IsoDate[];
  /** Leave beyond the balance (or before eligibility, or unpaid leave) — deducted like an absence. */
  uncovered: IsoDate[];
  /** Balance at the year's end (or today): carried + entitlement + adjustments − taken. */
  closing: number;
  pending: number;
  /** What a new request could still use: closing − pending. */
  available: number;
}

export function leaveYear(input: LeaveYearInput): LeaveYearResult {
  const days = [...input.leaveDays].sort();
  if (!input.isPaid) {
    return {
      year: input.year,
      carriedIn: 0,
      entitlement: 0,
      adjustments: 0,
      eligibleFrom: input.eligibleFrom,
      taken: 0,
      covered: [],
      uncovered: days,
      closing: 0,
      pending: input.pending,
      available: 0,
    };
  }

  const base = input.carriedIn + input.adjustments;
  let used = 0;
  const covered: IsoDate[] = [];
  const uncovered: IsoDate[] = [];
  for (const day of days) {
    const pool = base + (day >= input.eligibleFrom ? input.entitlement : 0);
    if (pool - used >= 2) {
      used += 2;
      covered.push(day);
    } else {
      uncovered.push(day);
    }
  }
  const closing = base + input.entitlement - used;
  return {
    year: input.year,
    carriedIn: input.carriedIn,
    entitlement: input.entitlement,
    adjustments: input.adjustments,
    eligibleFrom: input.eligibleFrom,
    taken: used,
    covered,
    uncovered,
    closing,
    pending: input.pending,
    available: closing - input.pending,
  };
}

export interface LeaveLedgerInput {
  joinDate: IsoDate;
  toYear: number;
  isPaid: boolean;
  /** The policy rule for this leave type in force at the start of each year. */
  ruleForYear: (year: number) => LeaveRuleInput | null;
  adjustmentsByYear: ReadonlyMap<number, number>;
  daysByYear: ReadonlyMap<number, IsoDate[]>;
  pendingByYear: ReadonlyMap<number, number>;
}

/** Every leave year from the one they joined in, each carrying into the next. */
export function leaveLedger(input: LeaveLedgerInput): LeaveYearResult[] {
  const out: LeaveYearResult[] = [];
  let previousClosing = 0;
  for (let year = yearOf(input.joinDate); year <= input.toYear; year++) {
    const rule = input.isPaid ? input.ruleForYear(year) : null;
    const { entitlement, eligibleFrom: from } = yearEntitlement(year, input.joinDate, rule);
    const result = leaveYear({
      year,
      isPaid: input.isPaid,
      entitlement,
      eligibleFrom: from,
      carriedIn: out.length ? carryInto(previousClosing, rule, entitlement) : 0,
      adjustments: input.adjustmentsByYear.get(year) ?? 0,
      leaveDays: input.daysByYear.get(year) ?? [],
      pending: input.pendingByYear.get(year) ?? 0,
    });
    out.push(result);
    previousClosing = result.closing;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A month of attendance
// ---------------------------------------------------------------------------

export interface DayRecord {
  status: AttendanceStatus;
  /** Whether it was a rest day when marked — so a later holiday or off-day change can't rewrite history. */
  restDay: boolean | null;
  /** For LEAVE: whether the balance covered it. */
  covered?: boolean;
}

export type DayKind =
  | 'NOT_EMPLOYED'
  | 'UNMARKED'
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'LEAVE_PAID'
  | 'LEAVE_UNPAID'
  | 'OFF'
  | 'EXTRA'
  | 'EXTRA_HALF';

export interface ClassifiedDay {
  date: IsoDate;
  kind: DayKind;
  restReason: RestReason | null;
}

export interface Employment {
  joinDate: IsoDate;
  exitDate: IsoDate | null;
}

export function classifyDay(
  date: IsoDate,
  employment: Employment,
  cal: RestCalendar,
  record: DayRecord | undefined,
): ClassifiedDay {
  const reason = restReason(date, cal);
  if (date < employment.joinDate || (employment.exitDate && date > employment.exitDate)) {
    return { date, kind: 'NOT_EMPLOYED', restReason: reason };
  }
  const rest = record?.restDay ?? reason !== null;
  if (rest) {
    const kind: DayKind =
      record?.status === AttendanceStatus.PRESENT
        ? 'EXTRA'
        : record?.status === AttendanceStatus.HALF_DAY
          ? 'EXTRA_HALF'
          : 'OFF';
    return { date, kind, restReason: reason ?? 'WEEKLY_OFF' };
  }
  if (!record) return { date, kind: 'UNMARKED', restReason: null };
  switch (record.status) {
    case AttendanceStatus.PRESENT:
      return { date, kind: 'PRESENT', restReason: null };
    case AttendanceStatus.ABSENT:
      return { date, kind: 'ABSENT', restReason: null };
    case AttendanceStatus.HALF_DAY:
      return { date, kind: 'HALF_DAY', restReason: null };
    case AttendanceStatus.LEAVE:
      return { date, kind: record.covered ? 'LEAVE_PAID' : 'LEAVE_UNPAID', restReason: null };
    default:
      // OFF on a working day can only come from a record whose rest-day snapshot said otherwise.
      return { date, kind: 'OFF', restReason: null };
  }
}

export interface MonthSummary {
  employedDays: number;
  workingDays: number;
  restDays: number;
  present: number;
  halfDays: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
  off: number;
  /** Rest days worked, in days ("1.5"). */
  extraDays: string;
  unmarked: number;
  /**
   * The salary sheet's "Absent" column: absences + half of each half day +
   * uncovered leave − extra days worked. Negative when they worked more
   * rest days than they missed — exactly as the workbook does.
   */
  payrollAbsentDays: string;
}

export function summarizeDays(days: ClassifiedDay[]): MonthSummary {
  const count = (kind: DayKind) => days.filter((d) => d.kind === kind).length;
  const present = count('PRESENT');
  const halfDays = count('HALF_DAY');
  const absent = count('ABSENT');
  const paidLeave = count('LEAVE_PAID');
  const unpaidLeave = count('LEAVE_UNPAID');
  const off = count('OFF');
  const extra = count('EXTRA');
  const extraHalf = count('EXTRA_HALF');
  const unmarked = count('UNMARKED');
  const extraHalves = extra * 2 + extraHalf;
  const deductibleHalves = absent * 2 + halfDays + unpaidLeave * 2;
  const restDays = off + extra + extraHalf;
  const employedDays = days.length - count('NOT_EMPLOYED');
  return {
    employedDays,
    workingDays: employedDays - restDays,
    restDays,
    present,
    halfDays,
    absent,
    paidLeave,
    unpaidLeave,
    off,
    extraDays: fromHalves(extraHalves),
    unmarked,
    payrollAbsentDays: fromHalves(deductibleHalves - extraHalves),
  };
}
