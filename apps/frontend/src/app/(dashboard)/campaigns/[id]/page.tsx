'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import EntryDetailModal from '../../../../components/ledger/EntryDetailModal';
import ReviewNoteModal, { type ReviewAction } from '../../../../components/hr/ReviewNoteModal';
import { Figure, NoticeLine, Pill, Section, type Notice } from '../../../../components/hr/ui';
import { CampaignEntryModal, CampaignModal, CloseCampaignModal } from '../../../../components/campaigns/CampaignModals';
import { getCampaign, reopenCampaign, reverseCampaignEntry, type CampaignDetail, type CampaignEntryType } from '../../../../lib/api/capex';
import { errorMessage, formatDate, formatMoney } from '../../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2';

/**
 * A campaign's own P&L — the Ramazan sheet's "Total income / Total
 * expenses / Balance", what it was raised from and spent on by category,
 * its budget, and every receipt and payment with the running balance.
 */
export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useUser();
  const canManage = hasPermission('capex.manage');
  const [c, setC] = useState<CampaignDetail | null>(null);
  const [adding, setAdding] = useState<CampaignEntryType | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    getCampaign(id).then(setC, (err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the campaign.') }));
  }, [id]);

  if (!c) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const s = c.statement;
  const open = c.status === 'OPEN';
  const short = s.balance.startsWith('-');

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/campaigns" className="text-gray-400 hover:text-accent">
                Campaigns
              </Link>
              <span className="text-gray-300">/</span>
              {c.name}
              {open ? <Pill tone="green">Running</Pill> : <Pill>Closed {c.closedOn ? formatDate(c.closedOn) : ''}</Pill>}
            </span>
          }
          subtitle={`${c.businessUnit.name} · ${formatDate(c.startDate)}${c.endDate ? ` – ${formatDate(c.endDate)}` : ' on'}${c.fundAccount ? ` · fund ${c.fundAccount.code}` : ''}`}
          actions={
            canManage && (
              <>
                {open && (
                  <>
                    <Button onClick={() => setAdding('INCOME')}>Money raised</Button>
                    <Button onClick={() => setAdding('EXPENSE')}>Money spent</Button>
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => setClosing(true)}>
                      Close
                    </Button>
                  </>
                )}
                {!open && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        setC(await reopenCampaign(c.id));
                        setNotice({ tone: 'ok', text: 'Reopened — the closing entry was reversed.' });
                      } catch (err) {
                        setNotice({ tone: 'error', text: errorMessage(err, 'Could not reopen.') });
                      }
                    }}
                  >
                    Reopen
                  </Button>
                )}
              </>
            )
          }
        >
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 p-3 sm:grid-cols-4">
            <Figure label="Total income" value={formatMoney(s.income)} />
            <Figure label="Total expenses" value={formatMoney(s.expenses)} />
            <Figure label="Balance" value={formatMoney(s.balance)} tone={short ? 'danger' : 'accent'} hint="Raised less spent. Negative: the unit has carried the difference." />
            <Figure label="Budget" value={s.budget ? formatMoney(s.budget.total) : '—'} hint={s.budget ? `Spent ${s.budget.spentPct ?? '—'}% of it` : undefined} />
          </div>
          {s.budget && open && (
            <p className="text-sm text-gray-600">
              Still to raise to meet the budget: <b className="tabular-nums">{formatMoney(s.budget.stillToRaise)}</b> · budget left to spend:{' '}
              <b className={clsx('tabular-nums', s.budget.left.startsWith('-') && 'text-danger')}>{formatMoney(s.budget.left)}</b>
            </p>
          )}
          {!open && c.closingEntry && (
            <p className="text-sm text-gray-600">
              Closed into {c.closeAccount?.name} by{' '}
              <button type="button" className="font-mono text-accent hover:underline" onClick={() => setEntryId(c.closingEntry?.id ?? null)}>
                {c.closingEntry.displayNo}
              </button>
              {c.closedByName ? ` (${c.closedByName})` : ''}.
            </p>
          )}
        </Section>

        <div className="grid gap-3 md:grid-cols-3">
          <Section title="Raised from">
            <CategoryList rows={s.incomeByCategory} total={s.income} />
          </Section>
          <Section title="Spent on">
            <CategoryList rows={s.expensesByCategory} total={s.expenses} />
          </Section>
          <Section title="Budget">
            {c.budget.length ? (
              <div className="flex flex-col gap-1.5 text-sm">
                {c.budget.map((b, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="truncate">{b.label}</span>
                    <span className="tabular-nums">{formatMoney(b.amount, { decimals: false })}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(s.budget?.total ?? '0', { decimals: false })}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No budget set.</p>
            )}
          </Section>
        </div>

        <Section title="Receipts & payments">
          {!c.entries.length ? (
            <p className="py-6 text-center text-sm text-gray-500">Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Description</th>
                    <th className={th}>Category</th>
                    <th className={`${th} text-right`}>Income</th>
                    <th className={`${th} text-right`}>Expense</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={th}>Entry</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {c.entries.map((e) => {
                    const reversed = e.status === 'REVERSED';
                    return (
                      <tr key={e.id} className={clsx('border-t border-gray-200', reversed && 'text-gray-400 line-through decoration-gray-300')}>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(e.entryDate)}</td>
                        <td className={td}>
                          {e.description}
                          {e.account && <span className="block text-xs text-gray-500 no-underline">{e.type === 'INCOME' ? 'into' : 'from'} {e.account.name}</span>}
                        </td>
                        <td className={td}>{e.category}</td>
                        <td className={`${td} text-right tabular-nums`}>{e.type === 'INCOME' ? formatMoney(e.amount, { decimals: false, prefix: false }) : ''}</td>
                        <td className={`${td} text-right tabular-nums`}>{e.type === 'EXPENSE' ? formatMoney(e.amount, { decimals: false, prefix: false }) : ''}</td>
                        <td className={`${td} text-right tabular-nums ${e.balance?.startsWith('-') ? 'text-danger' : ''}`}>{e.balance ? formatMoney(e.balance, { decimals: false, prefix: false }) : ''}</td>
                        <td className={td}>
                          {e.entry && (
                            <button type="button" className="font-mono text-xs text-accent hover:underline" onClick={() => setEntryId(e.entry?.id ?? null)}>
                              {e.entry.displayNo}
                            </button>
                          )}
                          {reversed && <span className="ml-1 text-xs no-underline">reversed</span>}
                        </td>
                        <td className={`${td} text-right`}>
                          {canManage && open && !reversed && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setReview({
                                  title: 'Reverse this entry?',
                                  subtitle: `${e.description} — ${formatMoney(e.amount)}`,
                                  confirmLabel: 'Reverse',
                                  noteLabel: 'Why',
                                  run: async (note) => {
                                    setC(await reverseCampaignEntry(c.id, e.id, note || undefined));
                                  },
                                })
                              }
                            >
                              Reverse
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

      <CampaignEntryModal
        campaign={c}
        type={adding}
        onClose={() => setAdding(null)}
        onSaved={(next) => {
          setAdding(null);
          setC(next);
        }}
      />
      <CampaignModal
        isOpen={editing}
        campaign={c}
        units={[]}
        onClose={() => setEditing(false)}
        onSaved={(next) => {
          setEditing(false);
          setC(next);
        }}
      />
      <CloseCampaignModal
        campaign={c}
        isOpen={closing}
        onClose={() => setClosing(false)}
        onSaved={(next) => {
          setClosing(false);
          setC(next);
          setNotice({ tone: 'ok', text: 'Closed.' });
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => undefined} onOpenEntry={setEntryId} />
    </div>
  );
}

function CategoryList({ rows, total }: { rows: { category: string; amount: string }[]; total: string }) {
  if (!rows.length) return <p className="text-sm text-gray-500">Nothing yet.</p>;
  const max = Math.max(...rows.map((r) => Number(r.amount)), 1);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {rows.map((r) => (
        <div key={r.category} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          <span className="truncate">{r.category}</span>
          <span className="tabular-nums">{formatMoney(r.amount, { decimals: false })}</span>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(Number(r.amount) / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(total, { decimals: false })}</span>
      </div>
    </div>
  );
}
