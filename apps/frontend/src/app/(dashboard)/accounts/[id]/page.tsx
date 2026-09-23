'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Modal from '../../../../components/ui/Modal';
import PageBanner from '../../../../components/ui/PageBanner';
import EntryDetailModal from '../../../../components/ledger/EntryDetailModal';
import {
  ACCOUNT_TYPE_LABELS,
  createReconciliation,
  getAccountLedger,
  LIQUID,
  listReconciliations,
  SUBTYPE_LABELS,
  type AccountLedger,
  type Reconciliation,
} from '../../../../lib/api/ledger';
import {
  errorMessage,
  firstOfMonthIso,
  formatDate,
  formatMoney,
  isAmount,
  todayIso,
  toPaisa,
} from '../../../../lib/money';

export default function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useUser();
  const canReconcile = hasPermission('ledger.reconcile');
  const canReverse = hasPermission('transactions.reverse');

  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [recons, setRecons] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const [countOpen, setCountOpen] = useState(false);
  const [countDate, setCountDate] = useState(todayIso());
  const [counted, setCounted] = useState('');
  const [countNote, setCountNote] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [countSubmitting, setCountSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getAccountLedger(id, { from: from || undefined, to: to || undefined });
      setLedger(data);
      if (LIQUID.includes(data.account.subtype)) setRecons(await listReconciliations(id));
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load this ledger.'));
    } finally {
      setLoading(false);
    }
  }, [id, from, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitCount() {
    setCountError(null);
    if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(counted.trim())) {
      return setCountError('Enter the counted amount (up to 2 decimals).');
    }
    setCountSubmitting(true);
    try {
      await createReconciliation(id, { asOfDate: countDate, countedBalance: counted.trim(), note: countNote.trim() || undefined });
      setCountOpen(false);
      setCounted('');
      setCountNote('');
      await refresh();
    } catch (err) {
      setCountError(errorMessage(err, 'Could not record the count.'));
    } finally {
      setCountSubmitting(false);
    }
  }

  const account = ledger?.account;
  const isLiquid = account ? LIQUID.includes(account.subtype) : false;
  const inLabel = isLiquid ? 'Deposit' : 'Debit';
  const outLabel = isLiquid ? 'Withdraw' : 'Credit';

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/accounts-icon.svg"
            imageAlt="Ledger"
            title={account ? account.name : 'Ledger'}
            stats={
              ledger
                ? [
                    { title: 'Opening', count: formatMoney(ledger.openingBalance, { decimals: false }), color: '#A78BFA' },
                    { title: `${inLabel}s`, count: formatMoney(ledger.totalDebit, { decimals: false }), color: '#34D399' },
                    { title: `${outLabel}s`, count: formatMoney(ledger.totalCredit, { decimals: false }), color: '#F87171' },
                    { title: 'Closing', count: formatMoney(ledger.closingBalance, { decimals: false }), color: '#F5A623' },
                  ]
                : []
            }
          />
        </div>

        <div className="flex h-auto min-h-0 flex-none flex-col gap-4 overflow-visible rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5 xl:h-full xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-gray-500">
                <Link href="/accounts" className="hover:text-accent">
                  Chart of accounts
                </Link>{' '}
                / {account ? `${ACCOUNT_TYPE_LABELS[account.type]} · ${SUBTYPE_LABELS[account.subtype]}` : '…'}
              </p>
              <p className="text-lg font-semibold text-gray-900">
                {account?.code} · {account?.name}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {account?.businessUnit ? account.businessUnit.name : 'Group-wide'}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                From
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-10 rounded-lg border border-gray-200 px-2 text-sm text-gray-800"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-10 rounded-lg border border-gray-200 px-2 text-sm text-gray-800"
                />
              </label>
              <Button
                variant="secondary"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                All time
              </Button>
              {isLiquid && canReconcile && (
                <Button onClick={() => setCountOpen(true)}>Record count</Button>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr>
                    {['Date', 'Entry', 'Description', inLabel, outLabel, 'Balance'].map((h, i) => (
                      <th
                        key={h}
                        className={clsx(
                          'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-900',
                          i >= 3 && 'text-right',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                        Loading…
                      </td>
                    </tr>
                  ) : loadError ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-red-600">
                        {loadError}
                      </td>
                    </tr>
                  ) : ledger ? (
                    <>
                      {ledger.from && (
                        <tr className="border-b border-gray-200 bg-gray-50/60">
                          <td className="px-4 py-2.5 text-sm text-gray-600">{formatDate(ledger.from)}</td>
                          <td />
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-700">Opening balance</td>
                          <td />
                          <td />
                          <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums text-gray-900">
                            {formatMoney(ledger.openingBalance, { prefix: false })}
                          </td>
                        </tr>
                      )}
                      {ledger.rows.length ? (
                        ledger.rows.map((r, i) => (
                          <tr
                            key={`${r.entryId}-${i}`}
                            onClick={() => setOpenEntryId(r.entryId)}
                            className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-800">{formatDate(r.entryDate)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">{r.displayNo}</td>
                            <td className="px-4 py-2.5 text-sm">
                              <span className={clsx('text-gray-900', r.isReversed && 'text-gray-400 line-through')}>
                                {r.description}
                              </span>
                              {r.against.length > 0 && (
                                <span className="block text-xs text-gray-500">↔ {r.against.join(', ')}</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-green-700">
                              {toPaisa(r.debit) > 0n ? formatMoney(r.debit, { prefix: false }) : ''}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-red-600">
                              {toPaisa(r.credit) > 0n ? formatMoney(r.credit, { prefix: false }) : ''}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium tabular-nums text-gray-900">
                              {formatMoney(r.balance, { prefix: false })}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                            No movements in this period.
                          </td>
                        </tr>
                      )}
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {isLiquid && recons.length > 0 && (
            <div className="shrink-0 rounded-xl border border-gray-200">
              <p className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-900">
                Counts &amp; reconciliations
              </p>
              <ul className="max-h-48 overflow-auto">
                {recons.map((rc) => {
                  const variance = toPaisa(rc.variance);
                  return (
                    <li key={rc.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 text-sm last:border-0">
                      <span className="text-gray-800">
                        {formatDate(rc.asOfDate)} · counted {formatMoney(rc.countedBalance)} vs books{' '}
                        {formatMoney(rc.systemBalance)}
                        {rc.note && <span className="text-gray-500"> — {rc.note}</span>}
                      </span>
                      <span
                        className={clsx(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium',
                          variance === 0n ? 'bg-green-100 text-green-700' : 'bg-error-100 text-danger',
                        )}
                      >
                        {variance === 0n ? 'Matches' : `Variance ${formatMoney(rc.variance)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      <EntryDetailModal
        entryId={openEntryId}
        onClose={() => setOpenEntryId(null)}
        canReverse={canReverse}
        onChanged={() => void refresh()}
        onOpenEntry={setOpenEntryId}
      />

      <Modal
        isOpen={countOpen}
        onClose={() => setCountOpen(false)}
        title="Record a count"
        subtitle="Compare cash actually counted (or a bank statement balance) with the books. Nothing is posted."
        showFooter
        onConfirm={submitCount}
        confirmLabel={countSubmitting ? 'Saving…' : 'Record count'}
        confirmDisabled={countSubmitting}
      >
        <div className="flex flex-col gap-4">
          {countError && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{countError}</p>
          )}
          <Input label="Counted on" type="date" required value={countDate} max={todayIso()} onChange={(e) => setCountDate(e.target.value)} />
          <Input
            label="Amount counted (Rs)"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={counted}
            onChange={(e) => setCounted(e.target.value.replace(/[^\d.-]/g, ''))}
            errorText={counted && !isAmount(counted) ? 'Up to 2 decimal places' : undefined}
          />
          <Input label="Note" placeholder="e.g. End-of-day drawer count" value={countNote} onChange={(e) => setCountNote(e.target.value)} />
          <p className="text-xs text-gray-600">
            If there&apos;s a difference, correct it with a separate entry (e.g. to Cash Over / Short) once you know why.
          </p>
        </div>
      </Modal>
    </div>
  );
}
