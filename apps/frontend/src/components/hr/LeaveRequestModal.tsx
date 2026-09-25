'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from './ui';
import {
  createLeaveRequest,
  formatDays,
  previewLeaveRequest,
  type EmployeeRecord,
  type LeavePreview,
  type LeaveTypeRecord,
} from '../../lib/api/hr';
import { errorMessage, formatDate, todayIso } from '../../lib/money';

type Props = {
  isOpen: boolean;
  employee?: EmployeeRecord | null;
  employees: EmployeeRecord[];
  leaveTypes: LeaveTypeRecord[];
  /** Holds leave.approve_own_unit — may approve as they enter it. */
  canApprove: boolean;
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
};

/**
 * Enter leave for someone (most staff have no login, so their Branch
 * Manager does it). The preview is the API's own check: which days count,
 * what the balance covers, and anything that blocks it.
 */
export default function LeaveRequestModal({ isOpen, employee, employees, leaveTypes, canApprove, onClose, onSaved }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [approve, setApprove] = useState(false);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = leaveTypes.filter((t) => t.isActive);

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(employee?.id ?? '');
    setLeaveTypeId(leaveTypes.find((t) => t.isActive)?.id ?? '');
    setStartDate(todayIso());
    setEndDate(todayIso());
    setReason('');
    setApprove(false);
    setPreview(null);
    setError(null);
  }, [isOpen, employee, leaveTypes]);

  useEffect(() => {
    if (!isOpen || !employeeId || !leaveTypeId || !startDate || !endDate) return setPreview(null);
    let stale = false;
    setChecking(true);
    const timer = setTimeout(() => {
      previewLeaveRequest({ employeeId, leaveTypeId, startDate, endDate })
        .then((p) => !stale && setPreview(p))
        .catch((err) => !stale && setError(errorMessage(err, 'Could not check those dates.')))
        .finally(() => !stale && setChecking(false));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [isOpen, employeeId, leaveTypeId, startDate, endDate]);

  async function submit() {
    setError(null);
    if (!employeeId || !leaveTypeId) return setError('Choose the employee and the kind of leave.');
    setSaving(true);
    try {
      const r = await createLeaveRequest({ employeeId, leaveTypeId, startDate, endDate, reason: reason.trim() || undefined, approve });
      onSaved(r.warnings);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the request.'));
    } finally {
      setSaving(false);
    }
  }

  const blocked = Boolean(preview?.errors.length);
  const b = preview?.balance;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New leave request"
      subtitle={employee ? `${employee.fullName} · ${employee.designation.name}` : 'Rest days in the range don’t count as leave.'}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : approve ? 'Approve leave' : 'Submit for approval'}
      confirmDisabled={saving || checking || blocked || !preview}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {!employee && (
          <Select
            label="Employee"
            required
            showSearch
            value={employeeId}
            onChange={setEmployeeId}
            options={employees
              .filter((e) => e.status === 'ACTIVE' || e.isLeaving)
              .map((e) => ({ label: `${e.fullName} · ${e.designation.name} (${e.businessUnit.code})`, value: e.id }))}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Leave type"
            required
            value={leaveTypeId}
            onChange={setLeaveTypeId}
            options={active.map((t) => ({ label: t.isPaid ? t.name : `${t.name} (unpaid)`, value: t.id }))}
          />
          <Input
            label="From"
            type="date"
            required
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
          />
          <Input label="To" type="date" required value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div className={clsx('rounded-xl border p-3 text-sm', blocked ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50')}>
          {!preview ? (
            <p className="text-gray-500">{checking ? 'Checking…' : 'Choose the employee, leave type and dates.'}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p>
                  <span className="text-lg font-semibold text-gray-900">{formatDays(preview.days)}</span>{' '}
                  <span className="text-gray-600">working {preview.days === '1' ? 'day' : 'days'} of leave</span>
                </p>
                {b?.isPaid && (
                  <p className="text-gray-700">
                    Balance {formatDays(b.available)} → <span className="font-semibold">{formatDays(b.after)}</span>
                    {b.uncoveredDays > 0 && <span className="text-red-700"> · {b.uncoveredDays} not covered</span>}
                  </p>
                )}
              </div>
              {preview.dates.length > 0 && preview.dates.length <= 14 && (
                <p className="text-xs text-gray-600">{preview.dates.map((d) => formatDate(d).slice(0, 6)).join(' · ')}</p>
              )}
              {preview.errors.map((e) => (
                <p key={e} className="text-red-700">
                  ✕ {e}
                </p>
              ))}
              {preview.warnings.map((w) => (
                <p key={w} className="text-warning-900">
                  ! {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <TextArea label="Reason" value={reason} onChange={setReason} rows={2} placeholder="Optional — shown to the approver." />
        {canApprove && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
            Approve it now (it goes straight onto the attendance register)
          </label>
        )}
      </div>
    </Modal>
  );
}
