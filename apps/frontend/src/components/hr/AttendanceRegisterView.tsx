'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { DayKindLegend } from './MonthCalendar';
import { DAY_KIND, formatDays, type AttendanceRegister } from '../../lib/api/hr';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The month on one screen: a row per person, a column per day, and the
 * figures payroll reads — ending in the salary sheet's own "Absent" column.
 */
export default function AttendanceRegisterView({ register }: { register: AttendanceRegister }) {
  const totalUnmarked = register.employees.reduce((s, e) => s + e.summary.unmarked, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <DayKindLegend />
        {totalUnmarked > 0 && (
          <p className="text-sm text-warning-900">
            {totalUnmarked} working {totalUnmarked === 1 ? 'day is' : 'days are'} not marked yet.
          </p>
        )}
      </div>
      {!register.employees.length ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          Nobody was employed at {register.unit.name} this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="bg-gray-50 text-gray-900">
              <tr>
                <th className="sticky left-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-2 font-semibold">Employee</th>
                {register.calendar.map((d) => (
                  <th
                    key={d.date}
                    title={d.holiday ?? undefined}
                    className={clsx('border-b border-gray-200 px-0.5 py-1 text-center font-medium', d.holiday && 'text-violet-700')}
                  >
                    <span className="block text-[10px] text-gray-400">{DOW[d.weekday]}</span>
                    {Number(d.date.slice(8))}
                  </th>
                ))}
                {['P', 'A', '½', 'Paid L', 'Not cov.', 'Rest worked', '?'].map((h) => (
                  <th key={h} className="border-b border-l border-gray-200 px-2 py-2 text-right font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th
                  className="border-b border-l border-gray-200 bg-accent-soft px-2 py-2 text-right font-semibold whitespace-nowrap"
                  title="The salary sheet's Absent column: absences + half of each half day + leave not covered − rest days worked"
                >
                  Absent for payroll
                </th>
              </tr>
            </thead>
            <tbody>
              {register.employees.map((e) => (
                <tr key={e.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-1.5 group-hover:bg-gray-50">
                    <Link href={`/employees/${e.id}`} className="block max-w-44 truncate font-medium text-gray-900 hover:text-accent">
                      {e.fullName}
                    </Link>
                    <span className="block max-w-44 truncate text-[11px] text-gray-500">{e.designation}</span>
                  </td>
                  {e.days.map((d) => {
                    const k = DAY_KIND[d.kind];
                    return (
                      <td key={d.date} className="border-b border-gray-100 px-0.5 py-1 group-hover:bg-gray-50">
                        <span
                          title={`${d.date} · ${k.label}${d.leaveType ? ` · ${d.leaveType}` : ''}`}
                          className={clsx('flex h-6 w-6 items-center justify-center rounded border text-[11px] font-semibold', k.tone)}
                        >
                          {k.short}
                        </span>
                      </td>
                    );
                  })}
                  <Num value={e.summary.present} />
                  <Num value={e.summary.absent} tone={e.summary.absent ? 'text-red-700' : undefined} />
                  <Num value={e.summary.halfDays} />
                  <Num value={e.summary.paidLeave} />
                  <Num value={e.summary.unpaidLeave} tone={e.summary.unpaidLeave ? 'text-red-700' : undefined} />
                  <Num value={formatDays(e.summary.extraDays)} tone={e.summary.extraDays !== '0' ? 'text-violet-700' : undefined} />
                  <Num value={e.summary.unmarked} tone={e.summary.unmarked ? 'text-warning-800' : undefined} />
                  <td className="border-b border-l border-gray-100 bg-accent-soft px-2 py-1.5 text-right text-sm font-bold tabular-nums group-hover:bg-gray-50">
                    {formatDays(e.summary.payrollAbsentDays)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Num({ value, tone }: { value: number | string; tone?: string }) {
  return (
    <td className={clsx('border-b border-l border-gray-100 px-2 py-1.5 text-right tabular-nums group-hover:bg-gray-50', tone ?? 'text-gray-800')}>
      {value === 0 || value === '0' ? <span className="text-gray-300">0</span> : value}
    </td>
  );
}
