import { fromPaisa, toPaisa } from '@multizoo/utils';
import { addDays } from '../hr/hr-math';

/**
 * The arithmetic behind sales capture and its rollups (architecture plan
 * Part 03 §9, Fig. 11) — pure BigInt paisa, no framework, so the parity
 * suite can drive it with the workbooks' own rows.
 *
 *  - a line is Qty × Rate (`Ticket sales` column I, `=H5*G5`);
 *  - the day-of-month × month grid, its "Total Sales", "Monthly Avg Sale"
 *    (`=M37/31` — the month's total over its calendar days) and "Yearly
 *    Avg Sale Per Day" (`=K1/COUNT(C4:N34)` — over the days that have a
 *    figure);
 *  - the category breakup, amount and count per item per month (the
 *    `SUMIFS` block at Z4:AX40);
 *  - a named peak event compared day by day across years (`Eid Sales
 *    Comperison`), income and footfall.
 *
 * The workbook keeps unrounded averages (21327.25806); here an average is
 * rounded half-up to the paisa, once.
 */

export class SalesMathError extends Error {}

/** Rounds `paisa / n` half-up (away from zero) to the paisa. */
export function divRound(paisa: bigint, n: bigint): bigint {
  if (n <= 0n) throw new SalesMathError('Cannot average over zero days.');
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  const q = (abs * 2n + n) / (2n * n);
  return negative ? -q : q;
}

/** Qty × Rate, exact. Quantities are whole (tickets, packets, rides). */
export function lineAmount(quantity: number, rate: string): string {
  if (!Number.isInteger(quantity) || quantity < 0) throw new SalesMathError('The quantity must be a whole number, 0 or more.');
  const r = toPaisa(rate);
  if (r < 0n) throw new SalesMathError('The rate cannot be negative.');
  return fromPaisa(BigInt(quantity) * r);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// ---------------------------------------------------------------------------
// The day-of-month × month grid
// ---------------------------------------------------------------------------

export interface DailyAmount {
  /** YYYY-MM-DD */
  date: string;
  amount: string;
}

export interface GridMonth {
  month: number;
  name: string;
  /** Index 0 = the 1st. null where the month has no such day, or nothing was sold. */
  days: (string | null)[];
  total: string;
  daysInMonth: number;
  /** "Monthly Avg Sale": the month's total over its calendar days (=M37/31). */
  averagePerDay: string;
  daysWithSales: number;
}

export interface SalesGrid {
  year: number;
  months: GridMonth[];
  /** "Grand Total" (=Sum(M37:X37)). */
  total: string;
  daysWithSales: number;
  /** "Yearly Avg Sale Per Day" (=K1/COUNT(C4:N34)): over the days with a figure. */
  averagePerSalesDay: string | null;
}

/**
 * The sheet's grid for one year. Several figures for one date (several
 * units, several lines) add up into its cell.
 */
export function salesGrid(year: number, amounts: DailyAmount[]): SalesGrid {
  const cells = new Map<string, bigint>();
  for (const a of amounts) {
    if (!a.date.startsWith(`${year}-`)) continue;
    cells.set(a.date, (cells.get(a.date) ?? 0n) + toPaisa(a.amount));
  }
  let total = 0n;
  let salesDays = 0;
  const months: GridMonth[] = [];
  for (let month = 1; month <= 12; month++) {
    const dim = daysInMonth(year, month);
    let monthTotal = 0n;
    let monthDays = 0;
    const days: (string | null)[] = [];
    for (let day = 1; day <= 31; day++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const v = day <= dim ? cells.get(date) : undefined;
      if (v === undefined) {
        days.push(null);
        continue;
      }
      days.push(fromPaisa(v));
      monthTotal += v;
      monthDays++;
    }
    total += monthTotal;
    salesDays += monthDays;
    months.push({
      month,
      name: MONTH_NAMES[month - 1],
      days,
      total: fromPaisa(monthTotal),
      daysInMonth: dim,
      averagePerDay: fromPaisa(divRound(monthTotal, BigInt(dim))),
      daysWithSales: monthDays,
    });
  }
  return {
    year,
    months,
    total: fromPaisa(total),
    daysWithSales: salesDays,
    averagePerSalesDay: salesDays ? fromPaisa(divRound(total, BigInt(salesDays))) : null,
  };
}

// ---------------------------------------------------------------------------
// Category-wise breakup: amount and count per item per month
// ---------------------------------------------------------------------------

export interface ItemSale {
  /** YYYY-MM */
  month: string;
  item: string;
  category?: string | null;
  amount: string;
  /** Null for amount-only items (a day's cafe total). */
  quantity: number | null;
}

export interface ItemBreakupRow {
  item: string;
  category: string | null;
  amount: string;
  quantity: number;
  months: Record<string, { amount: string; quantity: number }>;
}

export interface ItemBreakup {
  items: ItemBreakupRow[];
  months: { month: string; amount: string; quantity: number }[];
  total: string;
  quantity: number;
}

/** The Z4:AX40 block: per item per month, Amount and Count, with totals. */
export function itemBreakup(sales: ItemSale[], order?: string[]): ItemBreakup {
  const rows = new Map<string, { category: string | null; amount: bigint; quantity: number; months: Map<string, { amount: bigint; quantity: number }> }>();
  const months = new Map<string, { amount: bigint; quantity: number }>();
  let total = 0n;
  let quantity = 0;
  for (const s of sales) {
    const amount = toPaisa(s.amount);
    const qty = s.quantity ?? 0;
    const row = rows.get(s.item) ?? { category: s.category ?? null, amount: 0n, quantity: 0, months: new Map() };
    row.amount += amount;
    row.quantity += qty;
    const cell = row.months.get(s.month) ?? { amount: 0n, quantity: 0 };
    cell.amount += amount;
    cell.quantity += qty;
    row.months.set(s.month, cell);
    rows.set(s.item, row);
    const m = months.get(s.month) ?? { amount: 0n, quantity: 0 };
    m.amount += amount;
    m.quantity += qty;
    months.set(s.month, m);
    total += amount;
    quantity += qty;
  }
  const rank = (item: string) => {
    const i = order?.indexOf(item) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return {
    items: [...rows.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([item, r]) => ({
        item,
        category: r.category,
        amount: fromPaisa(r.amount),
        quantity: r.quantity,
        months: Object.fromEntries(
          [...r.months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, { amount: fromPaisa(v.amount), quantity: v.quantity }]),
        ),
      })),
    months: [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, amount: fromPaisa(v.amount), quantity: v.quantity })),
    total: fromPaisa(total),
    quantity,
  };
}

