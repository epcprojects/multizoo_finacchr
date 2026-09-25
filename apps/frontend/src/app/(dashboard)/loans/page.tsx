'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import Select from '../../../components/ui/Select';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, Tabs, type Notice } from '../../../components/hr/ui';
import ReviewNoteModal, { type ReviewAction } from '../../../components/hr/ReviewNoteModal';
import LoanModal from '../../../components/loans/LoanModal';
import CounterpartyModal from '../../../components/loans/CounterpartyModal';
import TransferModal from '../../../components/loans/TransferModal';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import {
  KIND_LABELS,
  LOAN_STATUS,
  actOnMovement,
  getApprovals,
  getLoanStats,
  listCounterparties,
  listInterUnit,
  listLoans,
  listStaffAdvances,
  owedLabel,
  reviewLoan,
  undoWriteOff,
  writeOffAdvance,
  type Approvals,
  type CounterpartyRecord,
  type InterUnitPair,
  type LoanRecord,
  type LoanStats,
  type LoanStatus,
  type StaffAdvanceRow,
} from '../../../lib/api/loans';
import { errorMessage, formatDate, formatMoney } from '../../../lib/money';

const TABS = ['Loans', 'Inter-unit', 'Staff advances', 'Awaiting approval', 'Counterparties'] as const;
type Tab = (typeof TABS)[number];

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

const METHOD_WORDS: Record<string, string> = {
  CASH: 'cash',
  ON_ACCOUNT: 'no cash',
  PROFIT_SETOFF: 'against profit',
  OPENING: 'opening balance',
};

/**
 * Loans & counterparties (architecture plan Part 03 §4, M4): director and
 * partner loans, officer floats, outside parties, the inter-unit accounts,
 * and staff advances — each a running balance with its full history,
 * replacing the `Qasim Khan Loan Account`, `Loan Dir to Mik`, `Officers
 * Expenses` and `Payable & Receiveable` sheets.
 */
