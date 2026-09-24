import { AllocationMethod } from '@multizoo/types';

/**
 * The income allocation waterfall (architecture plan Part 03 §1, Fig. 3),
 * with no framework or database attached — the formula-parity suite drives
 * it directly with rows from the Formula sheet.
 *
 * A rule is a list of TRANCHES. Each tranche takes a share of the day's
 * gross income (the shares total exactly 100%) and divides it among its
 * LINES, either as percentages of the tranche (totalling exactly 100%) or
 * as a ratio of parts (25∶40). That covers every shape found in the
 * workbook:
 *
 *   Multi Zoo 2021   =(B3*65/100)*30/100   Ops 65% → Feed 30% of Ops
 *                    =B3*1/100             Relief 1% → Employee Relief
 *                    =(B3*34/100)*25/65    Partners 34% → 25∶40 parts
 *   Joy Land 2026    =(AV3*0.8*0.35)+AV3*0.2   Capital gets a line in two tranches
 *   Jungle Joys 2026 =(AG3*10%)/3          Partners 10% → 1∶1∶1 parts
 *
 * Percentages and parts carry up to 4 decimal places and are held as
 * scaled BigInts; money is BigInt paisa. Nothing here touches a float.
 */

/** Percentages and parts are stored with 4 decimal places. */
export const SCALE = 10_000n;
const HUNDRED = 100n * SCALE;

const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;
const PARTS_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;

