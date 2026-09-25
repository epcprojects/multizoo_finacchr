import { BonusSplitMethod, PayBasis } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { daysInclusive, fromHalves, toHalves, type DayKind, type IsoDate } from '../hr/hr-math';

/**
 * The pure arithmetic behind payroll, the bonus pool and settlement — no
 * framework, no database, no floats. Money is BigInt paisa throughout;
 * days are integer half-days (see hr-math).
 *
 * The salary sheet's two formulas carry over exactly (architecture plan
 * Fig. 8):
 *
 *   Gross (G) = Salary − Salary/30 × Absent − Advance
 *   Net   (K) = Gross + Bonus − Fine − Food
 *
 * Each input now has a source: Absent from the attendance register,
 * Advance from outstanding salary advances, Bonus from the commission pool
 * plus allowances, Fine from approved fines. When the accountant switches
 * them on, EOBI, income tax and provident fund come off after Food.
 */

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/** n ÷ d rounded half away from zero — the spreadsheet's display rounding, in paisa. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('Divisor must be positive');
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const q = (abs * 2n + d) / (2n * d);
  return negative ? -q : q;
}

/** ⌊n ÷ d⌋ for non-negative n. */
function divFloor(n: bigint, d: bigint): bigint {
  return n / d;
}

/** A percentage with up to 2 decimals ("38", "8.33") → basis points (3800, 833). */
export function toBasisPoints(pct: string | number): bigint {
  return toPaisa(typeof pct === 'number' ? pct.toFixed(2) : pct);
}

