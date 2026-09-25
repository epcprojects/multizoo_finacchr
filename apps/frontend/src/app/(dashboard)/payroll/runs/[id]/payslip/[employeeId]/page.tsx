'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Button from '../../../../../../../components/ui/Button';
import { Pill } from '../../../../../../../components/hr/ui';
import { EMPLOYMENT_TYPE_LABELS, formatDays, formatMonth } from '../../../../../../../lib/api/hr';
import { RUN_STATUS, getPayslip, type PayslipView } from '../../../../../../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney, fromPaisa, toPaisa } from '../../../../../../../lib/money';

function Line({ label, sub, amount, strong }: { label: ReactNode; sub?: string; amount: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-gray-300 pt-1.5 font-semibold' : 'flex justify-between'}>
      <span>
        {label}
        {sub && <span className="text-gray-500"> · {sub}</span>}
      </span>
      <span className="tabular-nums">{formatMoney(amount)}</span>
    </div>
  );
}

/**
 * One person's payslip for one month. Printable from the browser; the
 * archived PDF version comes with the reporting suite (Module 8).
 */
export default function PayslipPage() {
  const { id, employeeId } = useParams<{ id: string; employeeId: string }>();
  const [slip, setSlip] = useState<PayslipView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPayslip(id, employeeId).then(setSlip, (err) => setError(errorMessage(err, 'Could not load the payslip.')));
  }, [id, employeeId]);

  if (!slip) return <div className="p-8 text-center text-sm text-gray-500">{error ?? 'Loading…'}</div>;
  const { run, employee: e, row: r } = slip;
  const d = r.details;
  const salaryForDays = fromPaisa(toPaisa(r.earned) - toPaisa(r.absenceDeduction));

  return (
    <div className="relative z-100 h-full overflow-y-auto px-4 pt-2 pb-8 xl:py-5 xl:pr-5 print:overflow-visible print:p-0">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <Link href={`/payroll/runs/${run.id}`} className="text-sm text-gray-600 hover:text-accent">
            ← {run.businessUnit.name} — {formatMonth(run.month)}
          </Link>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <article className="rounded-xl bg-white p-6 text-sm text-gray-900 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] print:shadow-none">
          <header className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">{run.businessUnit.name}</p>
              <h1 className="text-xl font-bold">Payslip — {formatMonth(run.month)}</h1>
            </div>
            {run.status === 'DRAFT' ? <Pill tone="amber">Draft — not final</Pill> : <Pill tone={RUN_STATUS[run.status].tone}>{r.paidOn ? `Paid ${formatDate(r.paidOn)}` : 'Finalised'}</Pill>}
          </header>

          <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-gray-200 py-4 text-xs">
            <p><span className="text-gray-500">Name</span> {r.fullName}</p>
            <p><span className="text-gray-500">Code</span> {r.employeeCode}</p>
            <p><span className="text-gray-500">Designation</span> {r.designation ?? '—'}</p>
            <p><span className="text-gray-500">Department</span> {r.department ?? '—'}</p>
            {e && <p><span className="text-gray-500">Employment</span> {EMPLOYMENT_TYPE_LABELS[e.employmentType]}, since {formatDate(e.joinDate)}</p>}
            {e?.cnic && <p><span className="text-gray-500">CNIC</span> {e.cnic}</p>}
          </section>

          <section className="grid grid-cols-3 gap-2 border-b border-gray-200 py-4 text-center text-xs">
            <div><p className="text-gray-500">Days employed</p><p className="text-base font-semibold">{d.attendance.employedDays}</p></div>
            <div><p className="text-gray-500">{r.payBasis === 'DAILY' ? 'Days paid' : 'Absent (net)'}</p><p className="text-base font-semibold">{r.payBasis === 'DAILY' ? formatDays(d.paidDays ?? '0') : formatDays(r.absentDays)}</p></div>
            <div><p className="text-gray-500">Rest days worked</p><p className="text-base font-semibold">{formatDays(d.attendance.extraDays)}</p></div>
            <p className="col-span-3 text-gray-500">
              {d.attendance.present} present · {d.attendance.halfDays} half days · {d.attendance.absent} absent · {d.attendance.paidLeave} paid leave
              {d.attendance.unpaidLeave ? ` · ${d.attendance.unpaidLeave} leave not covered` : ''}
              {d.attendance.unmarked ? ` · ${d.attendance.unmarked} not marked` : ''}
            </p>
          </section>

          <section className="grid gap-6 py-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Earnings</p>
              {r.payBasis === 'DAILY' ? (
                <Line label="Days paid" sub={`${formatDays(d.paidDays ?? '0')} × ${formatMoney(r.salary)}`} amount={r.earned} />
              ) : r.earned === r.salary ? (
                <Line label="Monthly salary" amount={r.salary} />
              ) : (
                <Line label="Salary for the days employed" sub={`${formatMoney(r.salary)} a month`} amount={r.earned} />
              )}
              {toPaisa(r.absenceDeduction) !== 0n && (
                <Line
                  label={toPaisa(r.absenceDeduction) < 0n ? 'Rest days worked' : 'Absences'}
                  sub={`${formatDays(r.absentDays)} × salary/30`}
                  amount={fromPaisa(-toPaisa(r.absenceDeduction))}
                />
              )}
              {d.poolShares.map((p) => <Line key={p.poolId} label={p.title} sub="commission" amount={p.amount} />)}
              {d.allowances.map((a, i) => <Line key={i} label={a.description} amount={a.amount} />)}
              <Line strong label="Total earnings" amount={fromPaisa(toPaisa(salaryForDays) + toPaisa(r.bonus))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deductions</p>
              {d.recoveries.map((a) => <Line key={a.advanceId} label="Advance recovered" sub={`${formatMoney(a.outstandingAfter)} left`} amount={a.amount} />)}
              {d.fines.map((f) => <Line key={f.id} label={f.reason} sub={`fine ${formatDate(f.date)}`} amount={f.amount} />)}
              {d.food.map((f, i) => <Line key={i} label={f.description} sub="food" amount={f.amount} />)}
              {d.deductions.map((f, i) => <Line key={i} label={f.description} amount={f.amount} />)}
              {toPaisa(r.eobiEmployee) > 0n && <Line label="EOBI" amount={r.eobiEmployee} />}
              {toPaisa(r.tax) > 0n && <Line label="Income tax" amount={r.tax} />}
              {toPaisa(r.pfEmployee) > 0n && <Line label="Provident fund" amount={r.pfEmployee} />}
              <Line
                strong
                label="Total deductions"
                amount={fromPaisa(toPaisa(salaryForDays) + toPaisa(r.bonus) - toPaisa(r.net))}
              />
            </div>
          </section>

          <footer className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
            <span className="font-semibold">Net pay</span>
            <span className="text-xl font-bold tabular-nums">{formatMoney(r.net)}</span>
          </footer>
          <p className="mt-3 text-[11px] text-gray-500">
            Absent counts absences, half of each half day and leave beyond the balance, less rest days worked. A day’s pay is the monthly salary ÷{' '}
            {run.policy?.daysPerMonth ?? 30}.
          </p>
        </article>
      </div>
    </div>
  );
}
