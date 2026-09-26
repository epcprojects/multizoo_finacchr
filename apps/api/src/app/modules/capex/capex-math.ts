import { fromPaisa, toPaisa } from '@multizoo/utils';
import { addMonths, daysInclusive } from '../hr/hr-math';
import { divRound, pctChange } from '../sales/sales-math';

/**
 * The capex register and campaign ledger (architecture plan Part 03 §11,
 * M11) — pure BigInt paisa, so the parity suite can drive it with the
 * workbooks' rows.
 *
 *  - `Dir Invst Zoo`: each purchase with its amount, purpose, "Roi Time
 *    Expct" and nature, and `F2 = SUM(B2:B1000)`, investment to date.
 *    Here the ROI window becomes a payback date, and — when the item's
 *    takings can be told apart on the price list (the boxing machine's
 *    rides) — how much of its cost it has earned back.
 *  - `Ramazan 2023`: money received for the drive against money issued for
 *    it, `Balance = Total Income − Total Expenses` (C3), next to a budget
 *    (`Total Amount Required For 30 Days @25000`, O7:O12).
 */

// ---------------------------------------------------------------------------
// Capex register
// ---------------------------------------------------------------------------

export interface CapexLine {
  amount: string;
  nature: string;
  unit: string;
  /** YYYY-MM-DD */
  purchaseDate: string;
}

export interface CapexSummary {
  /** "Total Investment" (F2). */
  total: string;
  count: number;
  byNature: { nature: string; amount: string; count: number }[];
  byUnit: { unit: string; amount: string; count: number }[];
  byYear: { year: string; amount: string; count: number }[];
}

export function capexSummary(items: CapexLine[]): CapexSummary {
  const group = (key: (i: CapexLine) => string) => {
    const map = new Map<string, { amount: bigint; count: number }>();
    for (const i of items) {
      const g = map.get(key(i)) ?? { amount: 0n, count: 0 };
      g.amount += toPaisa(i.amount);
      g.count++;
      map.set(key(i), g);
    }
    return [...map.entries()].map(([k, v]) => ({ key: k, amount: v.amount, count: v.count }));
  };
  const byAmount = (a: { amount: bigint; key: string }, b: { amount: bigint; key: string }) =>
    b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.key.localeCompare(b.key);
  return {
    total: fromPaisa(items.reduce((s, i) => s + toPaisa(i.amount), 0n)),
    count: items.length,
    byNature: group((i) => i.nature).sort(byAmount).map((g) => ({ nature: g.key, amount: fromPaisa(g.amount), count: g.count })),
    byUnit: group((i) => i.unit).sort(byAmount).map((g) => ({ unit: g.key, amount: fromPaisa(g.amount), count: g.count })),
    byYear: group((i) => i.purchaseDate.slice(0, 4))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => ({ year: g.key, amount: fromPaisa(g.amount), count: g.count })),
  };
}

/** "8 Months", "2 months", "1 year", "18" → months; null when there's no number. */
export function parsePaybackMonths(text: string | null | undefined): number | null {
  const m = /(\d+)\s*(year|yr)?/i.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n * 12 : n;
}

export type PaybackState =
  /** Earned back its cost. */
  | 'PAID_BACK'
  /** Earning at least as fast as its target needs. */
  | 'ON_TRACK'
  /** Behind the straight line to its target. */
  | 'BEHIND'
  /** Past its target date and not yet paid back. */
  | 'OVERDUE'
  /** Earning, but no target was set. */
  | 'NO_TARGET'
  /** Nothing on the price list is linked to it, so its takings can't be told apart. */
  | 'NOT_TRACKED';

export interface PaybackInput {
  cost: string;
  purchaseDate: string;
  /** "Roi Time Expct", in months; null when none was given. */
  paybackMonths: number | null;
  /** What it has taken, by date — null when no price-list item is linked. */
  earnings: { date: string; amount: string }[] | null;
  today: string;
}

export interface Payback {
  state: PaybackState;
  recovered: string | null;
  /** Of the cost, one decimal. */
  recoveredPct: string | null;
  remaining: string | null;
  /** Purchase date + the ROI window. */
  expectedBy: string | null;
  /** The day its takings first covered the cost. */
  paidBackOn: string | null;
  /** On a straight line to the target, what it should have earned by today. */
  expectedSoFar: string | null;
}

/**
 * How far a purchase is to paying for itself. Only takings on or after the
 * purchase date count. "On track" means at least the straight-line share of
 * its cost for the time gone: 4 months into an 8-month target, half.
 */
