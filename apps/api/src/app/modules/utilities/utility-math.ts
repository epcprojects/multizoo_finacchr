import { fromPaisa, toPaisa } from '@multizoo/utils';

/**
 * Utility sub-meter cost allocation (architecture plan Part 03 §8, Fig. 10),
 * with no framework or database attached — the parity suite drives it with
 * the cycles on `Sample cash flow.xlsx → Sub Meters Details`.
 *
 * Two mechanisms, both kept exactly as the sheet has them:
 *
 *   SUB-METERED (the Zoo Green Meter)
 *     consumed   = end reading − start reading                 G9 = F9−E9
 *     deserving  = consumed ÷ days read × 30, when a meter      H9 = G9/26*30
 *                  covered only part of the cycle
 *     rate       = bill ÷ units on the bill                     E21 = E19/E20
 *     charge     = deserving × rate                             I9 = H9*rate
 *     remainder  = bill units − Σ deserving, split by %         H15 = E20−H14
 *                  (70% Zoo / 30% Panda Cafe, later 100% Zoo)   H16 = H15*70/100
 *
 *   SHARED (the Admin Block IESCO bill)
 *     each unit's share = its weights ÷ all weights             L138 = K138/K137
 *     (CEO Office ½ Z & Co, ½ Zoo …: 5.5 of 10 offices = 55%)   = 87271*L138
 *
 * Every figure is computed as an exact fraction, then rounded to the paisa
 * once, with the leftover paisa going to the largest remainders — so the
 * charges always add up to the bill exactly. Nothing here touches a float.
 */

/** An exact fraction n/d, d > 0. */
interface Frac {
  n: bigint;
  d: bigint;
}

const frac = (n: bigint, d = 1n): Frac => (d < 0n ? { n: -n, d: -d } : { n, d });
const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Frac, b: Frac): Frac => add(a, frac(-b.n, b.d));
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const isNeg = (a: Frac) => a.n < 0n;

/** Round half up (away from zero) to an integer. */
function roundFrac(a: Frac): bigint {
  const neg = a.n < 0n;
  const n = neg ? -a.n : a.n;
  const q = (n * 2n + a.d) / (2n * a.d);
  return neg ? -q : q;
}

/** Hundredths as a decimal string: 67200n → "672.00". */
function fromHundredths(h: bigint): string {
  return fromPaisa(h);
}

const UNITS_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const PCT_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;
const WEIGHT_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;

/** Meter units carry up to 2 decimals; held as hundredths. */
export function toHundredths(value: string): bigint {
  const text = String(value).trim();
  if (!UNITS_PATTERN.test(text)) throw new UtilityMathError(`Invalid reading: "${value}" (at most 2 decimal places)`);
  return toPaisa(text);
}