// ---------------------------------------------------------------------------
// A peak event compared across years (Eid Sales Comperison)
// ---------------------------------------------------------------------------

export interface DayFigures {
  amount: string;
  adults: number;
  kids: number;
}

export interface EventOccurrence {
  year: number;
  /** The event's first day that year (1st day of Eid), YYYY-MM-DD. */
  startDate: string;
}

export interface EventYearTotal {
  year: number;
  startDate: string;
  amount: string;
  adults: number;
  kids: number;
  daysWithSales: number;
  /**
   * "Avarage/Day": the total over the days that had sales. The sheet
   * divides by 10 even when a year has fewer (F22 = 6,537,706 / 10 for a
   * 7-day 2024), but its own Panda Cafe column uses COUNT (S22) — this
   * follows S22.
   */
  averagePerDay: string | null;
  /** Against the year before it in the comparison. */
  change: { amount: string; pct: string | null; adults: number; kids: number } | null;
}

export interface EventComparison {
  days: number;
  rows: { day: number; byYear: Record<number, { date: string; amount: string | null; adults: number | null; kids: number | null }> }[];
  totals: EventYearTotal[];
}

/** (a − b) / b as a percentage to one decimal, e.g. "78.0"; null when b is 0. */
export function pctChange(current: bigint, previous: bigint): string | null {
  if (previous <= 0n) return null;
  const tenths = divRound((current - previous) * 1000n, previous);
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  return `${negative ? '-' : ''}${abs / 10n}.${abs % 10n}`;
}

/**
 * Day 1 … day N of an event, one column per year. `daily` holds each
 * date's figures (already summed over the units being compared).
 */