export function payback(input: PaybackInput): Payback {
  const cost = toPaisa(input.cost);
  const expectedBy = input.paybackMonths ? addMonths(input.purchaseDate, input.paybackMonths) : null;
  let expectedSoFar: bigint | null = null;
  if (expectedBy && cost > 0n) {
    const span = BigInt(daysInclusive(input.purchaseDate, expectedBy) - 1);
    const gone = BigInt(Math.max(0, daysInclusive(input.purchaseDate, input.today) - 1));
    expectedSoFar = span > 0n ? (gone >= span ? cost : divRound(cost * gone, span)) : cost;
  }
  if (!input.earnings) {
    return {
      state: 'NOT_TRACKED',
      recovered: null,
      recoveredPct: null,
      remaining: null,
      expectedBy,
      paidBackOn: null,
      expectedSoFar: expectedSoFar === null ? null : fromPaisa(expectedSoFar),
    };
  }
  const byDate = [...input.earnings].filter((e) => e.date >= input.purchaseDate && e.date <= input.today).sort((a, b) => a.date.localeCompare(b.date));
  let recovered = 0n;
  let paidBackOn: string | null = null;
  for (const e of byDate) {
    recovered += toPaisa(e.amount);
    if (!paidBackOn && cost > 0n && recovered >= cost) paidBackOn = e.date;
  }
  let state: PaybackState;
  if (paidBackOn) state = 'PAID_BACK';
  else if (!expectedBy) state = 'NO_TARGET';
  else if (input.today > expectedBy) state = 'OVERDUE';
  else state = recovered >= (expectedSoFar ?? 0n) ? 'ON_TRACK' : 'BEHIND';
  const remaining = cost - recovered;
  return {
    state,
    recovered: fromPaisa(recovered),
    recoveredPct: cost > 0n ? tenthsPct(recovered, cost) : null,
    remaining: fromPaisa(remaining > 0n ? remaining : 0n),
    expectedBy,
    paidBackOn,
    expectedSoFar: expectedSoFar === null ? null : fromPaisa(expectedSoFar),
  };
}

/** part / whole × 100, one decimal. */
function tenthsPct(part: bigint, whole: bigint): string {
  const t = divRound(part * 1000n, whole);
  const negative = t < 0n;
  const abs = negative ? -t : t;
  return `${negative ? '-' : ''}${abs / 10n}.${abs % 10n}`;
}

// ---------------------------------------------------------------------------
// Campaign ledger
// ---------------------------------------------------------------------------

export interface CampaignLine {
  date: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  amount: string;
}

export interface BudgetLine {
  label: string;
  amount: string;
}

export interface CampaignStatement {
  /** "Total" income (C2). */
  income: string;
  /** "Total" expenses (D2). */
  expenses: string;
  /** "Balance" (C3 = C2 − D2): negative when the host unit has carried the shortfall. */
  balance: string;
  incomeByCategory: { category: string; amount: string }[];
  expensesByCategory: { category: string; amount: string }[];
  /** Day by day, with the running balance. */
  byDate: { date: string; income: string; expenses: string; balance: string }[];
  budget: {
    /** O12 "Total Amount". */
    total: string;
    /** What's still to be raised to meet it (never below zero). */
    stillToRaise: string;
    /** Budget − spent: negative when over budget. */
    left: string;
    /** Spent, as a share of the budget. */
    spentPct: string | null;
  } | null;
  /** Expenses as a change on income: how far over (or under) what was raised it ran. */
  overRaisedPct: string | null;
}

export function campaignStatement(lines: CampaignLine[], budget: BudgetLine[] = []): CampaignStatement {
  let income = 0n;
  let expenses = 0n;
  const inCat = new Map<string, bigint>();
  const outCat = new Map<string, bigint>();
  const days = new Map<string, { income: bigint; expenses: bigint }>();
  for (const l of lines) {
    const a = toPaisa(l.amount);
    const d = days.get(l.date) ?? { income: 0n, expenses: 0n };
    if (l.type === 'INCOME') {
      income += a;
      d.income += a;
      inCat.set(l.category, (inCat.get(l.category) ?? 0n) + a);
    } else {
      expenses += a;
      d.expenses += a;
      outCat.set(l.category, (outCat.get(l.category) ?? 0n) + a);
    }
    days.set(l.date, d);
  }
  const cats = (m: Map<string, bigint>) =>
    [...m.entries()]
      .filter(([, v]) => v !== 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0])))
      .map(([category, v]) => ({ category, amount: fromPaisa(v) }));
  let running = 0n;
  const byDate = [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => {
      running += d.income - d.expenses;
      return { date, income: fromPaisa(d.income), expenses: fromPaisa(d.expenses), balance: fromPaisa(running) };
    });
  const budgetTotal = budget.reduce((s, b) => s + toPaisa(b.amount), 0n);
  const toRaise = budgetTotal - income;
  return {
    income: fromPaisa(income),
    expenses: fromPaisa(expenses),
    balance: fromPaisa(income - expenses),
    incomeByCategory: cats(inCat),
    expensesByCategory: cats(outCat),
    byDate,
    budget: budget.length
      ? {
          total: fromPaisa(budgetTotal),
          stillToRaise: fromPaisa(toRaise > 0n ? toRaise : 0n),
          left: fromPaisa(budgetTotal - expenses),
          spentPct: budgetTotal > 0n ? tenthsPct(expenses, budgetTotal) : null,
        }
      : null,
    overRaisedPct: pctChange(expenses, income),
  };
}
