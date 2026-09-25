'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '../ui/Button';
import { Pill, type PillTone } from './ui';
import ReviewNoteModal, { type ReviewAction } from './ReviewNoteModal';
import {
  LEAVE_STATUS_LABELS,
  formatDays,
  reviewLeaveRequest,
  type LeaveRequestRecord,
  type LeaveRequestStatus,
} from '../../lib/api/hr';
import { formatDate } from '../../lib/money';

const TONE: Record<LeaveRequestStatus, PillTone> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

type Props = {
  rows: LeaveRequestRecord[];
  currentUserId: string;
  /** leave.approve_own_unit */
  canApprove: boolean;
  /** employee.manage — may also call off approved leave. */
  canManage: boolean;
  showEmployee?: boolean;
  emptyText?: string;
  onChanged: (warnings: string[], message: string) => void;
};

function range(r: LeaveRequestRecord) {
  return r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`;
}

export default function LeaveRequestsTable({ rows, currentUserId, canApprove, canManage, showEmployee = true, emptyText, onChanged }: Props) {
  const [action, setAction] = useState<ReviewAction | null>(null);

  function open(r: LeaveRequestRecord, kind: 'approve' | 'reject' | 'cancel') {
    const who = `${r.employee.fullName} — ${r.leaveType.name.toLowerCase()}, ${range(r)} (${formatDays(r.days)} ${r.days === '1' ? 'day' : 'days'})`;
    const labels = {
      approve: { title: 'Approve leave', confirm: 'Approve', note: 'Note (optional)', done: 'Leave approved — it’s on the attendance register.' },
      reject: { title: 'Reject leave', confirm: 'Reject', note: 'Why? (shown on the request)', done: 'Request rejected.' },
      cancel: {
        title: r.status === 'APPROVED' ? 'Cancel approved leave' : 'Withdraw request',
        confirm: r.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw',
        note: 'Reason',
        done: r.status === 'APPROVED' ? 'Leave cancelled — its days are off the register.' : 'Request withdrawn.',
      },
    }[kind];
    setAction({
      title: labels.title,
      subtitle: who,
      body: r.reason ? <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">“{r.reason}”</p> : undefined,
      confirmLabel: labels.confirm,
      noteLabel: labels.note,
      noteRequired: kind === 'reject',
      run: async (note) => {
        const res = await reviewLeaveRequest(r.id, kind, note || undefined);
        onChanged(res.warnings, labels.done);
        return res.warnings;
      },
    });
  }

  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{emptyText ?? 'No leave requests.'}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-900">
            <tr>
              {showEmployee && <th className="px-4 py-2.5 font-semibold">Employee</th>}
              <th className="px-4 py-2.5 font-semibold">Leave</th>
              <th className="px-4 py-2.5 font-semibold">Dates</th>
              <th className="px-4 py-2.5 text-right font-semibold">Days</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const own = r.employee.userId === currentUserId;
              const canCancel =
                (r.status === 'PENDING' && (r.createdBy === currentUserId || canApprove || canManage)) ||
                (r.status === 'APPROVED' && (canApprove || canManage));
              return (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  {showEmployee && (
                    <td className="px-4 py-3">
                      <Link href={`/employees/${r.employee.id}`} className="font-medium text-gray-900 hover:text-accent">
                        {r.employee.fullName}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {r.employee.designation} · {r.businessUnit.code}
                      </p>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{r.leaveType.name}</p>
                    {r.reason && <p className="max-w-64 truncate text-xs text-gray-500" title={r.reason}>{r.reason}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-800">{range(r)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDays(r.days)}</td>
                  <td className="px-4 py-3">
                    <Pill tone={TONE[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</Pill>
                    <p className="mt-1 text-xs text-gray-500">
                      {r.status === 'PENDING'
                        ? `Entered by ${r.requestedByName ?? '—'}`
                        : r.status === 'CANCELLED'
                          ? `By ${r.cancelledByName ?? '—'}${r.cancelReason ? ` — ${r.cancelReason}` : ''}`
                          : `By ${r.reviewedByName ?? '—'}${r.reviewNote ? ` — ${r.reviewNote}` : ''}`}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {r.status === 'PENDING' && canApprove && !own && (
                        <>
                          <Button size="sm" onClick={() => open(r, 'approve')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => open(r, 'reject')}>
                            Reject
                          </Button>
                        </>
                      )}
                      {canCancel && (
                        <Button size="sm" variant="secondary" onClick={() => open(r, 'cancel')}>
                          {r.status === 'APPROVED' ? 'Cancel' : 'Withdraw'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReviewNoteModal action={action} onClose={() => setAction(null)} onDone={() => setAction(null)} />
    </>
  );
}