/** Largest-remainder split: shares proportional to `weights` that add up to exactly `total`. */
export function splitExactly(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum <= 0n || total <= 0n) return weights.map(() => 0n);
  const raw = weights.map((w) => total * w);
  const base = raw.map((r) => divFloor(r, sum));
  let left = total - base.reduce((s, b) => s + b, 0n);
  const order = raw
    .map((r, i) => ({ i, rem: r % sum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    base[i] += 1n;
    left -= 1n;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Salary for the month
// ---------------------------------------------------------------------------

/** One day they were employed, with the salary revision in force on it. */
export interface PayDay {
  date: IsoDate;
  kind: DayKind;
  /** Monthly salary, or the daily rate for daily-wage staff, in paisa. */
  rate: bigint;
  basis: PayBasis;
}

export interface EarnedInput {
  /** Every day of the month they were employed, oldest first. */
  days: PayDay[];
  /** Days in the calendar month. */
  monthDays: number;
  /** The sheet's divisor — 30, whatever the month. */
  daysPerMonth: number;
  /** The register's "absent for payroll", half-days (may be negative). */
  payrollAbsentHalves: number;
}

export interface EarnedResult {
  basis: PayBasis;
  /** The "New Salary" column: the rate in force on their last employed day. */
  salary: bigint;
  /** Salary for the days employed, before absences (a full month = the salary). */
  earned: bigint;
  /** Salary/30 × Absent — negative when they worked more rest days than they missed. */
  absenceDeduction: bigint;
  /** Daily-wage staff: the days paid, in half-days. */
  paidHalves: number;
}

/** Half-days of pay a daily-wage day earns. */
const DAILY_UNITS: Partial<Record<DayKind, number>> = {
  PRESENT: 2,
  HALF_DAY: 1,
  LEAVE_PAID: 2,
  EXTRA: 2,
  EXTRA_HALF: 1,
};

/**
 * What a month's salary comes to before advances and bonuses.
 *
 * - **Monthly, employed all month:** the salary. A raise part-way through
 *   is weighted by days (15 days at the old rate, 15 at the new).
 * - **Monthly, joined or left part-way:** Salary/30 per day employed, never
 *   more than a full month's salary.
 * - **Absences** then come off at Salary/30 each, exactly as the sheet's
 *   `D/30*E` does — so an extra day worked (Absent −1) adds a day's pay.
 * - **Daily wage:** the day rate for each day worked or on paid leave (a
 *   half day is half); days not worked simply aren't paid, so nothing is
 *   deducted on top.
 *
 * A month is paid on the basis in force on the last day employed.
 */
export function earnedForMonth(input: EarnedInput): EarnedResult {
  const { days, monthDays, daysPerMonth } = input;
  if (!days.length) {
    return { basis: PayBasis.MONTHLY, salary: 0n, earned: 0n, absenceDeduction: 0n, paidHalves: 0 };
  }
  const last = days[days.length - 1];
  const divisor = BigInt(daysPerMonth);

  if (last.basis === PayBasis.DAILY) {
    let halves = 0;
    let earnedHalfRates = 0n;
    for (const d of days) {
      const units = DAILY_UNITS[d.kind] ?? 0;
      halves += units;
      earnedHalfRates += d.rate * BigInt(units);
    }
    return {
      basis: PayBasis.DAILY,
      salary: last.rate,
      earned: divRound(earnedHalfRates, 2n),
      absenceDeduction: 0n,
      paidHalves: halves,
    };
  }

  const rateSum = days.reduce((s, d) => s + d.rate, 0n);
  let earned: bigint;
  if (days.length >= monthDays) {
    earned = divRound(rateSum, BigInt(monthDays));
  } else {
    const maxRate = days.reduce((m, d) => (d.rate > m ? d.rate : m), 0n);
    earned = divRound(rateSum, divisor);
    if (earned > maxRate) earned = maxRate;
  }
  // Salary/30 × absent, where absent is in half-days: × halves ÷ (30 × 2).
  const absenceDeduction = divRound(last.rate * BigInt(input.payrollAbsentHalves), divisor * 2n);
  return { basis: PayBasis.MONTHLY, salary: last.rate, earned, absenceDeduction, paidHalves: 0 };
}

// ---------------------------------------------------------------------------
// Statutory deductions
// ---------------------------------------------------------------------------

export interface TaxBand {
  /** Annual income where this band starts, in rupees ("600000"). */
  from: string;
  /** Percent of the income inside this band ("11"). */
  rate: string;
}

export interface StatutoryRules {
  eobiEnabled: boolean;
  /** EOBI is charged on the notified minimum wage, not the actual salary. */
  eobiMinimumWage: string;
  eobiEmployeePct: string;
  eobiEmployerPct: string;
  /** Whether this person's employment type is registered for EOBI. */
  eobiApplies: boolean;
  taxEnabled: boolean;
  taxBands: TaxBand[];
  pfEnabled: boolean;
  pfEmployeePct: string;
  pfEmployerPct: string;
}

/** Progressive tax on an annual income, each band's rate applying only to the slice inside it. */
export function annualTax(annualIncome: bigint, bands: TaxBand[]): bigint {
  const sorted = [...bands].map((b) => ({ from: toPaisa(b.from), bp: toBasisPoints(b.rate) })).sort((a, b) => (a.from < b.from ? -1 : 1));
  let tax = 0n;
  sorted.forEach((band, i) => {
    const to = i + 1 < sorted.length ? sorted[i + 1].from : null;
    const top = to !== null && annualIncome > to ? to : annualIncome;
    if (top > band.from) tax += ((top - band.from) * band.bp) / 10_000n;
  });
  return tax;
}

export interface StatutoryResult {
  eobiEmployee: bigint;
  eobiEmployer: bigint;
  /** This month's withholding: the annualised tax ÷ 12. */
  tax: bigint;
  pfEmployee: bigint;
  pfEmployer: bigint;
}

export const NO_STATUTORY: StatutoryResult = { eobiEmployee: 0n, eobiEmployer: 0n, tax: 0n, pfEmployee: 0n, pfEmployer: 0n };

/**
 * EOBI on the minimum wage (5% employer, 1% employee by default); income tax
 * on this month's taxable pay × 12, spread back over the month; provident
 * fund as a percentage of the salary earned. Each is off until the
 * accountant switches it on in the payroll policy.
 */
export function statutoryFor(rules: StatutoryRules, taxablePay: bigint, pfBase: bigint): StatutoryResult {
  if (taxablePay <= 0n) return NO_STATUTORY;
  const pct = (amount: bigint, p: string) => divRound(amount * toBasisPoints(p), 10_000n);
  const eobi = rules.eobiEnabled && rules.eobiApplies;
  const wage = toPaisa(rules.eobiMinimumWage);
  return {
    eobiEmployee: eobi ? pct(wage, rules.eobiEmployeePct) : 0n,
    eobiEmployer: eobi ? pct(wage, rules.eobiEmployerPct) : 0n,
    tax: rules.taxEnabled ? divRound(annualTax(taxablePay * 12n, rules.taxBands), 12n) : 0n,
    pfEmployee: rules.pfEnabled ? pct(pfBase, rules.pfEmployeePct) : 0n,
    pfEmployer: rules.pfEnabled ? pct(pfBase, rules.pfEmployerPct) : 0n,
  };
}

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------

export interface AdvanceBalance {
  id: string;
  issueDate: IsoDate;
  outstanding: bigint;
  /** Per-month recovery; null = recover the whole balance at the next payroll. */
  installment: bigint | null;
}

/** How much of each advance this month recovers — oldest first, never more than `available`. */
export function planRecovery(
  advances: AdvanceBalance[],
  available: bigint,
  override: bigint | null = null,
): { id: string; amount: bigint }[] {
  const sorted = [...advances].filter((a) => a.outstanding > 0n).sort((a, b) => (a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : 0));
  const scheduled = sorted.reduce((s, a) => s + (a.installment !== null && a.installment < a.outstanding ? a.installment : a.outstanding), 0n);
  const outstanding = sorted.reduce((s, a) => s + a.outstanding, 0n);
  let budget = override !== null ? (override < outstanding ? override : outstanding) : scheduled;
  if (budget > available) budget = available > 0n ? available : 0n;

  const out: { id: string; amount: bigint }[] = [];
  for (const a of sorted) {
    if (budget <= 0n) break;
    const want = override !== null ? a.outstanding : a.installment !== null && a.installment < a.outstanding ? a.installment : a.outstanding;
    const take = want < budget ? want : budget;
    if (take > 0n) out.push({ id: a.id, amount: take });
    budget -= take;
  }
  return out;
}

// ---------------------------------------------------------------------------
// One payslip
// ---------------------------------------------------------------------------

export interface PayslipInput {
  earned: EarnedResult;
  /** Commission-pool shares for the month. */
  poolBonus: bigint;
  /** Allowances / one-off incentives entered for the run. */
  allowances: bigint;
  fines: bigint;
  food: bigint;
  otherDeductions: bigint;
  advances: AdvanceBalance[];
  advanceOverride: bigint | null;
  statutory: StatutoryRules;
}

export interface PayslipResult {
  basis: PayBasis;
  salary: bigint;
  earned: bigint;
  absenceDeduction: bigint;
  /** Earned − absences, never below zero. */
  salaryForDays: bigint;
  advanceRecovered: bigint;
  recoveries: { id: string; amount: bigint }[];
  /** The sheet's G: salary for the days worked less the advance. */
  gross: bigint;
  /** The sheet's H: pool share + allowances. */
  bonus: bigint;
  poolBonus: bigint;
  allowances: bigint;
  fines: bigint;
  food: bigint;
  otherDeductions: bigint;
  statutory: StatutoryResult;
  /** The sheet's K. Negative only when fines and deductions exceed the pay — finalising refuses that. */
  net: bigint;
  /** What the company spends: salary + bonus + employer contributions. */
  cost: bigint;
}

export function computePayslip(input: PayslipInput): PayslipResult {
  const e = input.earned;
  let salaryForDays = e.earned - e.absenceDeduction;
  if (salaryForDays < 0n) salaryForDays = 0n;
  const bonus = input.poolBonus + input.allowances;
  const statutory = statutoryFor(input.statutory, salaryForDays + bonus, e.earned);
  const statutoryEmployee = statutory.eobiEmployee + statutory.tax + statutory.pfEmployee;
  const beforeAdvance = salaryForDays + bonus - input.fines - input.food - input.otherDeductions - statutoryEmployee;
  const recoveries = planRecovery(input.advances, beforeAdvance, input.advanceOverride);
  const advanceRecovered = recoveries.reduce((s, r) => s + r.amount, 0n);
  return {
    basis: e.basis,
    salary: e.salary,
    earned: e.earned,
    absenceDeduction: e.absenceDeduction,
    salaryForDays,
    advanceRecovered,
    recoveries,
    gross: salaryForDays - advanceRecovered,
    bonus,
    poolBonus: input.poolBonus,
    allowances: input.allowances,
    fines: input.fines,
    food: input.food,
    otherDeductions: input.otherDeductions,
    statutory,
    net: beforeAdvance - advanceRecovered,
    cost: salaryForDays + bonus + statutory.eobiEmployer + statutory.pfEmployer,
  };
}

// ---------------------------------------------------------------------------
// The commission pool (Bonus Calculator, Fig. 9)
// ---------------------------------------------------------------------------

export interface BonusTierRule {
  tier: string;
  /** Percent of the pool ("38"). */
  pct: string;
  split: BonusSplitMethod;
  /** Round each person's share UP to a whole rupee (the sheet's CEILING(…, 1)). */
  roundUp: boolean;
}

export interface BonusMember {
  employeeId: string;
  tier: string;
  /** Trips, visits … — only used by BY_UNITS tiers. */
  units: string;
}

export interface BonusPoolResult {
  /** FLOOR(sales × 5%, 1): whole rupees, rounded down. */
  pool: bigint;
  tiers: { tier: string; amount: bigint; headcount: number; totalUnits: string; distributed: bigint; perUnit: string | null }[];
  shares: { employeeId: string; tier: string; amount: bigint }[];
  /** Pool left with nobody to pay (a tier with no members) — positive — or paid over by rounding up — negative. */
  undistributed: bigint;
}

/** Units are whole or 2-decimal counts; compared as hundredths. */
function toHundredths(units: string): bigint {
  return toPaisa(units);
}

/**
 * The Bonus Calculator: the pool is qualifying sales × commission %,
 * rounded DOWN to a whole rupee (never promise more than was earned);
 * each tier takes its % of the pool; each tier divides equally per head or
 * by a count such as trips; a tier marked "round up" pays each person a
 * whole rupee rounded UP (never leave an odd rupee undistributed).
 */
export function bonusPool(
  qualifyingSales: bigint,
  commissionPct: string,
  rules: BonusTierRule[],
  members: BonusMember[],
): BonusPoolResult {
  const pool = (qualifyingSales * toBasisPoints(commissionPct)) / 10_000n / 100n * 100n;
  const tierAmounts = splitExactly(pool, rules.map((r) => toBasisPoints(r.pct)));
  const shares: BonusPoolResult['shares'] = [];
  const tiers = rules.map((rule, i) => {
    const amount = tierAmounts[i];
    const people = members.filter((m) => m.tier === rule.tier);
    const weights = people.map((m) => (rule.split === BonusSplitMethod.EQUAL ? 1n : toHundredths(m.units)));
    const totalWeight = weights.reduce((s, w) => s + w, 0n);
    let amounts: bigint[];
    if (totalWeight <= 0n) {
      amounts = people.map(() => 0n);
    } else if (rule.roundUp) {
      // CEILING(tier × w / Σw, 1): up to the next whole rupee.
      amounts = weights.map((w) => {
        const exact = amount * w;
        const unit = totalWeight * 100n;
        return ((exact + unit - 1n) / unit) * 100n;
      });
    } else {
      amounts = splitExactly(amount, weights);
    }
    people.forEach((p, j) => shares.push({ employeeId: p.employeeId, tier: rule.tier, amount: amounts[j] }));
    const distributed = amounts.reduce((s, a) => s + a, 0n);
    const totalUnits = rule.split === BonusSplitMethod.EQUAL ? `${people.length}.00` : fromPaisa(totalWeight);
    return {
      tier: rule.tier,
      amount,
      headcount: people.length,
      totalUnits,
      distributed,
      perUnit: totalWeight > 0n ? fromPaisa(divRound(amount * 100n, totalWeight)) : null,
    };
  });
  const distributed = tiers.reduce((s, t) => s + t.distributed, 0n);
  return { pool, tiers, shares, undistributed: pool - distributed };
}

// ---------------------------------------------------------------------------
// Leave encashment (full & final settlement, Fig. 15)
// ---------------------------------------------------------------------------

export interface EncashInput {
  exitDate: IsoDate;
  /** The exit year's ledger figures, in half-days. */
  carriedIn: number;
  adjustments: number;
  /** The full year's entitlement as credited on 1 Jan (or pro-rated from eligibility). */
  entitlement: number;
  eligibleFrom: IsoDate;
  taken: number;
}

/**
 * Days that can be paid out on exit: what was carried in and adjusted, plus
 * the year's entitlement earned up to the exit date (pro-rated, rounded
 * DOWN to a half day), less what was taken. Never negative.
 */
export function encashableHalves(input: EncashInput): number {
  const year = input.exitDate.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const start = input.eligibleFrom > yearStart ? input.eligibleFrom : yearStart;
  let earned = 0;
  if (input.entitlement > 0 && input.exitDate >= start) {
    earned = Math.floor((input.entitlement * daysInclusive(start, input.exitDate)) / daysInclusive(start, yearEnd));
  }
  return Math.max(0, input.carriedIn + input.adjustments + earned - input.taken);
}

/** Salary/30 per day (or the day rate), × days, rounded to the paisa. */
export function encashmentAmount(rate: bigint, basis: PayBasis, halves: number, daysPerMonth: number): bigint {
  const halvesPerRate = basis === PayBasis.DAILY ? 2n : BigInt(daysPerMonth) * 2n;
  return divRound(rate * BigInt(halves), halvesPerRate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { fromHalves, toHalves };

export function money(p: bigint): string {
  return fromPaisa(p);
}
