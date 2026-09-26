import { AccountType } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { toScaled } from '../allocation/allocation-math';
import { divRound } from '../payroll/payroll-math';

/**
 * The profit & loss arithmetic behind the reporting suite (architecture plan
 * Part 03 §3 and §5, Part 08), with no database attached so the parity
 * tests can drive it with the workbook's own figures:
 *
 *  - the unit P&L block of each daily-expense tab (`MULTIZOO!AS8:BF28`):
 *    TOTAL SALES − each expense heading = NET EFFECT, then the partners'
 *    shares of the net (`AT27 = AT26*70/100`);
 *  - the partner statement (`Profit & Loss Statement`): each month's share
 *    per unit, less what the partner drew in that unit (`B17 = B16 − C16`).
 *
 * Money is BigInt paisa; shares are the allocation rule's partner weights,
 * held as 4-decimal scaled BigInts. Nothing here touches a float.
 */

export interface PnlAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
}

/** One account's movement into one column (a unit, or a month). */
export interface PnlMovement {
  accountId: string;
  column: string;
  debit: string;
  credit: string;
}

export interface PnlLine {
  code: string;
  name: string;
  amounts: Record<string, string>;
  total: string;
}

/** A heading (5100 Animal Feed & Medicine) and, when it has any, the sub-accounts posted to under it. */
export interface PnlCategory extends PnlLine {
  accounts: PnlLine[];
}

export interface PnlStatement {
  columns: string[];
  income: PnlCategory[];
  expenses: PnlCategory[];
  totalIncome: PnlLine;
  totalExpenses: PnlLine;
  /** Income − expenses: the sheet's NET EFFECT. */
  net: PnlLine;
}

/** The top-level heading an account rolls up to — the workbook's "Account Title". */
export function rootOf(accountId: string, byId: Map<string, PnlAccount>): PnlAccount {
  let account = byId.get(accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const seen = new Set<string>();
  while (account.parentId && byId.has(account.parentId) && !seen.has(account.id)) {
    seen.add(account.id);
    account = byId.get(account.parentId) as PnlAccount;
  }
  return account;
}

const sum = (values: Iterable<bigint>) => [...values].reduce((s, v) => s + v, 0n);

function line(code: string, name: string, columns: string[], amounts: Map<string, bigint>): PnlLine {
  return {
    code,
    name,
    amounts: Object.fromEntries(columns.map((c) => [c, fromPaisa(amounts.get(c) ?? 0n)])),
    total: fromPaisa(sum(columns.map((c) => amounts.get(c) ?? 0n))),
  };
}

/**
 * Income and expense movements → headings × columns. Income is credit −
 * debit and expenses debit − credit, so a refund or a reversal simply nets
 * off. Headings with nothing in any column are left out; headings and their
 * sub-accounts are in code order.
 */
export function buildPnl(accounts: PnlAccount[], movements: PnlMovement[], columns: string[]): PnlStatement {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // heading id → account id → column → paisa
  const tree = new Map<string, Map<string, Map<string, bigint>>>();
  for (const mv of movements) {
    const account = byId.get(mv.accountId);
    if (!account || (account.type !== AccountType.INCOME && account.type !== AccountType.EXPENSE)) continue;
    if (!columns.includes(mv.column)) continue;
    const signed =
      account.type === AccountType.INCOME ? toPaisa(mv.credit) - toPaisa(mv.debit) : toPaisa(mv.debit) - toPaisa(mv.credit);
    const root = rootOf(account.id, byId);
    const heading = tree.get(root.id) ?? new Map<string, Map<string, bigint>>();
    const cells = heading.get(account.id) ?? new Map<string, bigint>();
    cells.set(mv.column, (cells.get(mv.column) ?? 0n) + signed);
    heading.set(account.id, cells);
    tree.set(root.id, heading);
  }

  const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });
  const blocks = (type: AccountType): { categories: PnlCategory[]; totals: Map<string, bigint> } => {
    const totals = new Map<string, bigint>();
    const categories = [...tree.entries()]
      .map(([rootId, heading]) => ({ root: byId.get(rootId) as PnlAccount, heading }))
      .filter(({ root }) => root.type === type)
      .sort((a, b) => byCode(a.root, b.root))
      .map(({ root, heading }) => {
        const headingTotals = new Map<string, bigint>();
        for (const cells of heading.values()) {
          cells.forEach((v, c) => headingTotals.set(c, (headingTotals.get(c) ?? 0n) + v));
        }
        headingTotals.forEach((v, c) => totals.set(c, (totals.get(c) ?? 0n) + v));
        const children = [...heading.entries()]
          .filter(([id]) => id !== root.id || heading.size > 1)
          .map(([id, cells]) => ({ account: byId.get(id) as PnlAccount, cells }))
          .sort((a, b) => byCode(a.account, b.account))
          .map(({ account, cells }) => line(account.code, account.name, columns, cells));
        return {
          ...line(root.code, root.name, columns, headingTotals),
          // A heading posted to directly, with no sub-accounts, is just its own line.
          accounts: heading.size === 1 && heading.has(root.id) ? [] : children,
        };
      })
      .filter((c) => c.total !== '0.00' || Object.values(c.amounts).some((v) => v !== '0.00'));
    return { categories, totals };
  };

  const income = blocks(AccountType.INCOME);
  const expenses = blocks(AccountType.EXPENSE);
  const net = new Map(columns.map((c) => [c, (income.totals.get(c) ?? 0n) - (expenses.totals.get(c) ?? 0n)]));
  return {
    columns,
    income: income.categories,
    expenses: expenses.categories,
    totalIncome: line('', 'Total income', columns, income.totals),
    totalExpenses: line('', 'Total expenses', columns, expenses.totals),
    net: line('', 'Net profit / (loss)', columns, net),
  };
}

