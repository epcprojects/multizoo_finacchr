'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { setOpeningReserves, type UnitReserves } from '../../lib/api/allocation';
import { errorMessage, formatDate, formatMoney, fromPaisa, todayIso, toPaisa } from '../../lib/money';

const SIGNED = /^-?\d{1,16}(\.\d{1,2})?$/;

/**
 * Brings the workbook's reserve balances in at cutover — the "From New
 * Formulation" opening rows of each reserve block. Posted as one entry
 * (reserves up, the Earmarked Funds offset down); correcting it reverses
 * that entry and posts the new one, so the change stays visible.
 */
export default function OpeningReservesModal({
  reserves,
  isOpen,
  onClose,
  onSaved,
}: {
  reserves: UnitReserves;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (r: UnitReserves) => void;
}) {
  const existing = reserves.openingReserves;
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAsOfDate(existing?.entryDate ?? todayIso());
    setAmounts({});
    setReason('');
    setError(null);
  }, [isOpen, existing]);

  const invalid = Object.values(amounts).some((v) => v.trim() && !SIGNED.test(v.trim()));
  const total = Object.values(amounts).reduce((s, v) => s + (SIGNED.test(v.trim()) ? toPaisa(v) : 0n), 0n);

  async function submit() {
    setError(null);
    if (invalid) return setError('Amounts may have at most 2 decimals (a minus sign for an overspent reserve).');
    setSaving(true);
    try {
      onSaved(
        await setOpeningReserves(reserves.unit.id, {
          asOfDate,
          amounts: Object.entries(amounts)
            .filter(([, v]) => v.trim())
            .map(([accountId, v]) => ({ accountId, amount: fromPaisa(toPaisa(v)) })),
          replaceExisting: Boolean(existing),
          reason: reason.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not save the opening reserves.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existing ? 'Correct opening reserves' : 'Set opening reserves'}
      subtitle={`${reserves.unit.name} — the reserve balances carried over from the workbook`}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Posting…' : existing ? 'Reverse & repost' : 'Post opening reserves'}
      confirmDisabled={saving}
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-4">
        {existing && (
          <p className="rounded-md border border-warning-200 bg-warning-25 px-3 py-2 text-sm text-warning-800">
            {existing.displayNo} (dated {formatDate(existing.entryDate)}) will be reversed and replaced by what you enter here.
            Leave a reserve blank to open it at zero.
          </p>
        )}
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Input label="As of" type="date" value={asOfDate} max={todayIso()} onChange={(e) => setAsOfDate(e.target.value)} />
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {reserves.accounts
            .filter((a) => a.isActive)
            .map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 first:border-t-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900">{a.name}</p>
                  <p className="text-xs text-gray-500">
                    {a.code} · now {formatMoney(a.balance)}
                  </p>
                </div>
                <input
                  aria-label={`${a.name} opening balance`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amounts[a.id] ?? ''}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [a.id]: e.target.value.replace(/[^\d.-]/g, '') }))}
                  className="h-10 w-36 rounded-lg border border-gray-200 px-3 text-right text-sm tabular-nums outline-none focus:border-gray-400"
                />
              </div>
            ))}
        </div>
        <p className="text-right text-sm text-gray-700">
          Total earmarked: <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
        </p>
        {existing && (
          <Input label="Reason for the correction" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        )}
      </div>
    </Modal>
  );
}
