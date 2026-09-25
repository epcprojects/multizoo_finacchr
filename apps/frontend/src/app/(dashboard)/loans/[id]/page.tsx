'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Modal from '../../../../components/ui/Modal';
import EntryDetailModal from '../../../../components/ledger/EntryDetailModal';
import { Figure, NoticeLine, Pill, Section, TextArea, type Notice } from '../../../../components/hr/ui';
import ReviewNoteModal, { type ReviewAction } from '../../../../components/hr/ReviewNoteModal';
import MovementModal from '../../../../components/loans/MovementModal';
import TransferModal from '../../../../components/loans/TransferModal';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../../lib/api/ledger';
import {
  DIRECTION_LABELS,
  LOAN_STATUS,
  MOVEMENT_STATUS,
  actOnMovement,
  closeLoan,
  getLoan,
  owedLabel,
  reviewLoan,
  updateLoan,
  type LoanDetail,
  type LoanMovementRecord,
} from '../../../../lib/api/loans';
import { errorMessage, formatDate, formatMoney, isAmount, toPaisa } from '../../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2.5';

const METHOD_WORDS: Record<string, string> = {
  CASH: 'Cash',
  ON_ACCOUNT: 'No cash',
  PROFIT_SETOFF: 'Against profit',
  OPENING: 'Opening balance',
};

/**
 * One loan's statement (Fig. 5): every movement as its own row, the
 * balance after each — principal − Σ repayments — and what's waiting for a
 * Partner. The sheet's single "Remaining" cell, with its history.
 */
