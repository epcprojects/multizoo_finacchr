'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../../components/layout/UserProvider';
import Button from '../../../../../components/ui/Button';
import Input from '../../../../../components/ui/Input';
import Select from '../../../../../components/ui/Select';
import ConfirmModal from '../../../../../components/ui/ConfirmModal';
import { NoticeLine, Pill, Section, type Notice } from '../../../../../components/hr/ui';
import ReviewNoteModal, { type ReviewAction } from '../../../../../components/hr/ReviewNoteModal';
import EntryDetailModal from '../../../../../components/ledger/EntryDetailModal';
import PayModal from '../../../../../components/payroll/PayModal';
import { EMPLOYMENT_TYPE_LABELS, formatDays, formatMonth } from '../../../../../lib/api/hr';
import {
  RUN_STATUS,
  deleteSettlement,
  getSettlement,
  paySettlement,
  settlementAction,
  updateSettlement,
  type SettlementAdjustment,
  type SettlementDetail,
} from '../../../../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney, isAmount, todayIso, toPaisa } from '../../../../../lib/money';

function Row({ label, sub, amount, minus, strong }: { label: ReactNode; sub?: ReactNode; amount: string; minus?: boolean; strong?: boolean }) {
  if (!strong && toPaisa(amount) === 0n) return null;
  return (
    <div className={clsx('flex justify-between gap-4 py-1', strong && 'mt-1 border-t border-gray-300 pt-2 text-base font-semibold')}>
      <span>
        {label}
        {sub && <span className="text-xs text-gray-500"> · {sub}</span>}
      </span>
      <span className="tabular-nums">
        {minus ? '− ' : ''}
        {formatMoney(amount)}
      </span>
    </div>
  );
}

/**
 * Full & final settlement (architecture plan Part 07 §06, Fig. 15): what is
 * owed to someone on their last day, as one statement.
 */