export default function LoansPage() {
  const router = useRouter();
  const { hasPermission } = useUser();
  const isApprover = hasPermission('loans.approve');
  const canInitiate = hasPermission('loans.initiate') || isApprover;

  const [tab, setTab] = useState<Tab>('Loans');
  const [stats, setStats] = useState<LoanStats | null>(null);
  const [loans, setLoans] = useState<LoanRecord[] | null>(null);
  const [status, setStatus] = useState<LoanStatus | ''>('ACTIVE');
  const [unitFilter, setUnitFilter] = useState('');
  const [pairs, setPairs] = useState<InterUnitPair[] | null>(null);
  const [advances, setAdvances] = useState<StaffAdvanceRow[] | null>(null);
  const [approvals, setApprovals] = useState<Approvals | null>(null);
  const [counterparties, setCounterparties] = useState<CounterpartyRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [modal, setModal] = useState<'loan' | 'transfer' | 'counterparty' | null>(null);
  const [editingCp, setEditingCp] = useState<CounterpartyRecord | null>(null);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      void getLoanStats().then(setStats);
      void getApprovals().then(setApprovals);
      if (tab === 'Loans') setLoans(await listLoans({ interUnit: 'false', status: status || undefined, businessUnitId: unitFilter || undefined }));
      if (tab === 'Inter-unit') setPairs(await listInterUnit());
      if (tab === 'Staff advances') setAdvances(await listStaffAdvances());
      if (tab === 'Counterparties' || !counterparties.length) setCounterparties(await listCounterparties());
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load loans.') });
    }
  }, [tab, status, unitFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, []);

  const pendingCount = (approvals?.loans.length ?? 0) + (approvals?.movements.length ?? 0);

  function done(text: string) {
    setNotice({ tone: 'ok', text });
    void refresh();
  }

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/loans-icon.svg"
            imageAlt="Loans"
            title="Loans"
            stats={[
              { title: 'Owed to the group', count: stats ? formatMoney(stats.owedToUs, { decimals: false }) : '…', color: '#34D399' },
              { title: 'The group owes', count: stats ? formatMoney(stats.weOwe, { decimals: false }) : '…', color: '#F87171' },
              { title: 'Between units', count: stats ? formatMoney(stats.interUnitOpen, { decimals: false }) : '…', color: '#60A5FA' },
              { title: 'Awaiting approval', count: stats ? stats.pendingApprovals : '…', color: stats?.pendingApprovals ? '#F5A623' : '#34D399' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title={<Tabs tabs={TABS} value={tab} onChange={setTab} counts={{ 'Awaiting approval': pendingCount }} />}
          actions={
            canInitiate && (
              <>
                {tab === 'Inter-unit' ? (
                  <Button icon={<PlusIcon />} onClick={() => setModal('transfer')}>
                    Transfer between units
                  </Button>
                ) : tab === 'Counterparties' ? (
                  <Button icon={<PlusIcon />} onClick={() => setModal('counterparty')}>
                    New counterparty
                  </Button>
                ) : (
                  tab !== 'Staff advances' && (
                    <Button icon={<PlusIcon />} onClick={() => setModal('loan')}>
                      New loan
                    </Button>
                  )
                )}
              </>
            )
          }
        >
          {tab === 'Loans' && (
            <>
              <div className="flex flex-wrap gap-3">
                <div className="w-52">
                  <Select
                    value={status}
                    onChange={(v) => setStatus(v as LoanStatus | '')}
                    options={[
                      { label: 'Active', value: 'ACTIVE' },
                      { label: 'Awaiting approval', value: 'PENDING_APPROVAL' },
                      { label: 'Closed', value: 'CLOSED' },
                      { label: 'Rejected', value: 'REJECTED' },
                      { label: 'All', value: '' },
                    ]}
                  />
                </div>
                <div className="w-60">
                  <Select
                    value={unitFilter}
                    onChange={setUnitFilter}
                    options={[{ label: 'All units', value: '' }, ...units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }))]}
                  />
                </div>
              </div>
              <LoansTable loans={loans} onOpen={(id) => router.push(`/loans/${id}`)} />
            </>
          )}

          {tab === 'Inter-unit' &&
            (!pairs ? (
              <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
            ) : !pairs.length ? (
              <p className="py-6 text-center text-sm text-gray-500">
                No money has moved between units yet. A transfer, or a utility bill shared between units, opens the account between them.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-150 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className={th}>Between</th>
                      <th className={th}>Who owes whom</th>
                      <th className={`${th} text-right`}>Balance</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((p) => (
                      <tr key={p.id} onClick={() => router.push(`/loans/${p.id}`)} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50">
                        <td className={td}>
                          {p.units[0].name} ↔ {p.units[1].name}
                        </td>
                        <td className={td}>{p.debtor ? `${p.debtor.name} owes ${p.creditor?.name}` : <span className="text-gray-500">Square</span>}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{formatMoney(p.balance)}</td>
                        <td className={`${td} text-right`}>{p.pending > 0 && <Pill tone="amber">{p.pending} waiting</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'Staff advances' && (
            <StaffAdvancesTable
              rows={advances}
              isApprover={isApprover}
              onWriteOff={(a) =>
                setReview({
                  title: `Write off ${a.employee.fullName}'s advance`,
                  subtitle: `${formatMoney(a.outstanding)} their settlement couldn’t recover`,
                  body: (
                    <p className="text-sm text-gray-600">
                      Posts Dr Loans &amp; Advances Written Off / Cr Staff Salary Advances in {a.businessUnit?.name}. It can be undone.
                    </p>
                  ),
                  confirmLabel: 'Write off',
                  noteLabel: 'Reason',
                  noteRequired: true,
                  run: async (note) => {
                    await writeOffAdvance(a.id, note);
                    done('Written off.');
                  },
                })
              }
              onUndo={async (a) => {
                try {
                  await undoWriteOff(a.id);
                  done('Write-off undone — the advance is outstanding again.');
                } catch (err) {
                  setNotice({ tone: 'error', text: errorMessage(err, 'Could not undo it.') });
                }
              }}
            />
          )}

          {tab === 'Awaiting approval' && (
            <ApprovalsView
              approvals={approvals}
              isApprover={isApprover}
              onOpen={(id) => router.push(`/loans/${id}`)}
              onReview={setReview}
              onDone={done}
              onError={(text) => setNotice({ tone: 'error', text })}
            />
          )}

          {tab === 'Counterparties' && (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Kind</th>
                    <th className={`${th} text-right`}>Loans</th>
                    <th className={`${th} text-right`}>Position</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {counterparties.map((c) => {
                    const net = c.net;
                    const zero = /^-?0\.00$/.test(net);
                    return (
                      <tr key={c.id} className={clsx('border-t border-gray-200', !c.isActive && 'text-gray-400')}>
                        <td className={td}>
                          <Link href={`/loans/counterparties/${c.id}`} className="font-medium text-gray-900 hover:text-accent">
                            {c.name}
                          </Link>
                          {c.employee && <p className="text-xs text-gray-500">{c.employee.employeeCode} · {c.employee.unit} · {c.employee.designation}</p>}
                          {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
                        </td>
                        <td className={td}>
                          <Pill tone={c.kind === 'PARTNER' ? 'violet' : 'gray'}>{c.partner ? `Partner · ${c.partner.shortName}` : KIND_LABELS[c.kind]}</Pill>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{c.loanCount}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {zero ? (
                            <span className="text-gray-500">—</span>
                          ) : net.startsWith('-') ? (
                            <span className="text-danger">We owe {formatMoney(net.slice(1))}</span>
                          ) : (
                            <span className="text-green-700">Owes {formatMoney(net)}</span>
                          )}
                          {c.staffAdvances !== '0.00' && <p className="text-xs text-gray-500">incl. {formatMoney(c.staffAdvances)} salary advances</p>}
                        </td>
                        <td className={`${td} text-right`}>
                          {canInitiate && c.kind !== 'BUSINESS_UNIT' && (
                            <Button size="sm" variant="secondary" onClick={() => setEditingCp(c)}>
                              Edit
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <LoanModal
        isOpen={modal === 'loan'}
        counterparties={counterparties}
        units={units}
        isApprover={isApprover}
        onClose={() => setModal(null)}
        onSaved={(loan) => {
          setModal(null);
          router.push(`/loans/${loan.id}`);
        }}
      />
      <TransferModal
        isOpen={modal === 'transfer'}
        units={units}
        isApprover={isApprover}
        onClose={() => setModal(null)}
        onSaved={(s) => {
          setModal(null);
          done(s === 'POSTED' ? 'Transferred — both units’ books are posted.' : 'Sent to a Partner for approval.');
        }}
      />
      <CounterpartyModal
        isOpen={modal === 'counterparty' || editingCp !== null}
        counterparty={editingCp}
        existing={counterparties}
        onClose={() => {
          setModal(null);
          setEditingCp(null);
        }}
        onSaved={(c) => {
          setModal(null);
          setEditingCp(null);
          done(`${c.name} saved.`);
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
    </div>
  );
}

function LoansTable({ loans, onOpen }: { loans: LoanRecord[] | null; onOpen: (id: string) => void }) {
  if (!loans) return <p className="py-6 text-center text-sm text-gray-500">Loading…</p>;
  if (!loans.length) return <p className="py-6 text-center text-sm text-gray-500">No loans here.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-190 text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-900">
          <tr>
            <th className={th}>Loan</th>
            <th className={th}>With</th>
            <th className={th}>Unit</th>
            <th className={`${th} text-right`}>Balance</th>
            <th className={`${th} text-right`}>Ceiling</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => {
            const owed = owedLabel(l.direction, l.outstanding);
            const s = LOAN_STATUS[l.status];
            return (
              <tr key={l.id} onClick={() => onOpen(l.id)} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50">
                <td className={`${td} whitespace-nowrap font-mono text-xs`}>{l.loanNo}</td>
                <td className={td}>
                  <span className="font-medium text-gray-900">{l.counterparty?.name}</span>
                  <p className="max-w-xs truncate text-xs text-gray-500">{l.purpose}</p>
                </td>
                <td className={td}>{l.businessUnit?.code}</td>
                <td className={`${td} text-right tabular-nums`}>
                  <span className={clsx('font-semibold', owed.tone === 'owed' ? 'text-green-700' : owed.tone === 'owe' ? 'text-danger' : 'text-gray-500')}>
                    {formatMoney(l.outstanding.replace('-', ''))}
                  </span>
                  <p className="text-xs text-gray-500">{owed.text}</p>
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {l.limit ? formatMoney(l.limit, { decimals: false }) : <span className="text-gray-400">None</span>}
                  {l.limit && <p className="text-xs text-gray-500">{formatMoney(l.headroom, { decimals: false })} left</p>}
                </td>
                <td className={td}>
                  <Pill tone={s.tone}>{s.label}</Pill>
                  {l.pending > 0 && l.status === 'ACTIVE' && (
                    <span className="ml-1.5">
                      <Pill tone="amber">{l.pending} waiting</Pill>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StaffAdvancesTable({
  rows,
  isApprover,
  onWriteOff,
  onUndo,
}: {
  rows: StaffAdvanceRow[] | null;
  isApprover: boolean;
  onWriteOff: (a: StaffAdvanceRow) => void;
  onUndo: (a: StaffAdvanceRow) => void;
}) {
  if (!rows) return <p className="py-6 text-center text-sm text-gray-500">Loading…</p>;
  if (!rows.length) return <p className="py-6 text-center text-sm text-gray-500">No salary advances outstanding.</p>;
  return (
    <>
      <p className="text-sm text-gray-600">
        Salary advances are paid and recovered on the{' '}
        <Link href="/payroll" className="text-accent underline">
          Payroll screen
        </Link>
        . What a leaver&apos;s paid settlement couldn&apos;t recover is written off here, by a Partner.
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-190 text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-900">
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Paid</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-right`}>Recovered</th>
              <th className={`${th} text-right`}>Outstanding</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-gray-200">
                <td className={td}>
                  <Link href={`/employees/${a.employee.id}`} className="font-medium text-gray-900 hover:text-accent">
                    {a.employee.fullName}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {a.employee.employeeCode} · {a.businessUnit?.code}
                    {a.employee.exitDate ? ` · left ${formatDate(a.employee.exitDate)}` : ''}
                  </p>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {formatDate(a.issueDate)}
                  <p className="max-w-48 truncate text-xs text-gray-500">{a.reason}</p>
                </td>
                <td className={`${td} text-right tabular-nums`}>{formatMoney(a.amount)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatMoney(a.recovered)}</td>
                <td className={`${td} text-right font-semibold tabular-nums`}>
                  {a.status === 'WRITTEN_OFF' ? <span className="text-gray-500">{formatMoney(a.writtenOff)} written off</span> : formatMoney(a.outstanding)}
                </td>
                <td className={td}>
                  {a.status === 'WRITTEN_OFF' ? (
                    <Pill tone="red" title={a.writeOffReason ?? undefined}>
                      Written off
                    </Pill>
                  ) : a.employee.status === 'EXITED' ? (
                    <Pill tone={a.settlement?.status === 'PAID' ? 'amber' : 'gray'}>
                      {a.settlement ? `Left · settlement ${a.settlement.status.toLowerCase()}` : 'Left · no settlement'}
                    </Pill>
                  ) : (
                    <Pill tone="blue">Recovered by payroll</Pill>
                  )}
                </td>
                <td className={`${td} text-right`}>
                  {isApprover && a.canWriteOff && (
                    <Button size="sm" variant="danger" onClick={() => onWriteOff(a)}>
                      Write off
                    </Button>
                  )}
                  {isApprover && a.status === 'WRITTEN_OFF' && (
                    <Button size="sm" variant="secondary" onClick={() => onUndo(a)}>
                      Undo
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ApprovalsView({
  approvals,
  isApprover,
  onOpen,
  onReview,
  onDone,
  onError,
}: {
  approvals: Approvals | null;
  isApprover: boolean;
  onOpen: (id: string) => void;
  onReview: (a: ReviewAction) => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  if (!approvals) return <p className="py-6 text-center text-sm text-gray-500">Loading…</p>;
  if (!approvals.loans.length && !approvals.movements.length) {
    return <p className="py-6 text-center text-sm text-gray-500">Nothing is waiting for a Partner.</p>;
  }
  const act = (title: string, confirmLabel: string, run: (note: string) => Promise<unknown>, okText: string, noteRequired = false) =>
    onReview({ title, confirmLabel, noteLabel: noteRequired ? 'Reason' : 'Note (optional)', noteRequired, run: async (note) => {
      await run(note);
      onDone(okText);
    } });

  return (
    <div className="flex flex-col gap-4">
      {!isApprover && <p className="text-sm text-gray-600">A Partner approves these. You can withdraw what you asked for.</p>}
      {approvals.loans.map((l) => (
        <div key={l.id} className="flex flex-col gap-2 rounded-xl border border-warning-200 bg-warning-25/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(l.id)} className="text-left font-medium text-gray-900 hover:text-accent">
              New loan {l.loanNo}: {l.direction === 'RECEIVABLE' ? 'lent to' : 'borrowed from'} {l.counterparty?.name} · {l.businessUnit?.code}
            </button>
            <p className="text-sm text-gray-600">
              {l.purpose}
              {l.limit ? ` · ceiling ${formatMoney(l.limit, { decimals: false })}` : ' · no ceiling'}
            </p>
            {l.opening.map((o, i) => (
              <p key={i} className="text-xs text-gray-500">
                First movement: {formatMoney(o.amount)} on {formatDate(o.movementDate)} ({METHOD_WORDS[o.method]}) — {o.description}
              </p>
            ))}
            <p className="text-xs text-gray-500">Asked by {l.createdByName ?? '—'}</p>
          </div>
          {isApprover && (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={() => act(`Reject loan ${l.loanNo}`, 'Reject', (n) => reviewLoan(l.id, 'reject', n), 'Loan rejected.', true)}>
                Reject
              </Button>
              <Button size="sm" onClick={() => act(`Approve loan ${l.loanNo}`, 'Approve', (n) => reviewLoan(l.id, 'approve', n), 'Approved — its first movement is posted.')}>
                Approve
              </Button>
            </div>
          )}
        </div>
      ))}
      {approvals.movements.map((mv) => (
        <div key={mv.id} className="flex flex-col gap-2 rounded-xl border border-warning-200 bg-warning-25/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(mv.loan.id)} className="text-left font-medium text-gray-900 hover:text-accent">
              {mv.interUnit
                ? `Transfer ${formatMoney(mv.amount)}: ${mv.interUnit.from} → ${mv.interUnit.to}`
                : `${formatMoney(mv.amount)} ${mv.effect === 'INCREASE' ? 'added to' : 'off'} ${mv.loan.loanNo} · ${mv.loan.counterparty?.name}`}
            </button>
            <p className="text-sm text-gray-600">
              {formatDate(mv.movementDate)} · {mv.description} ({METHOD_WORDS[mv.method]}
              {mv.method === 'ON_ACCOUNT' ? ` — ${mv.otherAccount.name}` : ''})
            </p>
            <p className="text-xs text-warning-800">{mv.reason}</p>
            <p className="text-xs text-gray-500">Asked by {mv.createdByName ?? '—'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {!isApprover && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await actOnMovement(mv.id, 'withdraw');
                    onDone('Withdrawn.');
                  } catch (err) {
                    onError(errorMessage(err, 'Could not withdraw it.'));
                  }
                }}
              >
                Withdraw
              </Button>
            )}
            {isApprover && (
              <>
                <Button size="sm" variant="secondary" onClick={() => act('Reject this movement', 'Reject', (n) => actOnMovement(mv.id, 'reject', n), 'Rejected.', true)}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => act('Approve this movement', 'Approve', (n) => actOnMovement(mv.id, 'approve', n), 'Approved and posted.')}>
                  Approve
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