// ---------------------------------------------------------------------------
// Partner shares
// ---------------------------------------------------------------------------

export interface PartnerWeight {
  partnerId: string;
  /** The rule line's weight — a % of the partner tranche, or a number of parts. */
  weight: string;
}

export interface PartnerShare {
  partnerId: string;
  /** Their share of the unit's net, as a percentage to 2 decimals ("70.00", "33.33"). */
  pct: string;
  /** Weight and the sum of every partner's weight in the unit, 4-decimal scaled. */
  weight: bigint;
  of: bigint;
}

/**
 * Each partner's share of a unit's net, from the partner lines of the
 * unit's allocation rule: their weight over the sum of all partners'
 * weights, so the shares always total 100% of the net — MIK 70 / MQK 30 on
 * the Zoo, 1∶1∶1 on Jungle Joys. A partner in two tranches is counted once.
 */
export function partnerShares(weights: PartnerWeight[]): PartnerShare[] {
  const byPartner = new Map<string, bigint>();
  for (const w of weights) byPartner.set(w.partnerId, (byPartner.get(w.partnerId) ?? 0n) + toScaled(w.weight));
  const of = sum(byPartner.values());
  if (of <= 0n) return [];
  return [...byPartner.entries()].map(([partnerId, weight]) => ({
    partnerId,
    weight,
    of,
    pct: fromPaisa(divRound(weight * 10_000n, of)),
  }));
}

/** A partner's share of a net figure, rounded half away from zero to the paisa (the sheet's `=AT26*70/100`). */
export function shareOf(net: string, share: Pick<PartnerShare, 'weight' | 'of'>): string {
  return fromPaisa(divRound(toPaisa(net) * share.weight, share.of));
}

export interface StatementMonthInput {
  /** YYYY-MM. */
  month: string;
  /** unit id → that unit's net for the month. */
  net: Record<string, string>;
  /** The shares in force that month, when they differ from the year's (a rule changed mid-year). */
  shares?: Record<string, Pick<PartnerShare, 'weight' | 'of'>>;
}

export interface StatementCell {
  profit: string;
  drawn: string;
}

export interface PartnerStatement {
  units: string[];
  months: { month: string; byUnit: Record<string, StatementCell>; profit: string; drawn: string }[];
  byUnit: Record<string, StatementCell & { balance: string }>;
  profit: string;
  drawn: string;
  /** Profit − drawn: the sheet's "Balance" row (`B17 = B16 − C16`). */
  balance: string;
}

/**
 * One partner's year: for every unit they share in, each month's share of
 * the unit's net, and what they drew against that unit. `drawings` holds
 * the net debits to their capital & current account, keyed `month|unit`.
 */
export function partnerStatement(
  months: StatementMonthInput[],
  shares: Record<string, Pick<PartnerShare, 'weight' | 'of'>>,
  drawings: Map<string, bigint>,
): PartnerStatement {
  const units = [
    ...new Set([
      ...Object.keys(shares),
      ...months.flatMap((m) => Object.keys(m.shares ?? {})),
      ...[...drawings.keys()].map((k) => k.split('|')[1]),
    ]),
  ].sort();
  const unitProfit = new Map<string, bigint>();
  const unitDrawn = new Map<string, bigint>();

  const rows = months.map(({ month, net, shares: monthShares }) => {
    let profit = 0n;
    let drawn = 0n;
    const byUnit: Record<string, StatementCell> = {};
    for (const unit of units) {
      const share = (monthShares ?? shares)[unit];
      const p = share ? toPaisa(shareOf(net[unit] ?? '0', share)) : 0n;
      const d = drawings.get(`${month}|${unit}`) ?? 0n;
      profit += p;
      drawn += d;
      unitProfit.set(unit, (unitProfit.get(unit) ?? 0n) + p);
      unitDrawn.set(unit, (unitDrawn.get(unit) ?? 0n) + d);
      byUnit[unit] = { profit: fromPaisa(p), drawn: fromPaisa(d) };
    }
    return { month, byUnit, profit: fromPaisa(profit), drawn: fromPaisa(drawn) };
  });

  const profit = sum(unitProfit.values());
  const drawn = sum(unitDrawn.values());
  return {
    units,
    months: rows,
    byUnit: Object.fromEntries(
      units.map((u) => {
        const p = unitProfit.get(u) ?? 0n;
        const d = unitDrawn.get(u) ?? 0n;
        return [u, { profit: fromPaisa(p), drawn: fromPaisa(d), balance: fromPaisa(p - d) }];
      }),
    ),
    profit: fromPaisa(profit),
    drawn: fromPaisa(drawn),
    balance: fromPaisa(profit - drawn),
  };
}