export default function SettlementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useUser();
  const canRun = hasPermission('payroll.run');

  const [s, setS] = useState<SettlementDetail | null>(null);
  const [adj, setAdj] = useState<SettlementAdjustment>({ kind: 'DEDUCTION', amount: '', description: '' });
  const [modal, setModal] = useState<'finalize' | 'pay' | 'delete' | null>(null);
  const [reopen, setReopen] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setS(await getSettlement(id));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the settlement.') });
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!s) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const snap = s.snapshot;
  const e = s.employee;
  const draft = s.status === 'DRAFT';

  async function act(fn: () => Promise<SettlementDetail>, ok: string) {
    setBusy(true);
    try {
      setS(await fn());
      setNotice({ tone: 'ok', text: ok });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'That didn’t work.') });
    } finally {
      setBusy(false);
      setModal(null);
    }
  }

  const settlementId = s.id;
  function saveAdjustments(list: SettlementAdjustment[]) {
    void act(() => updateSettlement(settlementId, { adjustments: list }), 'Saved.');
  }

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5 print:h-auto print:overflow-visible">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3 print:overflow-visible">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/payroll" className="text-gray-400 hover:text-accent print:hidden">
                Payroll
              </Link>
              <span className="text-gray-300 print:hidden">/</span>
              Full &amp; final settlement — {e.fullName}
              <Pill tone={RUN_STATUS[s.status].tone}>{s.status === 'PAID' && s.paidOn ? `Paid ${formatDate(s.paidOn)}` : RUN_STATUS[s.status].label}</Pill>
            </span>
          }
          subtitle={
            draft
              ? 'A draft: recalculated from attendance, leave, fines and advances each time it opens.'
              : `Finalised ${s.finalizedAt ? formatDate(s.finalizedAt.slice(0, 10)) : ''}${s.finalizedByName ? ` by ${s.finalizedByName}` : ''}.`
          }
          actions={
            <span className="flex flex-wrap gap-2 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              {canRun && draft && (
                <>
                  <Button variant="secondary" onClick={() => setModal('delete')}>
                    Delete draft
                  </Button>
                  <Button disabled={!s.canFinalize || busy} title={e.exitDate > todayIso() ? `Can be finalised from ${formatDate(e.exitDate)}` : undefined} onClick={() => setModal('finalize')}>
                    Finalise
                  </Button>
                </>
              )}
              {canRun && s.status === 'FINALIZED' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setReopen({
                        title: 'Reopen this settlement?',
                        body: 'The ledger posting is reversed and the fines and advance recoveries are handed back.',
                        confirmLabel: 'Reopen',
                        noteLabel: 'Why',
                        noteRequired: true,
                        run: async (note) => {
                          setS(await settlementAction(s.id, 'reopen', note));
                        },
                      })
                    }
                  >
                    Reopen
                  </Button>
                  <Button onClick={() => setModal('pay')}>Pay {formatMoney(snap.net)}</Button>
                </>
              )}
            </span>
          }
        >
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <p><span className="text-gray-500">Employee</span> {e.fullName} ({e.employeeCode}){e.fatherName ? `, s/o ${e.fatherName}` : ''}</p>
            <p><span className="text-gray-500">Unit</span> {e.businessUnit?.name} · {e.designation}{e.department ? ` · ${e.department}` : ''}</p>
            <p><span className="text-gray-500">Service</span> {formatDate(e.joinDate)} – {formatDate(e.exitDate)} ({EMPLOYMENT_TYPE_LABELS[e.employmentType].toLowerCase()})</p>
            <p><span className="text-gray-500">Reason</span> {e.exitReason ?? '—'}</p>
            {e.cnic && <p><span className="text-gray-500">CNIC</span> {e.cnic}</p>}
            <p>
              <span className="text-gray-500">Posted</span>{' '}
              {s.accrualEntry ? (
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => setEntryId(s.accrualEntry?.id ?? null)}>
                  {s.accrualEntry.displayNo}
                </button>
              ) : '—'}
              {s.paymentEntry && (
                <>
                  {' · paid '}
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => setEntryId(s.paymentEntry?.id ?? null)}>
                    {s.paymentEntry.displayNo}
                  </button>
                </>
              )}
            </p>
          </div>
        </Section>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />
        {s.errors.length > 0 && <NoticeLine notice={{ tone: 'error', text: <ul className="list-disc pl-4">{s.errors.map((x) => <li key={x}>{x}</li>)}</ul> }} />}
        {s.warnings.length > 0 && <NoticeLine notice={{ tone: 'warn', text: <ul className="list-disc pl-4">{s.warnings.map((x) => <li key={x}>{x}</li>)}</ul> }} />}

        <Section title="Statement">
          <div className="max-w-2xl text-sm text-gray-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Owed to them</p>
            {snap.months.map((mo) => (
              <Row
                key={mo.month}
                label={`Salary for ${formatMonth(mo.month)}`}
                sub={`${formatMoney(mo.salary)} a month${mo.absentDays !== '0' ? `, absent ${formatDays(mo.absentDays)}` : ''}`}
                amount={mo.salaryForDays}
              />
            ))}
            {!snap.months.length && <p className="py-1 text-gray-500">Every month to the exit date was paid through payroll.</p>}
            {snap.encashment.map((x) => (
              <Row key={x.leaveTypeId} label={`${x.name} encashed`} sub={`${formatDays(x.days)} days`} amount={x.amount} />
            ))}
            <Row label="Commission pool shares" amount={snap.poolBonus} />
            {s.adjustments.filter((a) => a.kind === 'ALLOWANCE').map((a, i) => (
              <Row key={`a${i}`} label={a.description} amount={a.amount} />
            ))}

            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Set against it</p>
            {snap.fines.map((f) => (
              <Row key={f.id} label={f.reason} sub={`fine ${formatDate(f.date)}`} amount={f.amount} minus />
            ))}
            {s.adjustments.filter((a) => a.kind === 'DEDUCTION').map((a, i) => (
              <Row key={`d${i}`} label={a.description} amount={a.amount} minus />
            ))}
            <Row label="EOBI" amount={snap.eobiEmployee} minus />
            <Row label="Income tax" amount={snap.tax} minus />
            <Row label="Provident fund" amount={snap.pfEmployee} minus />
            {snap.advances.map((a) => (
              <Row key={a.advanceId} label={`Advance of ${formatDate(a.issueDate)}`} sub={`${formatMoney(a.outstanding)} outstanding`} amount={a.recovered} minus />
            ))}
            <Row strong label="Net settlement" amount={snap.net} />
            {toPaisa(snap.stillOwed) > 0n && (
              <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {formatMoney(snap.stillOwed)} of advances is more than what’s owed and stays outstanding against {e.fullName}.
              </p>
            )}
          </div>
        </Section>

        {draft && canRun && (
          <Section title="Anything else owed" subtitle="Notice pay, a damaged uniform… — each with its reason, printed on the statement." className="print:hidden">
            {s.adjustments.length > 0 && (
              <div className="flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-200">
                {s.adjustments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      {a.description} <span className="text-xs text-gray-500">· {a.kind === 'ALLOWANCE' ? 'owed to them' : 'deducted'}</span>
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      {formatMoney(a.amount)}
                      <button type="button" className="text-gray-400 hover:text-danger" aria-label="Remove" onClick={() => saveAdjustments(s.adjustments.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid items-end gap-3 md:grid-cols-[12rem_10rem_1fr_auto]">
              <Select
                label="Kind"
                value={adj.kind}
                onChange={(v) => setAdj({ ...adj, kind: v as SettlementAdjustment['kind'] })}
                options={[
                  { label: 'Deduct', value: 'DEDUCTION' },
                  { label: 'Owed to them', value: 'ALLOWANCE' },
                ]}
              />
              <Input label="Amount (Rs)" inputMode="decimal" value={adj.amount} onChange={(ev) => setAdj({ ...adj, amount: ev.target.value.replace(/[^\d.]/g, '') })} />
              <Input label="Reason" value={adj.description} maxLength={200} onChange={(ev) => setAdj({ ...adj, description: ev.target.value })} />
              <Button
                disabled={busy || !isAmount(adj.amount) || adj.description.trim().length < 2}
                onClick={() => {
                  saveAdjustments([...s.adjustments, { ...adj, description: adj.description.trim() }]);
                  setAdj({ kind: 'DEDUCTION', amount: '', description: '' });
                }}
              >
                Add
              </Button>
            </div>
          </Section>
        )}
      </div>

      <ConfirmModal
        isOpen={modal === 'finalize'}
        title="Finalise the settlement?"
        message={`${formatMoney(snap.net)} becomes owed to ${e.fullName}. The fines and advance recoveries are recorded against it, their last month's attendance locks, and it's posted to the ledger.`}
        confirmLabel="Finalise"
        isSubmitting={busy}
        onClose={() => setModal(null)}
        onConfirm={() => act(() => settlementAction(s.id, 'finalize'), 'Finalised — ready to pay.')}
      />
      <ConfirmModal
        isOpen={modal === 'delete'}
        title="Delete this draft?"
        message="Nothing has been posted from a draft settlement; it’s simply removed."
        confirmLabel="Delete draft"
        variant="danger"
        isSubmitting={busy}
        onClose={() => setModal(null)}
        onConfirm={async () => {
          try {
            await deleteSettlement(s.id);
            router.push('/payroll');
          } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err, 'Could not delete it.') });
            setModal(null);
          }
        }}
      />
      {e.businessUnit && (
        <PayModal
          isOpen={modal === 'pay'}
          title="Pay the settlement"
          subtitle={e.fullName}
          unitId={e.businessUnit.id}
          amount={snap.net}
          notBefore={e.exitDate}
          onClose={() => setModal(null)}
          onPay={async (payload) => {
            setS(await paySettlement(s.id, payload));
            setModal(null);
            setNotice({ tone: 'ok', text: 'Settlement paid.' });
          }}
        />
      )}
      <ReviewNoteModal
        action={reopen}
        onClose={() => setReopen(null)}
        onDone={() => {
          setReopen(null);
          setNotice({ tone: 'ok', text: 'Reopened — it’s a draft again.' });
        }}
      />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => void refresh()} onOpenEntry={setEntryId} />
    </div>
  );
}
