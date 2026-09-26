'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon } from '../../../components/ui/icons';
import EntryDetailModal from '../../../components/ledger/EntryDetailModal';
import ReviewNoteModal, { type ReviewAction } from '../../../components/hr/ReviewNoteModal';
import { NoticeLine, Pill, Section, UnitPicker, type Notice, type PillTone } from '../../../components/hr/ui';
import CapexModal from '../../../components/capex/CapexModal';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import {
  listCapex,
  PAYBACK_LABEL,
  reinstateCapex,
  removeCapex,
  retireCapex,
  type CapexRecord,
  type CapexRegister,
  type CapexStatus,
  type PaybackState,
} from '../../../lib/api/capex';
import { errorMessage, formatDate, formatMoney, todayIso } from '../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2';
const TONE: Record<PaybackState, PillTone> = {
  PAID_BACK: 'green',
  ON_TRACK: 'blue',
  BEHIND: 'amber',
  OVERDUE: 'red',
  NO_TARGET: 'gray',
  NOT_TRACKED: 'gray',
};

/**
 * The capex register (architecture plan Part 03 §11) — the `Dir Invst Zoo`
 * log as data: every capital purchase, investment to date, and how far each
 * is to paying for itself against its expected ROI window.
 */
export default function CapexPage() {
  const { hasPermission } = useUser();
  const canManage = hasPermission('capex.manage');

  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<CapexStatus | ''>('ACTIVE');
  const [reg, setReg] = useState<CapexRegister | null>(null);
  const [editing, setEditing] = useState<CapexRecord | 'new' | null>(null);
  const [retiring, setRetiring] = useState<CapexRecord | null>(null);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setReg(await listCapex({ businessUnitId: unitId || undefined, status: status || undefined }));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the register.') });
    }
  }, [unitId, status]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive && !x.isHolding)));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = reg?.items ?? [];
  const paidBack = items.filter((i) => i.payback.state === 'PAID_BACK').length;
  const lagging = items.filter((i) => i.payback.state === 'BEHIND' || i.payback.state === 'OVERDUE').length;
  const thisYear = reg?.summary.byYear.find((y) => y.year === todayIso().slice(0, 4));

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/capex-icon.svg"
            imageAlt="Capex"
            title="Capex"
            stats={[
              { title: 'Total investment', count: reg ? formatMoney(reg.summary.total, { decimals: false }) : '…', color: '#A78BFA' },
              { title: 'This year', count: reg ? formatMoney(thisYear?.amount ?? '0', { decimals: false }) : '…', color: '#60A5FA' },
              { title: 'Paid back', count: reg ? paidBack : '…', color: '#34D399' },
              { title: 'Behind or overdue', count: reg ? lagging : '…', color: '#F87171' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title="Capital purchases"
          subtitle="Rides, machines, fit-outs — each with the months it’s expected to take to pay for itself. Link its takings on the price list to see how far it has got."
          actions={
            canManage && (
              <Button icon={<PlusIcon />} onClick={() => setEditing('new')}>
                Record a purchase
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-72">
              <UnitPicker units={units} value={unitId} onChange={setUnitId} allowAll label="Unit" />
            </div>
            <div className="sm:w-44">
              <Select
                label="Showing"
                value={status}
                onChange={(v) => setStatus(v as CapexStatus | '')}
                options={[
                  { label: 'In use', value: 'ACTIVE' },
                  { label: 'Retired', value: 'RETIRED' },
                  { label: 'Everything', value: '' },
                ]}
              />
            </div>
          </div>

          {!reg ? (
            <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
          ) : !items.length ? (
            <p className="py-6 text-center text-sm text-gray-500">Nothing on the register here.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Bought</th>
                    <th className={th}>Item</th>
                    <th className={th}>Unit</th>
                    <th className={`${th} text-right`}>Cost</th>
                    <th className={th}>Pays back by</th>
                    <th className={`${th} w-56`}>Earned back</th>
                    <th className={th}>Ledger</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={clsx('border-t border-gray-200 align-top', i.status === 'RETIRED' && 'text-gray-400')}>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(i.purchaseDate)}</td>
                      <td className={td}>
                        <span className="font-medium text-gray-900">{i.name}</span>
                        <span className="block text-xs text-gray-500">{i.nature}</span>
                        {i.status === 'RETIRED' && <Pill>Retired {i.retiredOn ? formatDate(i.retiredOn) : ''}</Pill>}
                        {i.note && <span className="block max-w-xs whitespace-pre-line text-xs text-gray-500">{i.note}</span>}
                      </td>
                      <td className={td}>{i.businessUnit.code}</td>
                      <td className={`${td} text-right tabular-nums font-medium`}>{formatMoney(i.amount, { decimals: false })}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {i.payback.expectedBy ? formatDate(i.payback.expectedBy) : '—'}
                        {i.paybackMonths && <span className="block text-xs text-gray-500">{i.paybackMonths} months</span>}
                      </td>
                      <td className={td}>
                        <Payback item={i} />
                      </td>
                      <td className={td}>
                        {i.entry ? (
                          <button type="button" className="font-mono text-xs text-accent hover:underline" onClick={() => setEntryId(i.entry?.id ?? null)}>
                            {i.entry.displayNo}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">Register only</span>
                        )}
                        <span className="block text-[11px] text-gray-500">{i.funding === 'PAID_HERE' ? 'Paid here' : i.funding === 'LINKED_ENTRY' ? 'Linked' : ''}</span>
                      </td>
                      <td className={`${td} text-right`}>
                        {canManage && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>
                              Edit
                            </Button>
                            {i.status === 'ACTIVE' ? (
                              <Button size="sm" variant="secondary" onClick={() => setRetiring(i)}>
                                Retire
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={async () => {
                                  try {
                                    await reinstateCapex(i.id);
                                    void refresh();
                                  } catch (err) {
                                    setNotice({ tone: 'error', text: errorMessage(err, 'Could not reinstate.') });
                                  }
                                }}
                              >
                                Reinstate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setReview({
                                  title: `Remove ${i.name}?`,
                                  body: (
                                    <p className="text-sm text-gray-700">
                                      {i.funding === 'PAID_HERE'
                                        ? 'It was paid from here — its payment is reversed (dated today).'
                                        : i.funding === 'LINKED_ENTRY'
                                          ? 'Its linked entry stays on the ledger; only the register line goes.'
                                          : 'Nothing was posted for it; only the register line goes.'}
                                    </p>
                                  ),
                                  confirmLabel: 'Remove',
                                  noteLabel: 'Why',
                                  run: async (note) => {
                                    await removeCapex(i.id, note || undefined);
                                    setNotice({ tone: 'ok', text: `${i.name} removed from the register.` });
                                    void refresh();
                                  },
                                })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {reg && items.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="By nature">
              <Breakdown rows={reg.summary.byNature.map((n) => ({ label: n.nature, amount: n.amount, count: n.count }))} total={reg.summary.total} />
            </Section>
            <Section title="By year">
              <Breakdown rows={reg.summary.byYear.map((y) => ({ label: y.year, amount: y.amount, count: y.count }))} total={reg.summary.total} />
            </Section>
          </div>
        )}
      </div>

      <CapexModal
        isOpen={editing !== null}
        item={editing === 'new' ? null : editing}
        units={units}
        natures={reg?.natures ?? []}
        defaultAccountId={reg?.defaultAccountId ?? null}
        onClose={() => setEditing(null)}
        onSaved={(i) => {
          setEditing(null);
          setNotice({ tone: 'ok', text: `${i.name} saved.` });
          void refresh();
        }}
      />
      <RetireModal
        item={retiring}
        onClose={() => setRetiring(null)}
        onDone={() => {
          setRetiring(null);
          void refresh();
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => undefined} onOpenEntry={setEntryId} />
    </div>
  );
}

function Payback({ item }: { item: CapexRecord }) {
  const p = item.payback;
  const pct = p.recoveredPct ? Math.min(100, Math.max(0, Number(p.recoveredPct))) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Pill tone={TONE[p.state]}>{PAYBACK_LABEL[p.state]}</Pill>
        {p.recoveredPct && <span className="text-xs tabular-nums text-gray-700">{p.recoveredPct}%</span>}
      </div>
      {p.recovered !== null && (
        <>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className={clsx('h-full rounded-full', p.state === 'PAID_BACK' ? 'bg-green-500' : p.state === 'OVERDUE' ? 'bg-red-400' : 'bg-accent')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-gray-500">
            {formatMoney(p.recovered, { decimals: false })} earned
            {p.paidBackOn ? ` · paid back ${formatDate(p.paidBackOn)}` : p.expectedSoFar ? ` · ${formatMoney(p.expectedSoFar, { decimals: false })} due by now` : ''}
          </span>
        </>
      )}
      {p.state === 'NOT_TRACKED' && <span className="text-[11px] text-gray-500">Link its takings to track this.</span>}
    </div>
  );
}

function Breakdown({ rows, total }: { rows: { label: string; amount: string; count: number }[]; total: string }) {
  const max = Math.max(...rows.map((r) => Number(r.amount)), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          <span className="truncate">
            {r.label} <span className="text-xs text-gray-500">· {r.count}</span>
          </span>
          <span className="tabular-nums">{formatMoney(r.amount, { decimals: false })}</span>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(Number(r.amount) / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(total, { decimals: false })}</span>
      </div>
    </div>
  );
}

function RetireModal({ item, onClose, onDone }: { item: CapexRecord | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDate(todayIso());
    setNote('');
    setError(null);
  }, [item]);

  async function submit() {
    if (!item) return;
    setBusy(true);
    try {
      await retireCapex(item.id, date, note.trim() || undefined);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not retire it.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={item !== null}
      onClose={onClose}
      title={`Retire ${item?.name ?? ''}`}
      subtitle="Sold, scrapped or out of use — it stays in the register’s history"
      size="small"
      showFooter
      onConfirm={submit}
      confirmLabel={busy ? 'Saving…' : 'Retire'}
      confirmDisabled={busy}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Input label="Retired on" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        <Input label="Why" value={note} placeholder="e.g. Sold to …" onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
