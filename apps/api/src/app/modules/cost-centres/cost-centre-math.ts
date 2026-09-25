import { fromPaisa, toPaisa } from '@multizoo/utils';

/**
 * The cost-centre report (architecture plan Part 03 §10, Fig. 12): what a
 * cost centre spent, by category and month, and who bore it — the paying
 * unit's P&L, or a partner's profit. Replaces the hand-kept totals on the
 * `342 Expense` sheets (Transport & Food 26,750 · Development 496,000 ·
 * Assets 549,500).
 *
 * Pure, so the parity suite can drive it with the sheet's rows.
 */

export interface CostCentreLine {
  /** YYYY-MM. */
  month: string;
  category: string;
  /** Debit − credit on the expense line: a reversal comes through negative. */
  amount: string;
  /** The partner it was charged to, or null for the unit's own P&L. */
  chargedTo: string | null;
}

export interface CostCentreRollup {
  total: string;
  byCategory: { category: string; amount: string }[];
  byMonth: { month: string; amount: string; byCategory: Record<string, string> }[];
  byCharge: { chargedTo: string | null; amount: string }[];
}

function tally<K>(map: Map<K, bigint>, key: K, amount: bigint) {
  map.set(key, (map.get(key) ?? 0n) + amount);
}

export function rollupCostCentre(lines: CostCentreLine[]): CostCentreRollup {
  let total = 0n;
  const byCategory = new Map<string, bigint>();
  const byMonth = new Map<string, Map<string, bigint>>();
  const byCharge = new Map<string | null, bigint>();
  for (const line of lines) {
    const amount = toPaisa(line.amount);
    total += amount;
    tally(byCategory, line.category, amount);
    tally(byCharge, line.chargedTo, amount);
    const month = byMonth.get(line.month) ?? new Map<string, bigint>();
    tally(month, line.category, amount);
    byMonth.set(line.month, month);
  }
  const drop = <K>(m: Map<K, bigint>) => [...m.entries()].filter(([, v]) => v !== 0n);
  return {
    total: fromPaisa(total),
    byCategory: drop(byCategory)
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : String(a[0]).localeCompare(String(b[0]))))
      .map(([category, v]) => ({ category, amount: fromPaisa(v) })),
    byMonth: [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, cats]) => ({
        month,
        amount: fromPaisa([...cats.values()].reduce((a, b) => a + b, 0n)),
        byCategory: Object.fromEntries(drop(cats).map(([c, v]) => [c, fromPaisa(v)])),
      })),
    byCharge: drop(byCharge).map(([chargedTo, v]) => ({ chargedTo, amount: fromPaisa(v) })),
  };
}