export default function LoanPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasPermission } = useUser();
  const isApprover = hasPermission('loans.approve');
  const canInitiate = hasPermission('loans.initiate') || isApprover;

  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [recording, setRecording] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      setLoan(await getLoan(id));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load this loan.') });
    }
  }, [id]);

  useEffect(() => {
    void load();
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, [load]);

  if (!loan) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;

  const owed = owedLabel(loan.direction, loan.outstanding);
  const status = LOAN_STATUS[loan.status];
  const active = loan.status === 'ACTIVE';
  const ownPending = loan.status === 'PENDING_APPROVAL' && loan.createdBy === user?.id;

  function act(a: Omit<ReviewAction, 'run'> & { run: (note: string) => Promise<LoanDetail>; ok: string }) {
    setReview({
      ...a,
      run: async (note) => {
        setLoan(await a.run(note));
        setNotice({ tone: 'ok', text: a.ok });
      },
    });
  }

  async function quick(fn: () => Promise<LoanDetail>, ok: string) {
    try {
      setLoan(await fn());
      setNotice({ tone: 'ok', text: ok });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'That didn’t work.') });
    }
  }

  const movementActions = (mv: LoanMovementRecord) => {
    const out: ReactElement[] = [];
    if (mv.status === 'PENDING_APPROVAL') {
      if (isApprover && active) {
        out.push(
          <Button key="a" size="sm" onClick={() => act({ title: 'Approve this movement', confirmLabel: 'Approve', noteLabel: 'Note (optional)', run: (n) => actOnMovement(mv.id, 'approve', n), ok: 'Approved and posted.' })}>
            Approve
          </Button>,
          <Button key="r" size="sm" variant="secondary" onClick={() => act({ title: 'Reject this movement', confirmLabel: 'Reject', noteLabel: 'Reason', noteRequired: true, run: (n) => actOnMovement(mv.id, 'reject', n), ok: 'Rejected.' })}>
            Reject
          </Button>,
        );
      } else if (canInitiate) {
        out.push(
          <Button key="w" size="sm" variant="secondary" onClick={() => void quick(() => actOnMovement(mv.id, 'withdraw'), 'Withdrawn.')}>
            Withdraw
          </Button>,
        );
      }
    }
    if (mv.status === 'POSTED' && canInitiate && !mv.fromUtilityBill && loan?.status !== 'CLOSED') {
      out.push(
        <Button
          key="x"
          size="sm"
          variant="secondary"
          onClick={() =>
            act({
              title: 'Reverse this movement',
              subtitle: mv.isInterUnit ? 'Both units’ halves are reversed together.' : undefined,
              confirmLabel: 'Reverse',
              noteLabel: 'Reason',
              noteRequired: true,
              run: (n) => actOnMovement(mv.id, 'reverse', n),
              ok: 'Reversed.',
            })
          }
        >
          Reverse
        </Button>,
      );
    }
    return out;
  };

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/loans" className="text-gray-400 hover:text-accent">
                Loans
              </Link>
              <span className="text-gray-300">/</span>
              {loan.loanNo} ·{' '}
              {loan.counterparty && (
                <Link href={`/loans/counterparties/${loan.counterparty.id}`} className="hover:text-accent">
                  {loan.counterparty.name}
                </Link>
              )}
              <Pill tone={status.tone}>{status.label}</Pill>
              {loan.isInterUnit && <Pill tone="blue">Inter-unit</Pill>}
            </span>
          }
          subtitle={
            <>
              {loan.businessUnit?.name} · {loan.isInterUnit ? 'current account between the units' : DIRECTION_LABELS[loan.direction]}
              {loan.account && (
                <>
                  {' · '}
                  <Link href={`/accounts/${loan.account.id}`} className="hover:text-accent">
                    {loan.account.code} {loan.account.name}
                  </Link>
                </>
              )}
              {loan.mirror && (
                <>
                  {' · '}
                  <Link href={`/loans/${loan.mirror.id}`} className="hover:text-accent">
                    {loan.mirror.businessUnit.name}&apos;s side ({loan.mirror.loanNo})
                  </Link>
                </>
              )}
            </>
          }
          actions={
            <>
              {loan.status === 'PENDING_APPROVAL' && isApprover && (
                <>
                  <Button variant="secondary" onClick={() => act({ title: `Reject ${loan.loanNo}`, confirmLabel: 'Reject', noteLabel: 'Reason', noteRequired: true, run: (n) => reviewLoan(loan.id, 'reject', n), ok: 'Rejected.' })}>
                    Reject
                  </Button>
                  <Button onClick={() => act({ title: `Approve ${loan.loanNo}`, confirmLabel: 'Approve', noteLabel: 'Note (optional)', run: (n) => reviewLoan(loan.id, 'approve', n), ok: 'Approved — its first movement is posted.' })}>
                    Approve
                  </Button>
                </>
              )}
              {canInitiate && !loan.isInterUnit && (loan.status === 'ACTIVE' || loan.status === 'PENDING_APPROVAL') && (isApprover || ownPending || loan.status === 'ACTIVE') && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {canInitiate && active && !loan.isInterUnit && toPaisa(loan.outstanding) === 0n && loan.pending === 0 && (
                <Button variant="secondary" onClick={() => void quick(() => closeLoan(loan.id, 'close'), 'Closed.')}>
                  Close loan
                </Button>
              )}
              {canInitiate && loan.status === 'CLOSED' && (
                <Button variant="secondary" onClick={() => void quick(() => closeLoan(loan.id, 'reopen'), 'Reopened.')}>
                  Reopen
                </Button>
              )}
              {canInitiate && active && (
                <Button onClick={() => (loan.isInterUnit ? setTransfer(true) : setRecording(true))}>
                  {loan.isInterUnit ? 'Transfer between units' : 'Record movement'}
                </Button>
              )}
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        >
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure
              label={owed.text}
              value={formatMoney(loan.outstanding.replace('-', ''))}
              tone={owed.tone === 'owe' ? 'danger' : owed.tone === 'owed' ? 'accent' : undefined}
            />
            <Figure label={loan.direction === 'RECEIVABLE' ? 'Lent in all' : 'Borrowed in all'} value={formatMoney(loan.principal)} />
            <Figure label="Paid back" value={formatMoney(loan.repaid)} />
            <Figure
              label="Approved ceiling"
              value={loan.limit ? `${formatMoney(loan.limit, { decimals: false })} · ${formatMoney(loan.headroom, { decimals: false })} left` : 'None'}
              hint="Advances within it post straight away; past it, a Partner approves."
            />
          </div>
          <p className="text-sm text-gray-700">{loan.purpose}</p>
          <p className="text-xs text-gray-500">
            Opened by {loan.createdByName ?? '—'} on {formatDate(loan.createdAt.slice(0, 10))}
            {loan.reviewedByName && ` · ${loan.status === 'REJECTED' ? 'rejected' : 'approved'} by ${loan.reviewedByName}`}
            {loan.reviewNote && ` — “${loan.reviewNote}”`}
          </p>
        </Section>

        <Section title="Statement" subtitle="Each movement is its own entry. Balance = everything added − everything paid back.">
          {!loan.movements.length ? (
            <p className="py-6 text-center text-sm text-gray-500">No movements yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>{loan.direction === 'RECEIVABLE' ? 'Lent / charged' : 'Borrowed'}</th>
                    <th className={`${th} text-right`}>Paid back</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={th}>Entry</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {loan.movements.map((mv) => {
                    const posted = mv.status === 'POSTED';
                    const s = MOVEMENT_STATUS[mv.status];
                    const actions = movementActions(mv);
                    return (
                      <tr key={mv.id} className={clsx('border-t border-gray-200 align-top', !posted && 'bg-gray-50/60')}>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(mv.movementDate)}</td>
                        <td className={td}>
                          <span className={clsx(mv.status === 'REVERSED' || mv.status === 'REJECTED' ? 'text-gray-400 line-through' : 'text-gray-900')}>{mv.description}</span>
                          <p className="text-xs text-gray-500">
                            {METHOD_WORDS[mv.method]}
                            {mv.method !== 'OPENING' && mv.method !== 'PROFIT_SETOFF' ? ` · ${mv.otherAccount.name}` : ''}
                            {mv.fromUtilityBill && (
                              <>
                                {' · '}
                                <Link href={`/utilities/bills/${mv.fromUtilityBill}`} className="text-accent hover:underline">
                                  utility bill
                                </Link>
                              </>
                            )}
                            {mv.createdByName ? ` · by ${mv.createdByName}` : ''}
                          </p>
                          {!posted && (
                            <p className="mt-0.5">
                              <Pill tone={s.tone}>{s.label}</Pill>
                              {mv.reviewNote && <span className="ml-1.5 text-xs text-gray-500">“{mv.reviewNote}”</span>}
                            </p>
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{mv.effect === 'INCREASE' ? formatMoney(mv.amount, { prefix: false }) : ''}</td>
                        <td className={`${td} text-right tabular-nums`}>{mv.effect === 'DECREASE' ? formatMoney(mv.amount, { prefix: false }) : ''}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>{mv.balance !== null ? formatMoney(mv.balance, { prefix: false }) : '—'}</td>
                        <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                          {mv.entry && (
                            <button type="button" onClick={() => setEntryId(mv.entry?.id ?? null)} className="text-accent hover:underline">
                              {mv.entry.displayNo}
                            </button>
                          )}
                          {mv.reversalEntry && (
                            <button type="button" onClick={() => setEntryId(mv.reversalEntry?.id ?? null)} className="block text-danger hover:underline">
                              {mv.reversalEntry.displayNo}
                            </button>
                          )}
                        </td>
                        <td className={`${td} text-right`}>{actions.length > 0 && <div className="flex justify-end gap-1.5">{actions}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <MovementModal
        loan={recording ? loan : null}
        onClose={() => setRecording(false)}
        onSaved={(s, l) => {
          setRecording(false);
          setLoan(l);
          setNotice(
            s === 'POSTED'
              ? { tone: 'ok', text: 'Recorded and posted.' }
              : { tone: 'warn', text: 'Recorded — it needs a Partner’s approval before it posts. It’s listed under Loans → Awaiting approval.' },
          );
        }}
      />
      <TransferModal
        isOpen={transfer}
        units={units}
        isApprover={isApprover}
        onClose={() => setTransfer(false)}
        onSaved={(s) => {
          setTransfer(false);
          setNotice({ tone: s === 'POSTED' ? 'ok' : 'warn', text: s === 'POSTED' ? 'Transferred.' : 'Sent to a Partner for approval.' });
          void load();
        }}
      />
      <EditLoanModal
        loan={editing ? loan : null}
        canCeiling={isApprover || ownPending}
        onClose={() => setEditing(false)}
        onSaved={(l) => {
          setEditing(false);
          setLoan(l);
          setNotice({ tone: 'ok', text: 'Saved.' });
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => void load()} onOpenEntry={setEntryId} />
    </div>
  );
}

function EditLoanModal({
  loan,
  canCeiling,
  onClose,
  onSaved,
}: {
  loan: LoanDetail | null;
  canCeiling: boolean;
  onClose: () => void;
  onSaved: (l: LoanDetail) => void;
}) {
  const [purpose, setPurpose] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loan) return;
    setPurpose(loan.purpose);
    setLimit(loan.limit ?? '');
    setError(null);
  }, [loan]);

  async function submit() {
    if (!loan) return;
    if (purpose.trim().length < 3) return setError('Say what the loan is for.');
    if (limit && (!isAmount(limit) || toPaisa(limit) <= 0n)) return setError('The ceiling must be an amount, or blank.');
    setSaving(true);
    try {
      onSaved(
        await updateLoan(loan.id, {
          purpose: purpose.trim(),
          ...(canCeiling ? { limit: limit.trim() || null } : {}),
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(loan)}
      onClose={onClose}
      title={loan ? `Edit ${loan.loanNo}` : 'Edit'}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <TextArea label="Purpose" required rows={2} value={purpose} onChange={setPurpose} />
        <Input
          label="Approved ceiling (Rs)"
          inputMode="decimal"
          value={limit}
          disabled={!canCeiling}
          placeholder="Blank = no ceiling"
          helperText={canCeiling ? 'Advances within it post straight away.' : 'Only a Partner can change an approved loan’s ceiling.'}
          onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))}
        />
      </div>
    </Modal>
  );
}