/** Percentages and weights carry up to 4 decimals; held ×10,000. */
function toScaled(value: string, pattern: RegExp, what: string): bigint {
  const text = String(value).trim();
  if (!pattern.test(text)) throw new UtilityMathError(`Invalid ${what}: "${value}" (at most 4 decimal places)`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

export class UtilityMathError extends Error {}

/**
 * Splits `total` paisa between exact shares that add up to it: each is
 * floored, then the leftover paisa go one at a time to the largest
 * remainders (earliest first on a tie). Σ result = total, always.
 */
function apportion(shares: Frac[], total: bigint): bigint[] {
  const floors = shares.map((s) => {
    const q = s.n / s.d;
    return s.n < 0n && s.n % s.d !== 0n ? q - 1n : q;
  });
  let left = total - floors.reduce((a, b) => a + b, 0n);
  const order = shares
    .map((s, i) => ({ i, rem: sub(s, frac(floors[i])) }))
    .sort((a, b) => {
      const diff = a.rem.n * b.rem.d - b.rem.n * a.rem.d;
      return diff > 0n ? -1 : diff < 0n ? 1 : a.i - b.i;
    });
  const out = [...floors];
  for (let k = 0; left > 0n && order.length; k = (k + 1) % order.length, left--) out[order[k].i] += 1n;
  return out;
}

// --- Sub-metered ------------------------------------------------------------------

export interface MeterReadingInput {
  /** Identifies the sub-meter. */
  key: string;
  label: string;
  /** The unit its consumption is charged to. */
  unitKey: string;
  start: string;
  end: string;
  /**
   * Days the reading covers, when the meter was read over part of the cycle
   * (installed or replaced mid-cycle). Its consumption is then pro-rated to
   * a standard cycle: consumed ÷ days × standardDays. Blank = the whole
   * cycle, no pro-rating.
   */
  daysCovered?: number | null;
}

export interface RemainderSplitInput {
  unitKey: string;
  label?: string;
  /** % of the unmetered units. The splits total exactly 100%. */
  pct: string;
}

export interface SubMeteredInput {
  billAmount: string;
  /** Units on the bill — the main meter. */
  totalUnits: string;
  /** The cycle a part reading is pro-rated to (30 on the sheet). */
  standardDays: number;
  readings: MeterReadingInput[];
  remainder: RemainderSplitInput[];
}

export interface AllocationRow {
  key: string;
  label: string;
  unitKey: string;
  /** Meter readings only. */
  consumed: string | null;
  /** Units charged: the (pro-rated) consumption, or a share of the remainder. */
  units: string;
  /** Remainder rows only. */
  pct: string | null;
  charge: string;
}

export interface UnitCharge {
  unitKey: string;
  units: string | null;
  charge: string;
}

export interface AllocationResult {
  rate: string | null;
  metered: AllocationRow[];
  remainderUnits: string | null;
  remainder: AllocationRow[];
  byUnit: UnitCharge[];
  total: string;
}

/** The Sub Meters Details block, for one billing cycle. */
export function allocateSubMetered(input: SubMeteredInput): AllocationResult {
  const bill = toPaisa(input.billAmount);
  const total = toHundredths(input.totalUnits);
  if (bill <= 0n) throw new UtilityMathError('Enter the bill amount.');
  if (total <= 0n) throw new UtilityMathError('Enter the units on the bill.');
  if (!Number.isInteger(input.standardDays) || input.standardDays < 1) {
    throw new UtilityMathError('The standard cycle must be a whole number of days.');
  }
  const std = BigInt(input.standardDays);

  // Units are hundredths; a charge in paisa is units × bill ÷ total.
  const perUnit = frac(bill, total);
  const meters = input.readings.map((r) => {
    const start = toHundredths(r.start);
    const end = toHundredths(r.end);
    if (end < start) throw new UtilityMathError(`${r.label}: the end reading is below the start reading.`);
    const consumed = end - start;
    let deserving = frac(consumed);
    if (r.daysCovered != null) {
      if (!Number.isInteger(r.daysCovered) || r.daysCovered < 1) {
        throw new UtilityMathError(`${r.label}: days read must be a whole number of days.`);
      }
      deserving = frac(consumed * std, BigInt(r.daysCovered));
    }
    return { r, consumed, deserving };
  });

  const meteredUnits = meters.reduce((s, x) => add(s, x.deserving), frac(0n));
  const remainderUnits = sub(frac(total), meteredUnits);
  if (isNeg(remainderUnits)) {
    throw new UtilityMathError(
      `The sub-meters come to ${fromHundredths(roundFrac(meteredUnits))} units — more than the ${fromHundredths(total)} on the bill.`,
    );
  }
  const hasRemainder = remainderUnits.n !== 0n;
  const pcts = input.remainder.map((s) => toScaled(s.pct, PCT_PATTERN, 'percentage'));
  const pctTotal = pcts.reduce((a, b) => a + b, 0n);
  if (hasRemainder && pctTotal !== 1_000_000n) {
    throw new UtilityMathError(
      `The unmetered units must be split 100% — the split adds up to ${fromScaledPct(pctTotal)}%.`,
    );
  }

  const shares: Frac[] = [
    ...meters.map((x) => mul(x.deserving, perUnit)),
    ...pcts.map((p) => mul(mul(remainderUnits, frac(p, 1_000_000n)), perUnit)),
  ];
  const charges = apportion(shares, bill);

  const metered: AllocationRow[] = meters.map((x, i) => ({
    key: x.r.key,
    label: x.r.label,
    unitKey: x.r.unitKey,
    consumed: fromHundredths(x.consumed),
    units: fromHundredths(roundFrac(x.deserving)),
    pct: null,
    charge: fromPaisa(charges[i]),
  }));
  const remainder: AllocationRow[] = input.remainder.map((s, j) => ({
    key: `REMAINDER:${s.unitKey}`,
    label: s.label ?? 'Unmetered',
    unitKey: s.unitKey,
    consumed: null,
    units: fromHundredths(roundFrac(mul(remainderUnits, frac(pcts[j], 1_000_000n)))),
    pct: fromScaledPct(pcts[j]),
    charge: fromPaisa(charges[meters.length + j]),
  }));

  return {
    rate: fromRate(bill, total),
    metered,
    remainderUnits: fromHundredths(roundFrac(remainderUnits)),
    remainder,
    byUnit: byUnit([...metered, ...remainder], meters.map((x) => x.deserving), remainderUnits, pcts),
    total: fromPaisa(bill),
  };
}

function byUnit(rows: AllocationRow[], deserving: Frac[], remainderUnits: Frac, pcts: bigint[]): UnitCharge[] {
  const map = new Map<string, { units: Frac; charge: bigint }>();
  rows.forEach((row, i) => {
    const units = i < deserving.length ? deserving[i] : mul(remainderUnits, frac(pcts[i - deserving.length], 1_000_000n));
    const cur = map.get(row.unitKey) ?? { units: frac(0n), charge: 0n };
    map.set(row.unitKey, { units: add(cur.units, units), charge: cur.charge + toPaisa(row.charge) });
  });
  return [...map.entries()].map(([unitKey, v]) => ({
    unitKey,
    units: fromHundredths(roundFrac(v.units)),
    charge: fromPaisa(v.charge),
  }));
}

/** Rs per unit to 4 decimals, for display: 378848 ÷ 4806 → "78.8281". */
function fromRate(billPaisa: bigint, totalHundredths: bigint): string {
  // (bill/100) ÷ (units/100) = bill ÷ units; ×10,000 for 4 decimals.
  const scaled = roundFrac(frac(billPaisa * 10_000n, totalHundredths));
  const whole = scaled / 10_000n;
  return `${whole}.${(scaled % 10_000n).toString().padStart(4, '0')}`;
}

function fromScaledPct(value: bigint): string {
  const whole = value / 10_000n;
  const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

// --- Shared by weights -----------------------------------------------------------

export interface ShareInput {
  /** e.g. "CEO Office". */
  label: string;
  /** How much of it each unit owns: { ZCO: "0.5", ZOO: "0.5" }. */
  weights: Record<string, string>;
}

/** The Admin Block IESCO bill: each unit pays its weights ÷ all weights. */
export function allocateShared(billAmount: string, shares: ShareInput[]): AllocationResult {
  const bill = toPaisa(billAmount);
  if (bill <= 0n) throw new UtilityMathError('Enter the bill amount.');
  const totals = new Map<string, bigint>();
  for (const s of shares) {
    for (const [unitKey, w] of Object.entries(s.weights)) {
      const scaled = toScaled(w, WEIGHT_PATTERN, `weight for ${s.label}`);
      totals.set(unitKey, (totals.get(unitKey) ?? 0n) + scaled);
    }
  }
  const all = [...totals.values()].reduce((a, b) => a + b, 0n);
  if (all <= 0n) throw new UtilityMathError('Give at least one weight to share the bill by.');
  const units = [...totals.entries()].filter(([, w]) => w > 0n);
  const charges = apportion(units.map(([, w]) => frac(w * bill, all)), bill);
  const rows: AllocationRow[] = units.map(([unitKey, w], i) => ({
    key: `SHARE:${unitKey}`,
    label: 'Share',
    unitKey,
    consumed: null,
    units: fromScaledPct(w),
    pct: fromScaledPct(roundFrac(frac(w * 1_000_000n, all))),
    charge: fromPaisa(charges[i]),
  }));
  return {
    rate: null,
    metered: [],
    remainderUnits: null,
    remainder: rows,
    byUnit: rows.map((r) => ({ unitKey: r.unitKey, units: null, charge: r.charge })),
    total: fromPaisa(bill),
  };
}
