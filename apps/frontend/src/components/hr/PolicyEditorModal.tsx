'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { TextArea } from './ui';
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  createPolicy,
  type EmploymentType,
  type HrPolicyRecord,
  type LeaveTypeRecord,
  type PolicyLeaveRulePayload,
} from '../../lib/api/hr';
import { errorMessage, formatDate, todayIso } from '../../lib/money';

type Row = {
  leaveTypeId: string;
  name: string;
  included: boolean;
  daysPerYear: string;
  availableAfterMonths: string;
  maxConsecutiveDays: string;
  carryForward: boolean;
  maxBalance: string;
  encashable: boolean;
  employmentTypes: EmploymentType[];
};

const DAYS = /^\d{1,3}(\.[05])?$/;

function nextJanuary() {
  return `${Number(todayIso().slice(0, 4)) + 1}-01-01`;
}

function describe(r: Row) {
  if (!r.included) return 'not given';
  return [
    `${r.daysPerYear} days a year`,
    Number(r.availableAfterMonths) ? `after ${r.availableAfterMonths} months` : null,
    r.maxConsecutiveDays ? `at most ${r.maxConsecutiveDays} at a stretch` : null,
    r.carryForward ? (r.maxBalance ? `carries forward up to ${r.maxBalance}` : 'carries forward') : 'doesn’t carry forward',
    r.encashable ? 'paid out on exit' : null,
    `for ${r.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t].toLowerCase()).join(', ')}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Publish a new version of the leave & attendance policy (Fig. 16). It
 * starts on a date — never earlier than today — and the leave year that's
 * already running keeps the entitlement it started with.
 */
export default function PolicyEditorModal({
  isOpen,
  current,
  leaveTypes,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  current: HrPolicyRecord | null;
  leaveTypes: LeaveTypeRecord[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(nextJanuary());
  const [backdate, setBackdate] = useState('7');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initial = useMemo<Row[]>(
    () =>
      leaveTypes
        .filter((t) => t.isPaid && t.isActive)
        .map((t) => {
          const r = current?.leaveRules.find((x) => x.leaveTypeId === t.id);
          return {
            leaveTypeId: t.id,
            name: t.name,
            included: Boolean(r),
            daysPerYear: r?.daysPerYear ?? '0',
            availableAfterMonths: String(r?.availableAfterMonths ?? 0),
            maxConsecutiveDays: r?.maxConsecutiveDays ? String(r.maxConsecutiveDays) : '',
            carryForward: r?.carryForward ?? false,
            maxBalance: r?.maxBalance ?? '',
            encashable: r?.encashable ?? false,
            employmentTypes: r?.employmentTypes ?? ['PERMANENT', 'CONTRACT'],
          };
        }),
    [current, leaveTypes],
  );

  useEffect(() => {
    if (!isOpen) return;
    setEffectiveFrom(nextJanuary());
    setBackdate(String(current?.attendanceBackdateDays ?? 7));
    setNote('');
    setRows(initial);
    setError(null);
  }, [isOpen, initial, current]);

  const changes = useMemo(() => {
    const out: string[] = [];
    rows.forEach((r, i) => {
      const before = describe(initial[i]);
      const after = describe(r);
      if (before !== after) out.push(`${r.name}: ${before} → ${after}`);
    });
    if (current && String(current.attendanceBackdateDays) !== backdate) {
      out.push(`Branch Managers can mark ${current.attendanceBackdateDays} → ${backdate} days back`);
    }
    return out;
  }, [rows, initial, current, backdate]);

  function set(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setError(null);
    if (effectiveFrom < todayIso()) return setError('A new version starts today at the earliest.');
    for (const r of rows.filter((x) => x.included)) {
      if (!DAYS.test(r.daysPerYear)) return setError(`${r.name}: days per year must be whole or half days.`);
      if (r.carryForward && r.maxBalance && !DAYS.test(r.maxBalance)) return setError(`${r.name}: maximum balance must be whole or half days.`);
      if (!r.employmentTypes.length) return setError(`${r.name}: choose who gets it.`);
    }
    if (!changes.length) return setError('Nothing has changed from the version in force.');
    const leaveRules: PolicyLeaveRulePayload[] = rows
      .filter((r) => r.included)
      .map((r) => ({
        leaveTypeId: r.leaveTypeId,
        daysPerYear: r.daysPerYear,
        availableAfterMonths: Number(r.availableAfterMonths) || 0,
        maxConsecutiveDays: r.maxConsecutiveDays ? Number(r.maxConsecutiveDays) : null,
        carryForward: r.carryForward,
        maxBalance: r.carryForward && r.maxBalance ? r.maxBalance : null,
        encashable: r.encashable,
        employmentTypes: r.employmentTypes,
      }));
    setSaving(true);
    try {
      const res = await createPolicy({ effectiveFrom, note: note.trim() || undefined, attendanceBackdateDays: Number(backdate) || 0, leaveRules });
      onSaved(
        `Policy v${res.version} published from ${formatDate(effectiveFrom)}${res.replaced.length ? ` — it replaces v${res.replaced.join(', v')}, which hadn’t started` : ''}.`,
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not publish the policy.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New leave & attendance policy"
      subtitle={current ? `Starting from v${current.version}, in force since ${formatDate(current.effectiveFrom)}` : ''}
      size="extraLarge"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Publishing…' : 'Publish version'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-5">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Starts on"
            type="date"
            required
            value={effectiveFrom}
            min={todayIso()}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            helperText="Entitlements change from the first leave year (1 Jan) on or after this date."
          />
          <Input
            label="Branch Managers may mark back (days)"
            type="number"
            min={0}
            max={62}
            value={backdate}
            onChange={(e) => setBackdate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.leaveTypeId} className="rounded-xl border border-gray-200 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <input type="checkbox" checked={r.included} onChange={(e) => set(i, { included: e.target.checked })} />
                {r.name}
              </label>
              {r.included && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input label="Days a year" value={r.daysPerYear} onChange={(e) => set(i, { daysPerYear: e.target.value })} />
                  <Input
                    label="Usable after (months)"
                    type="number"
                    min={0}
                    value={r.availableAfterMonths}
                    onChange={(e) => set(i, { availableAfterMonths: e.target.value })}
                  />
                  <Input
                    label="Most at a stretch"
                    type="number"
                    min={1}
                    placeholder="No limit"
                    value={r.maxConsecutiveDays}
                    onChange={(e) => set(i, { maxConsecutiveDays: e.target.value })}
                  />
                  <Input
                    label="Hold at most (carried + new)"
                    placeholder={r.carryForward ? 'No cap' : 'Doesn’t carry'}
                    disabled={!r.carryForward}
                    value={r.carryForward ? r.maxBalance : ''}
                    onChange={(e) => set(i, { maxBalance: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-800 sm:col-span-2 lg:col-span-4">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.carryForward} onChange={(e) => set(i, { carryForward: e.target.checked })} />
                      Carries forward
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.encashable} onChange={(e) => set(i, { encashable: e.target.checked })} />
                      Paid out on exit
                    </label>
                    <span className="text-gray-400">|</span>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <label key={t} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.employmentTypes.includes(t)}
                          onChange={(e) =>
                            set(i, {
                              employmentTypes: e.target.checked ? [...r.employmentTypes, t] : r.employmentTypes.filter((x) => x !== t),
                            })
                          }
                        />
                        {EMPLOYMENT_TYPE_LABELS[t]}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="mb-1 font-semibold text-gray-900">What changes</p>
          {changes.length ? (
            <ul className="list-disc space-y-1 pl-5 text-gray-700">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">Nothing yet.</p>
          )}
        </div>
        <TextArea label="Why the change" value={note} onChange={setNote} rows={2} placeholder="Shown in the version history." />
      </div>
    </Modal>
  );
}