/** "65" → 650000n, "33.3333" → 333333n. Throws on anything else. */
export function toScaled(value: string, pattern = PARTS_PATTERN): bigint {
  const text = String(value).trim();
  if (!pattern.test(text)) throw new Error(`Invalid number: "${value}" (at most 4 decimal places)`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

/** 655000n → "65.5" — the canonical wire format, trailing zeros trimmed. */
export function fromScaled(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export interface RuleLineInput {
  /** Identifies the target (e.g. `RESERVE:<accountId>`); lines with the same key are summed. */
  key: string;
  label: string;
  weight: string;
}

export interface RuleTrancheInput {
  name: string;
  /** % of the day's gross income. */
  share: string;
  method: AllocationMethod;
  lines: RuleLineInput[];
}

export interface RuleInput {
  tranches: RuleTrancheInput[];
}

/**
 * Everything wrong with a rule, in plain language — empty when it can be
 * applied. The editor shows these live; the API refuses to save a rule
 * that has any.
 */
export function ruleViolations(rule: RuleInput): string[] {
  const problems: string[] = [];
  if (!rule.tranches.length) return ['Add at least one tranche.'];

  let shareTotal = 0n;
  rule.tranches.forEach((t, ti) => {
    const name = t.name.trim() || `Tranche ${ti + 1}`;
    if (!t.name.trim()) problems.push(`Tranche ${ti + 1} needs a name.`);

    let share = 0n;
    try {
      share = toScaled(t.share, PERCENT_PATTERN);
    } catch {
      problems.push(`${name}: the share must be a percentage with at most 4 decimal places.`);
    }
    if (share <= 0n) problems.push(`${name}: the share must be more than 0%.`);
    shareTotal += share;

    if (!t.lines.length) {
      problems.push(`${name}: add at least one line.`);
      return;
    }

    let weightTotal = 0n;
    const seen = new Set<string>();
    t.lines.forEach((l, li) => {
      const label = l.label || `line ${li + 1}`;
      if (!l.key) problems.push(`${name}, ${label}: choose where the money goes.`);
      else if (seen.has(l.key)) problems.push(`${name}: ${label} appears twice — combine the two lines.`);
      seen.add(l.key);

      let weight = 0n;
      try {
        weight = toScaled(l.weight, t.method === AllocationMethod.PERCENT ? PERCENT_PATTERN : PARTS_PATTERN);
      } catch {
        problems.push(`${name}, ${label}: enter a number with at most 4 decimal places.`);
      }
      if (weight <= 0n) problems.push(`${name}, ${label}: must be more than 0.`);
      weightTotal += weight;
    });

    if (t.method === AllocationMethod.PERCENT && weightTotal !== HUNDRED) {
      problems.push(`${name}: the lines add up to ${fromScaled(weightTotal)}% — they must total exactly 100% of the tranche.`);
    }
  });

  if (shareTotal !== HUNDRED) {
    problems.push(
      `The tranches take ${fromScaled(shareTotal)}% of income — together they must take exactly 100%, so every rupee is earmarked.`,
    );
  }
  return problems;
}

export class InvalidRuleError extends Error {}

export interface AllocatedLine {
  tranche: number;
  line: number;
  key: string;
  label: string;
  /** This line's effective % of gross income, 4 decimal places (display only). */
  percentOfIncome: string;
  /** Paisa. Negative when the day's net income was negative (a correction day). */
  amount: bigint;
}

export interface Allocation {
  gross: bigint;
  lines: AllocatedLine[];
  /** Summed per target key, in first-appearance order. */
  byKey: { key: string; label: string; amount: bigint }[];
}

/** a/b vs c/d for non-negative BigInt fractions. */
function compareFractions(a: bigint, b: bigint, c: bigint, d: bigint): number {
  const left = a * d;
  const right = c * b;
  return left === right ? 0 : left > right ? 1 : -1;
}

/**
 * Splits a day's gross income (paisa) by a rule.
 *
 * Each line's exact share is gross × tranche% × line-fraction — a rational
 * number the workbook keeps to 9 decimals (8821.692308). Money can't, so
 * every line is floored to the paisa and the leftover paisa (fewer than
 * the number of lines) go one each to the lines with the largest remainder,
 * earliest line first on a tie. The lines therefore always total the gross
 * exactly — "no rounding leakage", which is the whole point of the parts
 * ratio — and no line is ever more than one paisa from the exact value.
 */
export function allocate(gross: bigint, rule: RuleInput): Allocation {
  const problems = ruleViolations(rule);
  if (problems.length) throw new InvalidRuleError(problems.join(' '));

  const negative = gross < 0n;
  const abs = negative ? -gross : gross;

  type Work = AllocatedLine & { rem: bigint; den: bigint };
  const work: Work[] = [];

  rule.tranches.forEach((t, ti) => {
    const share = toScaled(t.share);
    const weights = t.lines.map((l) => toScaled(l.weight));
    const divisor = t.method === AllocationMethod.PERCENT ? HUNDRED : weights.reduce((s, w) => s + w, 0n);

    t.lines.forEach((l, li) => {
      // amount = gross × (share / 100) × (weight / divisor), all scaled.
      const num = abs * share * weights[li];
      const den = HUNDRED * divisor;
      // % of income ×10^4, rounded half-up for display.
      const pctNum = share * weights[li];
      const pct = (pctNum * 2n + divisor) / (2n * divisor);
      work.push({
        tranche: ti,
        line: li,
        key: l.key,
        label: l.label,
        percentOfIncome: fromScaled(pct),
        amount: num / den,
        rem: num % den,
        den,
      });
    });
  });

  let leftover = abs - work.reduce((s, w) => s + w.amount, 0n);
  const order = work
    .map((w, i) => ({ w, i }))
    .sort((a, b) => compareFractions(b.w.rem, b.w.den, a.w.rem, a.w.den) || a.i - b.i);
  for (const { w } of order) {
    if (leftover <= 0n) break;
    if (w.rem === 0n) break;
    w.amount += 1n;
    leftover -= 1n;
  }

  const lines: AllocatedLine[] = work.map((w) => ({
    tranche: w.tranche,
    line: w.line,
    key: w.key,
    label: w.label,
    percentOfIncome: w.percentOfIncome,
    amount: negative ? -w.amount : w.amount,
  }));

  const byKey: Allocation['byKey'] = [];
  for (const line of lines) {
    const existing = byKey.find((b) => b.key === line.key);
    if (existing) existing.amount += line.amount;
    else byKey.push({ key: line.key, label: line.label, amount: line.amount });
  }

  return { gross, lines, byKey };
}