export function eventComparison(days: number, occurrences: EventOccurrence[], daily: Map<string, DayFigures>): EventComparison {
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new SalesMathError('An event runs 1 to 60 days.');
  const years = [...occurrences].sort((a, b) => a.year - b.year);
  const rows: EventComparison['rows'] = [];
  const acc = new Map<number, { amount: bigint; adults: number; kids: number; days: number }>();
  for (let i = 0; i < days; i++) {
    const byYear: EventComparison['rows'][number]['byYear'] = {};
    for (const o of years) {
      const date = addDays(o.startDate, i);
      const f = daily.get(date);
      const a = acc.get(o.year) ?? { amount: 0n, adults: 0, kids: 0, days: 0 };
      if (f) {
        a.amount += toPaisa(f.amount);
        a.adults += f.adults;
        a.kids += f.kids;
        a.days++;
      }
      acc.set(o.year, a);
      byYear[o.year] = { date, amount: f ? fromPaisa(toPaisa(f.amount)) : null, adults: f ? f.adults : null, kids: f ? f.kids : null };
    }
    rows.push({ day: i + 1, byYear });
  }
  const totals: EventYearTotal[] = [];
  let prev: { amount: bigint; adults: number; kids: number } | null = null;
  for (const o of years) {
    const a = acc.get(o.year) ?? { amount: 0n, adults: 0, kids: 0, days: 0 };
    totals.push({
      year: o.year,
      startDate: o.startDate,
      amount: fromPaisa(a.amount),
      adults: a.adults,
      kids: a.kids,
      daysWithSales: a.days,
      averagePerDay: a.days ? fromPaisa(divRound(a.amount, BigInt(a.days))) : null,
      change: prev
        ? { amount: fromPaisa(a.amount - prev.amount), pct: pctChange(a.amount, prev.amount), adults: a.adults - prev.adults, kids: a.kids - prev.kids }
        : null,
    });
    prev = a;
  }
  return { days, rows, totals };
}

// ---------------------------------------------------------------------------
// Year over year, month by month
// ---------------------------------------------------------------------------

export interface YearOverYear {
  year: number;
  months: { month: number; name: string; current: string; previous: string; change: string; pct: string | null }[];
  current: string;
  previous: string;
  change: string;
  pct: string | null;
  /** The same stretch of last year as has passed of this one (1 Jan – today's date last year). */
  toDate: { current: string; previous: string; pct: string | null } | null;
}

/**
 * This year against last, month by month, from per-date totals. When the
 * year is still running, `toDate` compares like with like: 1 Jan to today
 * against 1 Jan to the same date last year.
 */
export function yearOverYear(year: number, amounts: DailyAmount[], today?: string): YearOverYear {
  const cur = new Array<bigint>(12).fill(0n);
  const prev = new Array<bigint>(12).fill(0n);
  let curToDate = 0n;
  let prevToDate = 0n;
  const running = today && today.startsWith(`${year}-`) ? today.slice(5) : null;
  for (const a of amounts) {
    const y = Number(a.date.slice(0, 4));
    const m = Number(a.date.slice(5, 7)) - 1;
    const v = toPaisa(a.amount);
    if (y === year) {
      cur[m] += v;
      if (running && a.date.slice(5) <= running) curToDate += v;
    } else if (y === year - 1) {
      prev[m] += v;
      if (running && a.date.slice(5) <= running) prevToDate += v;
    }
  }
  const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
  const c = sum(cur);
  const p = sum(prev);
  return {
    year,
    months: cur.map((v, i) => ({
      month: i + 1,
      name: MONTH_NAMES[i],
      current: fromPaisa(v),
      previous: fromPaisa(prev[i]),
      change: fromPaisa(v - prev[i]),
      pct: pctChange(v, prev[i]),
    })),
    current: fromPaisa(c),
    previous: fromPaisa(p),
    change: fromPaisa(c - p),
    pct: pctChange(c, p),
    toDate: running ? { current: fromPaisa(curToDate), previous: fromPaisa(prevToDate), pct: pctChange(curToDate, prevToDate) } : null,
  };
}

// ---------------------------------------------------------------------------
// A day's sheet: lines and how the takings were received
// ---------------------------------------------------------------------------

export interface DayLineInput {
  amount: string;
}

export interface Receipt {
  accountId: string;
  amount: string;
}

/**
 * Checks a day before posting: the lines add up to the takings received
 * into cash, bank and wallet — every rupee sold is a rupee somewhere.
 */
export function dayProblems(lines: DayLineInput[], receipts: Receipt[]): string[] {
  const problems: string[] = [];
  const sold = lines.reduce((s, l) => s + toPaisa(l.amount), 0n);
  const received = receipts.reduce((s, r) => s + toPaisa(r.amount), 0n);
  if (!lines.length) problems.push('Add at least one line.');
  else if (sold <= 0n) problems.push('The day’s sales come to nothing — enter quantities or amounts.');
  if (lines.some((l) => toPaisa(l.amount) < 0n)) problems.push('A line can’t be negative.');
  if (receipts.some((r) => toPaisa(r.amount) < 0n)) problems.push('A receipt can’t be negative.');
  if (sold !== received) {
    problems.push(`The takings received (${fromPaisa(received)}) don’t match the sales (${fromPaisa(sold)}).`);
  }
  return problems;
}
