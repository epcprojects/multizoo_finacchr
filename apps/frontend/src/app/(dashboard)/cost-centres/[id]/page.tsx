'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useUser } from '../../../../components/layout/UserProvider';
import Input from '../../../../components/ui/Input';
import Button from '../../../../components/ui/Button';
import EntryDetailModal from '../../../../components/ledger/EntryDetailModal';
import { Figure, NoticeLine, Pill, Section, type Notice } from '../../../../components/hr/ui';
import { formatMonth } from '../../../../lib/api/hr';
import { listJournalEntries, type JournalEntryRecord } from '../../../../lib/api/ledger';
import { getCostCentreReport, type CostCentreReport } from '../../../../lib/api/cost-centres';
import { errorMessage, formatDate, formatMoney, todayIso, toPaisa } from '../../../../lib/money';
import PdfButton from '../../../../components/reports/PdfButton';

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

/**
 * One cost centre's spending — the `342 Expense` sheets' totals by category,
 * now by month too, and who bore it: the unit's P&L or a partner's profit.
 */
export default function CostCentreReportPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useUser();
  const [from, setFrom] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayIso());
  const [report, setReport] = useState<CostCentreReport | null>(null);
  const [entries, setEntries] = useState<JournalEntryRecord[]>([]);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        getCostCentreReport(id, { from: from || undefined, to: to || undefined }),
        listJournalEntries({ costCentreId: id, from: from || undefined, to: to || undefined, limit: 50 }),
      ]);
      setReport(r);
      setEntries(e.items);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the report.') });
    }
  }, [id, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!report) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const c = report.costCentre;
  const categories = report.byCategory.map((x) => x.category);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/cost-centres" className="text-gray-400 hover:text-accent">
                Cost centres
              </Link>
              <span className="text-gray-300">/</span>
              {c.code} · {c.name}
              {c.chargeTo === 'PARTNER' ? <Pill tone="violet">Charged to {c.partner?.shortName}</Pill> : <Pill>Unit’s own P&amp;L</Pill>}
              {!c.isActive && <Pill>Inactive</Pill>}
            </span>
          }
          subtitle={c.description ?? undefined}
          actions={
            <>
              <PdfButton report="cost-centre" params={{ costCentreId: id, from, to }} />
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-40">
              <Input label="To" type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Spent" value={formatMoney(report.total)} tone="accent" />
            {report.byCharge.map((b) => (
              <Figure
                key={b.chargedTo ?? 'unit'}
                label={b.chargedTo ? `Charged to ${b.chargedTo}’s profit` : 'On the units’ own P&L'}
                value={formatMoney(b.amount)}
              />
            ))}
            {report.byUnit.map((u) => (
              <Figure key={u.unit} label={`Paid by ${u.unit}`} value={formatMoney(u.amount)} />
            ))}
          </div>
        </Section>

        <Section title="By category" subtitle="Each expense account the centre’s spending was entered under.">
          {!report.byCategory.length ? (
            <p className="py-4 text-center text-sm text-gray-500">Nothing tagged {c.code} in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-120 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Category</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCategory.map((x) => (
                    <tr key={x.category} className="border-t border-gray-200">
                      <td className={td}>{x.category}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(x.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                    <td className={td}>Total</td>
                    <td className={`${td} text-right tabular-nums`}>{formatMoney(report.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {report.byMonth.length > 0 && (
          <Section title="By month">
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-120 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Month</th>
                    {categories.map((cat) => (
                      <th key={cat} className={`${th} text-right`}>
                        {cat}
                      </th>
                    ))}
                    <th className={`${th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byMonth.map((mo) => (
                    <tr key={mo.month} className="border-t border-gray-200">
                      <td className={`${td} whitespace-nowrap`}>{formatMonth(mo.month)}</td>
                      {categories.map((cat) => (
                        <td key={cat} className={`${td} text-right tabular-nums`}>
                          {mo.byCategory[cat] ? formatMoney(mo.byCategory[cat], { prefix: false }) : '—'}
                        </td>
                      ))}
                      <td className={`${td} text-right font-semibold tabular-nums`}>{formatMoney(mo.amount, { prefix: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section title="Entries" subtitle={`The latest ${entries.length} entries tagged ${c.code}.`}>
          {!entries.length ? (
            <p className="py-4 text-center text-sm text-gray-500">None in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-150 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Entry</th>
                    <th className={th}>Date</th>
                    <th className={th}>Unit</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} onClick={() => setEntryId(e.id)} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50">
                      <td className={`${td} font-mono text-xs`}>{e.displayNo}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(e.entryDate)}</td>
                      <td className={td}>{e.businessUnit?.code}</td>
                      <td className={td}>
                        <span className={e.reversedById ? 'text-gray-400 line-through' : ''}>{e.description}</span>
                        {e.kind === 'REVERSAL' && <span className="ml-1.5"><Pill tone="amber">Reversal</Pill></span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {formatMoney(
                          e.lines
                            .filter((l) => l.costCentre && !l.crossCharge)
                            .reduce((s, l) => s + toPaisa(l.debit) - toPaisa(l.credit), 0n),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <EntryDetailModal
        entryId={entryId}
        onClose={() => setEntryId(null)}
        canReverse={hasPermission('transactions.reverse')}
        onChanged={() => void load()}
        onOpenEntry={setEntryId}
      />
    </div>
  );
}
