'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import PageBanner from '../../../components/ui/PageBanner';
import Input from '../../../components/ui/Input';
import { MonthPicker, NoticeLine, Section, Tabs, UnitPicker, type Notice } from '../../../components/hr/ui';
import AttendanceSheetView from '../../../components/hr/AttendanceSheetView';
import AttendanceRegisterView from '../../../components/hr/AttendanceRegisterView';
import {
  currentMonth,
  getAttendanceRegister,
  getAttendanceSheet,
  getAttendanceToday,
  listLeaveTypes,
  type AttendanceRegister,
  type AttendanceSheet,
  type LeaveTypeRecord,
  type TodayOverview,
} from '../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { errorMessage, todayIso } from '../../../lib/money';

const TABS = ['Daily sheet', 'Monthly register'] as const;
type Tab = (typeof TABS)[number];

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Attendance (architecture plan Part 07 §02, Fig. 14): each unit's daily
 * sheet, marked by its Branch Manager, and the month's register — whose
 * last column is the number the salary sheet used to have typed in by hand.
 */
export default function AttendancePage() {
  const today = todayIso();
  const [tab, setTab] = useState<Tab>('Daily sheet');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(currentMonth(today));
  const [overview, setOverview] = useState<TodayOverview | null>(null);
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [register, setRegister] = useState<AttendanceRegister | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [u, o, lt] = await Promise.all([listBusinessUnits(), getAttendanceToday(), listLeaveTypes()]);
        const withStaff = u.filter((x) => x.isActive && o.units.some((ou) => ou.id === x.id && ou.headcount > 0));
        const list = withStaff.length ? withStaff : u.filter((x) => x.isActive);
        setUnits(list);
        setOverview(o);
        setLeaveTypes(lt);
        // Start on the first unit whose sheet still needs marking.
        const firstDue = o.units.find((ou) => ou.marked < ou.expected && list.some((x) => x.id === ou.id));
        setUnitId(firstDue?.id ?? list[0]?.id ?? '');
      } catch (err) {
        setNotice({ tone: 'error', text: errorMessage(err, 'Could not load attendance.') });
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!unitId) return;
    try {
      if (tab === 'Daily sheet') setSheet(await getAttendanceSheet(unitId, date));
      else setRegister(await getAttendanceRegister(unitId, month));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the sheet.') });
    }
  }, [unitId, date, month, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshOverview = () => void getAttendanceToday().then(setOverview);
  const totals = overview?.units.reduce(
    (t, u) => ({ expected: t.expected + u.expected, marked: t.marked + u.marked, present: t.present + u.present, absent: t.absent + u.absent, leave: t.leave + u.onLeave }),
    { expected: 0, marked: 0, present: 0, absent: 0, leave: 0 },
  );

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/attendance-icon.svg"
            imageAlt="Attendance"
            title="Attendance"
            stats={[
              { title: 'Marked today', count: totals ? `${totals.marked} / ${totals.expected}` : '…', color: totals && totals.marked === totals.expected ? '#34D399' : '#F5A623' },
              { title: 'Present', count: totals?.present ?? '…', color: '#34D399' },
              { title: 'Absent', count: totals?.absent ?? '…', color: '#F87171' },
              { title: 'On leave', count: totals?.leave ?? '…', color: '#60A5FA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        {overview && overview.units.length > 1 && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {overview.units
              .filter((u) => u.headcount > 0)
              .map((u) => {
                const complete = u.marked === u.expected;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setUnitId(u.id);
                      setDate(today);
                      setTab('Daily sheet');
                    }}
                    className={clsx(
                      'rounded-xl border bg-white p-3 text-left transition hover:border-accent/40',
                      u.id === unitId ? 'border-accent ring-1 ring-accent/30' : 'border-gray-200',
                    )}
                  >
                    <p className="truncate text-sm font-semibold text-gray-900">{u.name}</p>
                    <p className={clsx('text-xs', complete ? 'text-green-700' : 'text-warning-800')}>
                      {complete ? 'Today’s sheet done' : `${u.expected - u.marked} of ${u.expected} to mark`}
                    </p>
                  </button>
                );
              })}
          </div>
        )}

        <Section>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            {units.length > 1 && (
              <div className="w-full md:w-72">
                <UnitPicker units={units} value={unitId} onChange={setUnitId} label="Unit" />
              </div>
            )}
            {tab === 'Daily sheet' ? (
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setDate(addDays(date, -1))}
                  className="h-10.5 rounded-lg border border-gray-200 bg-white px-3 text-gray-700 hover:bg-gray-100"
                  aria-label="Previous day"
                >
                  ‹
                </button>
                <Input label="Date" type="date" value={date} max={today} wrapperClassName="w-44" onChange={(e) => e.target.value && setDate(e.target.value)} />
                <button
                  type="button"
                  disabled={date >= today}
                  onClick={() => setDate(addDays(date, 1))}
                  className="h-10.5 rounded-lg border border-gray-200 bg-white px-3 text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                  aria-label="Next day"
                >
                  ›
                </button>
                {date !== today && (
                  <button type="button" onClick={() => setDate(today)} className="h-10.5 px-2 text-sm text-accent hover:underline">
                    Today
                  </button>
                )}
              </div>
            ) : (
              <MonthPicker value={month} onChange={setMonth} max={currentMonth(today)} />
            )}
          </div>

          {!unitId ? (
            <p className="py-8 text-center text-sm text-gray-500">You aren’t assigned to a business unit yet.</p>
          ) : tab === 'Daily sheet' ? (
            sheet && sheet.unit.id === unitId && sheet.date === date ? (
              <AttendanceSheetView
                sheet={sheet}
                leaveTypes={leaveTypes}
                onSaved={(s) => {
                  setSheet(s);
                  refreshOverview();
                }}
              />
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            )
          ) : register && register.unit.id === unitId && register.month === month ? (
            <AttendanceRegisterView register={register} />
          ) : (
            <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
          )}
        </Section>
      </div>
    </div>
  );
}
