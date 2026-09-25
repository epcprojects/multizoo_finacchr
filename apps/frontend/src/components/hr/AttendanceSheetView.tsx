'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import Button from '../ui/Button';
import { NoticeLine, Pill, type Notice } from './ui';
import {
  WEEKDAYS,
  saveAttendanceSheet,
  type AttendanceSheet,
  type AttendanceStatus,
  type LeaveTypeRecord,
  type SheetRow,
} from '../../lib/api/hr';
import { errorMessage, formatDate } from '../../lib/money';

type Draft = { status: AttendanceStatus | null; leaveTypeId: string | null; note: string };

const WORKING: { status: AttendanceStatus; label: string; tone: string }[] = [
  { status: 'PRESENT', label: 'Present', tone: 'bg-green-600 text-white border-green-600' },
  { status: 'ABSENT', label: 'Absent', tone: 'bg-red-600 text-white border-red-600' },
  { status: 'HALF_DAY', label: 'Half day', tone: 'bg-warning-500 text-white border-warning-500' },
  { status: 'LEAVE', label: 'Leave', tone: 'bg-sky-600 text-white border-sky-600' },
];
const REST: { status: AttendanceStatus; label: string; tone: string }[] = [
  { status: 'OFF', label: 'Off', tone: 'bg-gray-600 text-white border-gray-600' },
  { status: 'PRESENT', label: 'Worked', tone: 'bg-violet-600 text-white border-violet-600' },
  { status: 'HALF_DAY', label: 'Half', tone: 'bg-violet-500 text-white border-violet-500' },
];

function fromRow(r: SheetRow): Draft {
  return { status: r.record?.status ?? null, leaveTypeId: r.record?.leaveTypeId ?? null, note: r.record?.note ?? '' };
}

function same(a: Draft, b: Draft) {
  return a.status === b.status && (a.leaveTypeId ?? null) === (b.leaveTypeId ?? null) && a.note.trim() === b.note.trim();
}

/**
 * The Branch Manager's daily sheet (Fig. 14's first box). One tap per
 * person; rest days are pre-filled as off, and working one is an extra
 * day. Nothing is saved until "Save sheet", and the API checks every row
 * before writing any of them.
 */
