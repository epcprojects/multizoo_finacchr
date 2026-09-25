'use client';

import clsx from 'clsx';
import { Figure } from './ui';
import { DAY_KIND, formatDays, type DayKind, type EmployeeMonth, type MonthSummary } from '../../lib/api/hr';

const HEAD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DayKindLegend({ kinds }: { kinds?: DayKind[] }) {
  const shown: DayKind[] = kinds ?? ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE_PAID', 'LEAVE_UNPAID', 'EXTRA', 'OFF', 'UNMARKED'];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600">
      {shown.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={clsx('inline-flex h-5 w-5 items-center justify-center rounded border text-[11px] font-semibold', DAY_KIND[k].tone)}>
            {DAY_KIND[k].short}
          </span>
          {DAY_KIND[k].label}
        </span>
      ))}
    </div>
  );
}

/**
 * The month's figures as payroll will read them. "Absent for payroll" is
 * the salary sheet's Absent column: absences, half days and leave the
 * balance didn't cover, less rest days worked.
 */
export function MonthFigures({ summary }: { summary: MonthSummary }) {
  const payroll = summary.payrollAbsentDays;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3 sm:grid-cols-4 lg:grid-cols-8">
      <Figure label="Present" value={summary.present} />
      <Figure label="Absent" value={summary.absent} tone={summary.absent ? 'danger' : undefined} />
      <Figure label="Half days" value={summary.halfDays} />
      <Figure label="Paid leave" value={summary.paidLeave} />
      <Figure label="Not covered" value={summary.unpaidLeave} tone={summary.unpaidLeave ? 'danger' : undefined} hint="Leave beyond the balance, or unpaid leave" />
      <Figure label="Rest days worked" value={formatDays(summary.extraDays)} tone={summary.extraDays !== '0' ? 'accent' : undefined} />
      <Figure label="Not marked" value={summary.unmarked} tone={summary.unmarked ? 'danger' : undefined} />
      <Figure
        label="Absent for payroll"
        value={formatDays(payroll)}
        tone={payroll.startsWith('-') ? 'accent' : payroll !== '0' ? 'danger' : undefined}
        hint="The salary sheet's Absent column — negative when they worked more rest days than they missed"
      />
    </div>
  );
}

/** One employee's month, Sunday-first, each day in the register's vocabulary. */
export default function MonthCalendar({ month }: { month: EmployeeMonth }) {
  const lead = month.days[0]?.weekday ?? 0;
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {HEAD.map((h) => (
        <p key={h} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {h}
        </p>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`lead-${i}`} />
      ))}
      {month.days.map((d) => {
        const kind = DAY_KIND[d.kind];
        const title = [
          kind.label,
          d.leaveType,
          d.holiday ? `Holiday: ${d.holiday}` : d.restReason === 'WEEKLY_OFF' ? 'Weekly day off' : null,
          d.unitCode ? `Marked at ${d.unitCode}` : null,
          d.note,
          d.markedByName ? `Marked by ${d.markedByName}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={d.date} title={title} className={clsx('flex min-h-14 flex-col rounded-lg border p-1.5', kind.tone)}>
            <span className="text-[11px] opacity-70">{Number(d.date.slice(8))}</span>
            <span className="mt-auto text-center text-sm font-semibold">{kind.short}</span>
            {d.leaveType && <span className="truncate text-center text-[10px]">{d.leaveType}</span>}
            {d.holiday && !d.leaveType && <span className="truncate text-center text-[10px]">{d.holiday}</span>}
          </div>
        );
      })}
    </div>
  );
}
