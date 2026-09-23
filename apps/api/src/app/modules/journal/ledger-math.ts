import { AccountType, DEBIT_NORMAL_TYPES } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';

/**
 * The double-entry rules, with no framework or database attached — so the
 * formula-parity tests can drive them directly with rows from the
 * workbooks (Sprint Zero to Cutover, Part 05).
 */

export interface LineAmounts {
  debit?: string | null;
  credit?: string | null;
}

export class UnbalancedEntryError extends Error {}

/**
 * Validates the shape of an entry's lines and returns the entry total (the
 * sum of one side) in paisa. Rules:
 *  - at least two lines
 *  - every line is a debit OR a credit, strictly positive, never both
 *  - Σ debits = Σ credits, exactly, in paisa
 */
export function assertBalanced(lines: LineAmounts[]): bigint {
  if (lines.length < 2) {
    throw new UnbalancedEntryError('An entry needs at least two lines.');
  }

  let debits = 0n;
  let credits = 0n;

  lines.forEach((line, i) => {
    const debit = line.debit ? toPaisa(line.debit) : 0n;
    const credit = line.credit ? toPaisa(line.credit) : 0n;
    if (debit < 0n || credit < 0n) {
      throw new UnbalancedEntryError(`Line ${i + 1}: amounts cannot be negative.`);
    }
    if ((debit === 0n) === (credit === 0n)) {
      throw new UnbalancedEntryError(
        `Line ${i + 1}: enter either a debit or a credit — not both, not neither.`,
      );
    }
    debits += debit;
    credits += credit;
  });

  if (debits !== credits) {
    throw new UnbalancedEntryError(
      `Entry does not balance: debits ${fromPaisa(debits)} ≠ credits ${fromPaisa(credits)}.`,
    );
  }
  return debits;
}

/** +1 for accounts that grow with debits (asset, expense), −1 otherwise. */
export function normalSign(type: AccountType): 1n | -1n {
  return DEBIT_NORMAL_TYPES.includes(type) ? 1n : -1n;
}

/** A raw (debit − credit) paisa total, flipped so a healthy balance is positive. */
export function toNormalBalance(rawDebitMinusCredit: bigint, type: AccountType): bigint {
  return rawDebitMinusCredit * normalSign(type);
}

/**
 * The workbook's `=I5+G6-H6`, generalised: each row's balance is the
 * previous balance plus this row's movement, signed by the account's normal
 * side. `opening` is already a normal-signed balance.
 */
export function runningBalances(
  opening: bigint,
  rows: LineAmounts[],
  type: AccountType,
): string[] {
  const sign = normalSign(type);
  let balance = opening;
  return rows.map((row) => {
    const debit = row.debit ? toPaisa(row.debit) : 0n;
    const credit = row.credit ? toPaisa(row.credit) : 0n;
    balance += (debit - credit) * sign;
    return fromPaisa(balance);
  });
}

/** The mirror image of a set of lines — how a reversal is built. */
export function swapSides<T extends LineAmounts>(lines: T[]): T[] {
  return lines.map((line) => ({
    ...line,
    debit: line.credit ?? '0.00',
    credit: line.debit ?? '0.00',
  }));
}
