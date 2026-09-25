'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '../../../../../components/layout/UserProvider';
import Button from '../../../../../components/ui/Button';
import Input from '../../../../../components/ui/Input';
import ConfirmModal from '../../../../../components/ui/ConfirmModal';
import EntryDetailModal from '../../../../../components/ledger/EntryDetailModal';
import ReviewNoteModal, { type ReviewAction } from '../../../../../components/hr/ReviewNoteModal';
import { Figure, NoticeLine, Pill, Section, type Notice } from '../../../../../components/hr/ui';
import { PostBillModal } from '../../../../../components/utilities/BillModals';
import { deleteBill, getBill, unpostBill, updateBill, type BillDetail } from '../../../../../lib/api/utilities';
import { errorMessage, formatDate, formatMoney, isAmount } from '../../../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2';
const READING = /^\d{1,12}(\.\d{1,2})?$/;

type ReadingDraft = { subMeterId: string; start: string; end: string; days: string };

const toDrafts = (b: BillDetail): ReadingDraft[] =>
  b.readings.map((r) => ({ subMeterId: r.subMeterId, start: r.start, end: r.end ?? '', days: r.daysCovered ? String(r.daysCovered) : '' }));

/**
 * One billing cycle's Utility Cost Allocation Sheet: the readings, each
 * sub-meter's pro-rated units and charge at the bill's own rate, the
 * unmetered remainder split, and what each unit pays.
 */
