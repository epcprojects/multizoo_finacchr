'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '../../../../../components/layout/UserProvider';
import Button from '../../../../../components/ui/Button';
import EntryDetailModal from '../../../../../components/ledger/EntryDetailModal';
import LoanModal from '../../../../../components/loans/LoanModal';
import { Figure, NoticeLine, Pill, Section, type Notice } from '../../../../../components/hr/ui';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../../../lib/api/ledger';
import {
  KIND_LABELS,
  LOAN_STATUS,
  getCounterpartyStatement,
  listCounterparties,
  owedLabel,
  type CounterpartyRecord,
  type CounterpartyStatement,
} from '../../../../../lib/api/loans';
import { errorMessage, formatDate, formatMoney } from '../../../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2.5';

/** "They owe us" positive → words. */
function position(net: string) {
  if (/^-?0\.00$/.test(net)) return { text: 'Nothing outstanding', tone: undefined };
  return net.startsWith('-')
    ? { text: `The group owes ${formatMoney(net.slice(1))}`, tone: 'danger' as const }
    : { text: `Owes the group ${formatMoney(net)}`, tone: 'accent' as const };
}

/**
 * Everything between the group and one person or company — the "Loan &
 * payable/receivable statement" (Part 08): each loan, every movement in
 * date order with the running position, and an employee's salary advances.
 */
export default function CounterpartyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useUser();
  const isApprover = hasPermission('loans.approve');
  const canInitiate = hasPermission('loans.initiate') || isApprover;
  const [data, setData] = useState<CounterpartyStatement | null>(null);
  const [counterparties, setCounterparties] = useState<CounterpartyRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [newLoan, setNewLoan] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    getCounterpartyStatement(id).then(setData, (err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the statement.') }));
    void listCounterparties().then(setCounterparties).catch(() => undefined);
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, [id]);

  if (!data) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const c = data.counterparty;
  const total = position(data.totals.net);

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
              {c.name}
              <Pill tone={c.kind === 'PARTNER' ? 'violet' : 'gray'}>{c.partner ? `Partner · ${c.partner.shortName}` : KIND_LABELS[c.kind]}</Pill>
              {!c.isActive && <Pill>Inactive</Pill>}
            </span>
          }
          subtitle={[
            c.employee ? `${c.employee.employeeCode} · ${c.employee.designation ?? ''} · ${c.employee.unit ?? ''}` : null,
            c.phone,
            c.notes,
          ]
            .filter(Boolean)
            .join(' · ')}
          actions={
            <>
              {c.employee && (
                <Button variant="secondary" onClick={() => router.push(`/employees/${c.employee?.id}`)}>
                  Employee record
                </Button>
              )}
              {canInitiate && c.kind !== 'BUSINESS_UNIT' && c.isActive && <Button onClick={() => setNewLoan(true)}>New loan</Button>}
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        >
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Position" value={total.text} tone={total.tone} />
            <Figure label="On loans" value={position(data.totals.loansNet).text} />
            {c.employee && <Figure label="Salary advances outstanding" value={formatMoney(data.totals.staffAdvances)} />}
          </div>
        </Section>

        <Section title="Loans">
          {!data.loans.length ? (
            <p className="py-4 text-center text-sm text-gray-500">No loans with {c.name}.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-170 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Loan</th>
                    <th className={th}>Unit</th>
                    <th className={`${th} text-right`}>Lent / borrowed</th>
                    <th className={`${th} text-right`}>Paid back</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.loans.map((l) => {
                    const o = owedLabel(l.direction, l.outstanding);
                    const s = LOAN_STATUS[l.status];
                    return (
                      <tr key={l.id} onClick={() => router.push(`/loans/${l.id}`)} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50">
                        <td className={td}>
                          <span className="font-mono text-xs">{l.loanNo}</span>
                          <p className="max-w-xs truncate text-xs text-gray-500">{l.purpose}</p>
                        </td>
                        <td className={td}>{l.businessUnit.code}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(l.principal)}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(l.repaid)}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          <span className="font-semibold">{formatMoney(l.outstanding.replace('-', ''))}</span>
                          <p className="text-xs text-gray-500">{o.text}</p>
                        </td>
                        <td className={td}>
                          <Pill tone={s.tone}>{s.label}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {data.movements.length > 0 && (
          <Section title="Statement" subtitle="Every posted movement across their loans, oldest first. Position: positive when they owe the group.">
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-170 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Loan</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>Adds</th>
                    <th className={`${th} text-right`}>Pays back</th>
                    <th className={`${th} text-right`}>Position</th>
                    <th className={th}>Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((mv) => (
                    <tr key={mv.id} className="border-t border-gray-200">
                      <td className={`${td} whitespace-nowrap`}>{formatDate(mv.date)}</td>
                      <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                        {mv.loan.loanNo} · {mv.loan.unit}
                      </td>
                      <td className={td}>{mv.description}</td>
                      <td className={`${td} text-right tabular-nums`}>{mv.effect === 'INCREASE' ? formatMoney(mv.amount, { prefix: false }) : ''}</td>
                      <td className={`${td} text-right tabular-nums`}>{mv.effect === 'DECREASE' ? formatMoney(mv.amount, { prefix: false }) : ''}</td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatMoney(mv.net, { prefix: false })}</td>
                      <td className={`${td} font-mono text-xs`}>
                        {mv.entry && (
                          <button type="button" onClick={() => setEntryId(mv.entry?.id ?? null)} className="text-accent hover:underline">
                            {mv.entry.displayNo}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {c.employee && (
          <Section
            title="Salary advances"
            subtitle={
              <>
                Paid and recovered on the{' '}
                <Link href="/payroll" className="text-accent underline">
                  Payroll screen
                </Link>
                .
              </>
            }
          >
            {!data.staffAdvances.length ? (
              <p className="py-4 text-center text-sm text-gray-500">None.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-150 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className={th}>Paid</th>
                      <th className={th}>Reason</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={`${th} text-right`}>Recovered</th>
                      <th className={`${th} text-right`}>Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staffAdvances.map((a) => (
                      <tr key={a.id} className="border-t border-gray-200">
                        <td className={`${td} whitespace-nowrap`}>{formatDate(a.issueDate)}</td>
                        <td className={td}>{a.reason}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(a.amount)}</td>
                        <td className={`${td} text-right tabular-nums`}>{formatMoney(a.recovered)}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {a.status === 'WRITTEN_OFF' ? (
                            <Pill tone="red">{formatMoney(a.writtenOff)} written off</Pill>
                          ) : a.status === 'CANCELLED' ? (
                            <Pill>Cancelled</Pill>
                          ) : a.status === 'RECOVERED' ? (
                            <Pill tone="green">Recovered</Pill>
                          ) : (
                            formatMoney(a.outstanding)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}
      </div>
      <LoanModal
        isOpen={newLoan}
        counterparties={counterparties}
        units={units}
        counterpartyId={c.id}
        isApprover={isApprover}
        onClose={() => setNewLoan(false)}
        onSaved={(loan) => router.push(`/loans/${loan.id}`)}
      />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => undefined} onOpenEntry={setEntryId} />
    </div>
  );
}
