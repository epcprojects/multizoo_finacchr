'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '../ui/Button';
import { NoticeLine, Pill, type Notice } from '../hr/ui';
import AdvanceModal from './AdvanceModal';
import { formatDays, formatMonth, type EmployeeRecord } from '../../lib/api/hr';
import {
  RUN_STATUS,
  createSettlement,
  listAdvances,
  listEmployeePayslips,
  listSettlements,
  type AdvanceRecord,
  type EmployeePayslip,
  type SettlementRow,
} from '../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney } from '../../lib/money';

/** One employee's pay: payslips month by month, advances, and — once they leave — their settlement. */
export default function EmployeePayTab({ employee: e, canRun }: { employee: EmployeeRecord; canRun: boolean }) {
  const router = useRouter();
  const [slips, setSlips] = useState<EmployeePayslip[] | null>(null);
  const [advances, setAdvances] = useState<AdvanceRecord[]>([]);
  const [settlement, setSettlement] = useState<SettlementRow | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, a, s] = await Promise.all([listEmployeePayslips(e.id), listAdvances({ employeeId: e.id }), listSettlements({ employeeId: e.id })]);
      setSlips(p);
      setAdvances(a);
      setSettlement(s[0] ?? null);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load their pay.') });
    }
  }, [e.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = e.status === 'ACTIVE' || e.isLeaving;

  return (
    <div className="flex flex-col gap-4">
      <NoticeLine notice={notice} onClose={() => setNotice(null)} />

      {e.status === 'EXITED' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Full &amp; final settlement</p>
            <p className="text-xs text-gray-600">
              {settlement
                ? `${RUN_STATUS[settlement.status].label}${settlement.net ? ` · ${formatMoney(settlement.net)}` : ''}${settlement.paidOn ? ` · paid ${formatDate(settlement.paidOn)}` : ''}`
                : `Last day ${e.exitDate ? formatDate(e.exitDate) : '—'} — not prepared yet.`}
            </p>
          </div>
          {settlement ? (
            <Link href={`/payroll/settlements/${settlement.id}`}>
              <Button size="sm" variant="secondary">
                Open
              </Button>
            </Link>
          ) : (
            canRun && (
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const s = await createSettlement(e.id);
                    router.push(`/payroll/settlements/${s.id}`);
                  } catch (err) {
                    setNotice({ tone: 'error', text: errorMessage(err, 'Could not prepare it.') });
                    setBusy(false);
                  }
                }}
              >
                Prepare settlement
              </Button>
            )
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Advances</p>
          {canRun && active && (
            <Button size="sm" variant="secondary" onClick={() => setAdvanceOpen(true)}>
              New advance
            </Button>
          )}
        </div>
        {advances.length === 0 ? (
          <p className="text-sm text-gray-500">None.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-200">
            {advances.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {formatMoney(a.amount)} on {formatDate(a.issueDate)} <span className="text-xs text-gray-500">· {a.reason}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {a.recoveries.map((r) => `${formatMonth(r.month)} ${formatMoney(r.amount)}`).join(' · ')}
                  {a.status === 'OUTSTANDING' ? (
                    <Pill tone="amber">{formatMoney(a.outstanding)} to recover</Pill>
                  ) : (
                    <Pill tone={a.status === 'RECOVERED' ? 'green' : 'gray'}>{a.status === 'RECOVERED' ? 'Recovered' : 'Cancelled'}</Pill>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-900">Payslips</p>
        {!slips ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : slips.length === 0 ? (
          <p className="text-sm text-gray-500">No finalised payroll yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-900">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Month</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Salary</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Absent</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Bonus</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Fine</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Net</th>
                  <th className="px-4 py-2.5 font-semibold">Paid</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((p) => (
                  <tr key={p.runId} className="border-t border-gray-100">
                    <td className="px-4 py-2.5">
                      <Link href={`/payroll/runs/${p.runId}/payslip/${e.id}`} className="font-medium text-gray-900 hover:text-accent">
                        {formatMonth(p.month)}
                      </Link>
                      <span className="text-xs text-gray-500"> · {p.businessUnit.code}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.salary, { prefix: false })}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatDays(p.absentDays)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.bonus, { prefix: false })}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.fines, { prefix: false })}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(p.net, { prefix: false })}</td>
                    <td className="px-4 py-2.5 text-xs">{p.paidOn ? formatDate(p.paidOn) : <span className="text-warning-800">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdvanceModal
        isOpen={advanceOpen}
        employees={[e]}
        employeeId={e.id}
        onClose={() => setAdvanceOpen(false)}
        onSaved={() => {
          setAdvanceOpen(false);
          setNotice({ tone: 'ok', text: 'Advance paid — payroll will recover it.' });
          void refresh();
        }}
      />
    </div>
  );
}