export default function UtilityBillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useUser();
  const canManage = hasPermission('utilities.manage');

  const [bill, setBill] = useState<BillDetail | null>(null);
  const [readings, setReadings] = useState<ReadingDraft[]>([]);
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback((b: BillDetail) => {
    setBill(b);
    setReadings(toDrafts(b));
    setAmount(b.billAmount);
    setUnits(b.totalUnits ?? '');
  }, []);

  useEffect(() => {
    getBill(id).then(load, (err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the bill.') }));
  }, [id, load]);

  const dirty = useMemo(
    () => bill !== null && (JSON.stringify(readings) !== JSON.stringify(toDrafts(bill)) || amount !== bill.billAmount || units !== (bill.totalUnits ?? '')),
    [bill, readings, amount, units],
  );

  if (!bill) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const draft = bill.status === 'DRAFT';
  const editable = draft && canManage;
  const c = bill.connection;
  const a = bill.allocation;
  const metered = c.method === 'SUB_METERED';

  async function save() {
    if (!bill) return;
    if (!isAmount(amount)) return setNotice({ tone: 'error', text: 'Enter the bill amount.' });
    if (metered && !READING.test(units)) return setNotice({ tone: 'error', text: 'Enter the units on the bill.' });
    const bad = readings.find((r) => !READING.test(r.start) || (r.end && !READING.test(r.end)) || (r.days && !/^\d{1,2}$/.test(r.days)));
    if (bad) return setNotice({ tone: 'error', text: 'Readings are numbers with at most 2 decimals; days read a whole number.' });
    setBusy(true);
    try {
      load(
        await updateBill(bill.id, {
          billAmount: amount.trim(),
          ...(metered ? { totalUnits: units.trim() } : {}),
          readings: readings.map((r) => ({ subMeterId: r.subMeterId, start: r.start.trim(), end: r.end.trim() || null, daysCovered: r.days ? Number(r.days) : null })),
        }),
      );
      setNotice({ tone: 'ok', text: 'Saved — the allocation below is up to date.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not save.') });
    } finally {
      setBusy(false);
    }
  }

  const setReading = (sid: string, patch: Partial<ReadingDraft>) =>
    setReadings((rs) => rs.map((r) => (r.subMeterId === sid ? { ...r, ...patch } : r)));
  const rowFor = (sid: string) => a?.metered.find((m) => m.key === sid);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/utilities" className="text-gray-400 hover:text-accent">
                Utilities
              </Link>
              <span className="text-gray-300">/</span>
              {c.name}
              <Pill tone={draft ? 'amber' : 'green'}>{draft ? 'Draft' : 'Posted'}</Pill>
            </span>
          }
          subtitle={`Billing cycle ${formatDate(bill.periodFrom)} – ${formatDate(bill.periodTo)} (${bill.days} days) · paid by ${c.businessUnit.name}${bill.postedByName ? ` · posted by ${bill.postedByName}` : ''}`}
          actions={
            <>
              {bill.previous && (
                <Button variant="secondary" onClick={() => router.push(`/utilities/bills/${bill.previous?.id}`)}>
                  ‹ Previous
                </Button>
              )}
              {bill.next && (
                <Button variant="secondary" onClick={() => router.push(`/utilities/bills/${bill.next?.id}`)}>
                  Next ›
                </Button>
              )}
              {editable && (
                <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              {editable && dirty && (
                <Button disabled={busy} onClick={() => void save()}>
                  Save
                </Button>
              )}
              {editable && !dirty && (
                <Button disabled={busy || !a || bill.errors.length > 0} title={bill.errors.join(' ') || undefined} onClick={() => setPosting(true)}>
                  Post allocation
                </Button>
              )}
              {!draft && canManage && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setReview({
                      title: 'Unpost this bill',
                      subtitle: 'Its recharges (and the payment, if it was recorded here) are reversed; it goes back to draft.',
                      confirmLabel: 'Unpost',
                      noteLabel: 'Reason',
                      noteRequired: true,
                      run: async (note) => {
                        load(await unpostBill(bill.id, note));
                        setNotice({ tone: 'ok', text: 'Back to draft — the recharges are reversed.' });
                      },
                    })
                  }
                >
                  Unpost
                </Button>
              )}
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        >
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          {bill.errors.map((e) => (
            <NoticeLine key={e} notice={{ tone: 'warn', text: e }} />
          ))}
          {bill.warnings.map((w) => (
            <NoticeLine key={w} notice={{ tone: 'warn', text: w }} />
          ))}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {editable ? (
              <Input label="Bill amount (Rs)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            ) : (
              <Figure label="Bill amount" value={formatMoney(bill.billAmount)} tone="accent" />
            )}
            {metered &&
              (editable ? (
                <Input label="Units on the bill" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value.replace(/[^\d.]/g, ''))} />
              ) : (
                <Figure label="Units on the bill" value={bill.totalUnits ? formatMoney(bill.totalUnits, { prefix: false }) : '—'} />
              ))}
            {metered && <Figure label="Rate per unit (bill ÷ units)" value={a?.rate ? `Rs ${a.rate}` : '—'} />}
            {bill.paidOn && <Figure label="Payment recorded" value={formatDate(bill.paidOn)} />}
          </div>
        </Section>

        {metered && (
          <Section
            title="Sub-meter readings"
            subtitle={`Consumed = end − start. A meter read over part of the cycle is pro-rated: consumed ÷ days read × ${c.standardDays}.`}
          >
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-220 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Department</th>
                    <th className={th}>Charged to</th>
                    <th className={`${th} text-right`}>Start</th>
                    <th className={`${th} text-right`}>End</th>
                    <th className={`${th} text-right`}>Consumed</th>
                    <th className={`${th} text-right`} title="Only when the meter covered part of the cycle">
                      Days read
                    </th>
                    <th className={`${th} text-right`}>Units charged</th>
                    <th className={`${th} text-right`}>Bill amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.readings.map((r) => {
                    const d = readings.find((x) => x.subMeterId === r.subMeterId) as ReadingDraft;
                    const row = rowFor(r.subMeterId);
                    const cell = 'h-9 w-24 rounded-lg border border-gray-200 px-2 text-right text-sm tabular-nums outline-none focus:border-gray-400';
                    return (
                      <tr key={r.subMeterId} className="border-t border-gray-200">
                        <td className={td}>{r.name}</td>
                        <td className={td}>{r.businessUnit.code}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {editable ? <input aria-label={`${r.name} start`} className={cell} inputMode="decimal" value={d.start} onChange={(e) => setReading(r.subMeterId, { start: e.target.value.replace(/[^\d.]/g, '') })} /> : r.start}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {editable ? (
                            <input aria-label={`${r.name} end`} className={cell} inputMode="decimal" placeholder="Reading" value={d.end} onChange={(e) => setReading(r.subMeterId, { end: e.target.value.replace(/[^\d.]/g, '') })} />
                          ) : (
                            r.end
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{row?.consumed ?? '—'}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {editable ? (
                            <input aria-label={`${r.name} days read`} className={`${cell} w-16`} inputMode="numeric" placeholder="—" value={d.days} onChange={(e) => setReading(r.subMeterId, { days: e.target.value.replace(/\D/g, '') })} />
                          ) : (
                            r.daysCovered ?? '—'
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{row?.units ?? '—'}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{row ? formatMoney(row.charge, { prefix: false }) : '—'}</td>
                      </tr>
                    );
                  })}
                  {a && (
                    <>
                      <tr className="border-t border-gray-200 bg-gray-50 text-gray-700">
                        <td className={td} colSpan={6}>
                          Remaining units, not on a sub-meter ({a.remainderUnits})
                        </td>
                        <td />
                        <td />
                      </tr>
                      {a.remainder.map((r) => (
                        <tr key={r.key} className="border-t border-gray-200">
                          <td className={td} colSpan={2}>
                            {r.pct}% charged to {r.businessUnit.name}
                          </td>
                          <td colSpan={4} />
                          <td className={`${td} text-right tabular-nums`}>{r.units}</td>
                          <td className={`${td} text-right font-semibold tabular-nums`}>{formatMoney(r.charge, { prefix: false })}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                        <td className={td} colSpan={6}>
                          Total
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{bill.totalUnits}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(a.total, { prefix: false })}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {editable && dirty && <p className="text-xs text-warning-800">Save to see the allocation with your changes.</p>}
          </Section>
        )}

        {!metered && (
          <Section title="Shared by" subtitle="Copied from the connection when the bill was started.">
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-120 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Line</th>
                    {(a?.byUnit ?? []).map((u) => (
                      <th key={u.unitKey} className={`${th} text-right`}>
                        {u.businessUnit.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bill.shares.map((s) => (
                    <tr key={s.label} className="border-t border-gray-200">
                      <td className={td}>{s.label}</td>
                      {(a?.byUnit ?? []).map((u) => (
                        <td key={u.unitKey} className={`${td} text-right tabular-nums`}>
                          {s.weights[u.unitKey] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {a && (
                    <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                      <td className={td}>Share</td>
                      {a.remainder.map((r) => (
                        <td key={r.key} className={`${td} text-right tabular-nums`}>
                          {r.units} · {r.pct}%
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {a && (
          <Section title="What each unit pays" subtitle={`${c.businessUnit.name} pays the bill; every other unit is charged its share through the inter-unit account.`}>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-120 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Unit</th>
                    {metered && <th className={`${th} text-right`}>Units</th>}
                    <th className={`${th} text-right`}>Charge</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {a.byUnit.map((u) => (
                    <tr key={u.unitKey} className="border-t border-gray-200">
                      <td className={td}>{u.businessUnit.name}</td>
                      {metered && <td className={`${td} text-right tabular-nums`}>{u.units}</td>}
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatMoney(u.charge)}</td>
                      <td className={`${td} text-xs text-gray-500`}>{u.isPayer ? 'Pays the bill — keeps its own share' : `Owes ${c.businessUnit.code}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {bill.postings.length > 0 && (
          <Section title="Ledger postings">
            <ul className="flex flex-col gap-1.5 text-sm">
              {bill.postings.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-700">
                    {p.label} · {p.unit.code}
                  </span>
                  {p.entry && (
                    <button type="button" onClick={() => setEntryId(p.entry?.id ?? null)} className="font-mono text-xs text-accent hover:underline">
                      {p.entry.displayNo}
                    </button>
                  )}
                  {p.reversal && (
                    <button type="button" onClick={() => setEntryId(p.reversal?.id ?? null)} className="font-mono text-xs text-danger hover:underline">
                      reversed by {p.reversal.displayNo}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <PostBillModal
        bill={posting ? bill : null}
        onClose={() => setPosting(false)}
        onSaved={(b) => {
          setPosting(false);
          load(b);
          setNotice({ tone: 'ok', text: 'Posted — each unit is charged its share.' });
        }}
      />
      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this draft bill?"
        message="Nothing has been posted from it."
        variant="danger"
        confirmLabel="Delete"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await deleteBill(bill.id);
            router.push('/utilities');
          } catch (err) {
            setConfirmDelete(false);
            setNotice({ tone: 'error', text: errorMessage(err, 'Could not delete it.') });
          }
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => undefined} onOpenEntry={setEntryId} />
    </div>
  );
}
