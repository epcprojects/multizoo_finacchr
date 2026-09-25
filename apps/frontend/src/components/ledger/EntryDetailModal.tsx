'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import {
  getJournalEntry,
  KIND_LABELS,
  reverseJournalEntry,
  type JournalEntryRecord,
} from '../../lib/api/ledger';
import { errorMessage, formatDate, formatMoney, toPaisa } from '../../lib/money';

type EntryDetailModalProps = {
  entryId: string | null;
  onClose: () => void;
  canReverse: boolean;
  /** Called after a successful reversal so lists/balances can refresh. */
  onChanged: () => void;
  onOpenEntry: (id: string) => void;
};

export default function EntryDetailModal({
  entryId,
  onClose,
  canReverse,
  onChanged,
  onOpenEntry,
}: EntryDetailModalProps) {
  const [entry, setEntry] = useState<JournalEntryRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntry(null);
    setReversing(false);
    setReason('');
    setError(null);
    if (!entryId) return;
    setLoading(true);
    getJournalEntry(entryId)
      .then(setEntry)
      .catch((err) => setError(errorMessage(err, 'Could not load the entry.')))
      .finally(() => setLoading(false));
  }, [entryId]);

  async function reverse() {
    if (!entry) return;
    setSubmitting(true);
    setError(null);
    try {
      const reversal = await reverseJournalEntry(entry.id, { reason: reason.trim() || undefined });
      onChanged();
      onOpenEntry(reversal.id);
    } catch (err) {
      setError(errorMessage(err, 'Could not reverse the entry.'));
    } finally {
      setSubmitting(false);
    }
  }

  // A day's waterfall is undone from the Allocation screen, and payroll postings from the Payroll
  // screens — each keeps its own record in step.
  const fromEngine = entry?.source === 'ALLOCATION' || entry?.source === 'PAYROLL';
  const reversible = entry && !entry.reversedById && entry.kind !== 'REVERSAL' && !fromEngine;

  return (
    <Modal
      isOpen={Boolean(entryId)}
      onClose={onClose}
      title={entry ? `Entry ${entry.displayNo}` : 'Entry'}
      subtitle={entry ? `${formatDate(entry.entryDate)} · ${entry.businessUnit?.name ?? ''}` : undefined}
      size="large"
    >
      {loading || !entry ? (
        <p className="py-8 text-center text-sm text-gray-500">{error ?? 'Loading…'}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
              {KIND_LABELS[entry.kind]}
            </span>
            {entry.reversedById && (
              <button
                type="button"
                onClick={() => onOpenEntry(entry.reversedById as string)}
                className="rounded-full bg-error-100 px-2.5 py-0.5 text-xs font-medium text-danger hover:underline"
              >
                Reversed by {entry.reversedByNo}
              </button>
            )}
            {entry.reversalOfId && (
              <button
                type="button"
                onClick={() => onOpenEntry(entry.reversalOfId as string)}
                className="rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-800 hover:underline"
              >
                Reverses {entry.reversalOfNo}
              </button>
            )}
          </div>

          <div>
            <p className="text-base font-medium text-gray-900">{entry.description}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {entry.reference ? `Ref ${entry.reference} · ` : ''}Entered by {entry.createdByName ?? 'system'} on{' '}
              {new Date(entry.createdAt).toLocaleString('en-GB')}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-120 text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-900">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Account</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l) => (
                  <tr key={l.id} className="border-t border-gray-200">
                    <td className="px-4 py-2.5">
                      <Link href={`/accounts/${l.accountId}`} className="font-medium text-gray-900 hover:text-accent">
                        {l.accountName}
                      </Link>
                      <span className="ml-2 text-xs text-gray-500">{l.accountCode}</span>
                      {l.memo && <p className="text-xs text-gray-500">{l.memo}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {toPaisa(l.debit) > 0n ? formatMoney(l.debit, { prefix: false }) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {toPaisa(l.credit) > 0n ? formatMoney(l.credit, { prefix: false }) : ''}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5 text-gray-900">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(entry.amount, { prefix: false })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(entry.amount, { prefix: false })}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          {entry.source === 'PAYROLL' && !entry.reversedById && (
            <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
              This was posted by payroll. To undo it, reopen the run or settlement (or cancel the advance) on the{' '}
              <Link href="/payroll" className="font-medium underline">
                Payroll screen
              </Link>
              .
            </p>
          )}

          {entry.source === 'ALLOCATION' && !entry.reversedById && entry.businessUnit && (
            <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
              This is a day&apos;s income allocation. To change it, re-run or undo the day on the{' '}
              <Link href={`/allocation/${entry.businessUnit.id}`} className="font-medium underline">
                Allocation screen
              </Link>
              .
            </p>
          )}

          {canReverse && reversible && (
            <div className="rounded-xl border border-gray-200 p-3">
              {!reversing ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-600">
                    Posted entries are never edited or deleted. A mistake is undone with a reversing entry.
                  </p>
                  <Button variant="secondary" onClick={() => setReversing(true)}>
                    Reverse entry
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Input
                    label="Reason for reversal"
                    placeholder="e.g. Entered twice"
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setReversing(false)} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={reverse} disabled={submitting}>
                      {submitting ? 'Reversing…' : 'Post reversal'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