export default function AttendanceSheetView({
  sheet,
  leaveTypes,
  onSaved,
}: {
  sheet: AttendanceSheet;
  leaveTypes: LeaveTypeRecord[];
  onSaved: (sheet: AttendanceSheet) => void;
}) {
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    setDraft(Object.fromEntries(sheet.employees.map((r) => [r.id, fromRow(r)])));
    setNotice(null);
  }, [sheet]);

  const activeLeave = leaveTypes.filter((t) => t.isActive);
  const changed = useMemo(
    () => sheet.employees.filter((r) => draft[r.id] && !same(draft[r.id], fromRow(r))),
    [sheet, draft],
  );
  const lockedByLeave = (r: SheetRow) => r.record?.source === 'LEAVE_REQUEST';
  const editable = sheet.canEdit;

  const groups = useMemo(() => {
    const by = new Map<string, SheetRow[]>();
    for (const r of sheet.employees) {
      const key = r.department ?? 'No department';
      by.set(key, [...(by.get(key) ?? []), r]);
    }
    return [...by.entries()];
  }, [sheet]);

  const unmarkedWorking = sheet.employees.filter(
    (r) => r.employed && !r.restDay && !r.payLocked && !lockedByLeave(r) && !draft[r.id]?.status,
  );

  function set(id: string, patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function markOthersPresent() {
    setDraft((d) => {
      const next = { ...d };
      for (const r of unmarkedWorking) next[r.id] = { ...next[r.id], status: 'PRESENT', leaveTypeId: null };
      return next;
    });
  }

  async function save() {
    setNotice(null);
    const missingType = changed.find((r) => draft[r.id].status === 'LEAVE' && !draft[r.id].leaveTypeId);
    if (missingType) return setNotice({ tone: 'error', text: `Choose which leave ${missingType.fullName} is on.` });
    setSaving(true);
    try {
      const saved = await saveAttendanceSheet({
        businessUnitId: sheet.unit.id,
        date: sheet.date,
        entries: changed.map((r) => {
          const d = draft[r.id];
          return {
            employeeId: r.id,
            status: d.status,
            ...(d.status === 'LEAVE' && d.leaveTypeId ? { leaveTypeId: d.leaveTypeId } : {}),
            note: d.note.trim(),
          };
        }),
      });
      onSaved(saved);
      setNotice({
        tone: 'ok',
        text: `Saved — ${saved.counts.marked} of ${saved.counts.expected} marked${saved.counts.marked === saved.counts.expected ? ', the sheet is complete' : ''}.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'The sheet was not saved.') });
    } finally {
      setSaving(false);
    }
  }

  const c = sheet.counts;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-gray-800">
          <span className="font-semibold">
            {WEEKDAYS[sheet.weekday]}, {formatDate(sheet.date)}
          </span>
          {sheet.holiday && (
            <span className="ml-2">
              <Pill tone="violet">Holiday: {sheet.holiday}</Pill>
            </span>
          )}
          <span className="ml-2 text-gray-600">
            {c.marked} of {c.expected} on duty marked · {c.present} present · {c.absent} absent · {c.halfDay} half day · {c.leave} on leave
            {c.restDayWorked > 0 && ` · ${c.restDayWorked} working a rest day`}
          </span>
        </div>
        {editable && unmarkedWorking.length > 0 && (
          <Button size="sm" variant="secondary" onClick={markOthersPresent} className="shrink-0">
            Mark {unmarkedWorking.length} unmarked as present
          </Button>
        )}
      </div>

      {sheet.lockedReason && <NoticeLine notice={{ tone: 'warn', text: sheet.lockedReason }} />}
      <NoticeLine notice={notice} onClose={() => setNotice(null)} />

      {!sheet.employees.length ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          Nobody is employed at {sheet.unit.name} on this date.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-900">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([dept, rows]) => (
                <Fragment key={dept}>
                  <tr className="border-t border-gray-100 bg-gray-50/60">
                    <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {dept}
                    </td>
                  </tr>
                  {rows.map((r) => {
                    const d = draft[r.id] ?? fromRow(r);
                    const options = r.restDay ? REST : WORKING.filter((o) => o.status !== 'LEAVE' || sheet.canMarkLeave);
                    const current = d.status ?? (r.restDay ? 'OFF' : null);
                    const dirty = !same(d, fromRow(r));
                    return (
                      <tr key={r.id} className={clsx('border-t border-gray-100 align-middle', dirty && 'bg-accent-soft/60')}>
                        <td className="px-4 py-2.5">
                          <Link href={`/employees/${r.id}`} className="font-medium text-gray-900 hover:text-accent">
                            {r.fullName}
                          </Link>
                          <p className="text-xs text-gray-500">
                            {r.designation}
                            {r.restDay && (
                              <span className="ml-1.5 text-violet-700">
                                · {r.restReason === 'HOLIDAY' ? 'holiday' : 'weekly day off'}
                              </span>
                            )}
                            {r.transferred && <span className="ml-1.5">· since moved to another unit</span>}
                            {r.payLocked && <span className="ml-1.5 text-gray-600">· month’s pay finalised — locked</span>}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          {lockedByLeave(r) ? (
                            <span className="text-sm text-sky-800">
                              On approved {r.record?.leaveTypeName?.toLowerCase() ?? 'leave'}{' '}
                              <span className="text-xs text-gray-500">(cancel the request on the Leave screen to change it)</span>
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {options.map((o) => (
                                <button
                                  key={o.status}
                                  type="button"
                                  disabled={!editable || r.payLocked}
                                  onClick={() =>
                                    set(r.id, {
                                      // Tapping the selected status again clears it; a rest day with nothing recorded is simply off.
                                      status: r.restDay
                                        ? o.status === 'OFF' && !r.record
                                          ? null
                                          : o.status
                                        : current === o.status
                                          ? null
                                          : o.status,
                                      leaveTypeId: o.status === 'LEAVE' ? d.leaveTypeId ?? activeLeave[0]?.id ?? null : null,
                                    })
                                  }
                                  className={clsx(
                                    'rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed',
                                    current === o.status ? o.tone : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100',
                                  )}
                                >
                                  {o.label}
                                </button>
                              ))}
                              {d.status === 'LEAVE' && (
                                <select
                                  value={d.leaveTypeId ?? ''}
                                  disabled={!editable || r.payLocked}
                                  onChange={(e) => set(r.id, { leaveTypeId: e.target.value || null })}
                                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                                  aria-label={`Leave type for ${r.fullName}`}
                                >
                                  {activeLeave.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {!r.restDay && !d.status && <span className="text-xs text-warning-800">not marked</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            value={d.note}
                            disabled={!editable || r.payLocked || lockedByLeave(r)}
                            maxLength={500}
                            onChange={(e) => set(r.id, { note: e.target.value })}
                            placeholder={r.record?.markedByName ? `Marked by ${r.record.markedByName}` : ''}
                            className="w-full min-w-40 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-gray-400 disabled:bg-gray-50"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur">
          <p className="text-sm text-gray-700">
            {changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!changed.length || saving} onClick={() => setDraft(Object.fromEntries(sheet.employees.map((r) => [r.id, fromRow(r)])))}>
              Discard
            </Button>
            <Button disabled={!changed.length || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save sheet'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
