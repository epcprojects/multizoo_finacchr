import { LoanMovementEffect } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';

/**
 * The loan & counterparty ledger (architecture plan Part 03 §4, Fig. 5),
 * with no framework or database attached — the parity suite drives it with
 * the `Loan Dir to Mik` and `Qasim Khan Loan Account` sheets.
 *
 *   Loan Dir to Mik        H2 = A$2 − SUM(E$2:E2)    principal − Σ repayments
 *   Qasim Khan Loan Acct   E4 = E3 + C4 − D4         running balance
 *
 * Every movement either adds to what's owed (money lent or borrowed, a
 * bill paid on the other's behalf, a charge) or pays some of it back. The
 * balance is always the principal so far minus what's been repaid — each
 * repayment its own row, so the history is reconstructable, unlike the
 * sheet's single "remaining" cell.
 */

export interface LoanMovementRow {
  effect: LoanMovementEffect;
  amount: string;
}

/** Signed paisa: increases add, decreases subtract. */
export function movementDelta(row: LoanMovementRow): bigint {
  const amount = toPaisa(row.amount);
  if (amount <= 0n) throw new Error('A loan movement must be a positive amount.');
  return row.effect === LoanMovementEffect.INCREASE ? amount : -amount;
}

/** The balance after each row, in the order given, from an opening balance. */
export function loanRunningBalances(rows: LoanMovementRow[], opening = '0'): string[] {
  let balance = toPaisa(opening);
  return rows.map((row) => {
    balance += movementDelta(row);
    return fromPaisa(balance);
  });
}

export interface LoanSummary {
  /** Σ increases — "Total amount taken". */
  principal: string;
  /** Σ decreases. */
  repaid: string;
  /** principal − repaid. Negative when more has come back than went out. */
  outstanding: string;
}

export function summarizeLoan(rows: LoanMovementRow[]): LoanSummary {
  let principal = 0n;
  let repaid = 0n;
  for (const row of rows) {
    const delta = movementDelta(row);
    if (delta > 0n) principal += delta;
    else repaid -= delta;
  }
  return { principal: fromPaisa(principal), repaid: fromPaisa(repaid), outstanding: fromPaisa(principal - repaid) };
}

/**
 * Whether adding `amount` needs a Partner's approval: always without an
 * approved ceiling, otherwise when it would take the balance past it.
 * Paying back never does.
 */
export function increaseNeedsApproval(outstanding: string, amount: string, limit: string | null): boolean {
  if (limit == null) return true;
  return toPaisa(outstanding) + toPaisa(amount) > toPaisa(limit);
}

/** Room left under the ceiling (never negative); null when there's no ceiling. */
export function headroom(outstanding: string, limit: string | null): string | null {
  if (limit == null) return null;
  const left = toPaisa(limit) - toPaisa(outstanding);
  return fromPaisa(left > 0n ? left : 0n);
}
