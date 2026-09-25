'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '../ui/Button';
import { Pill, type PillTone } from './ui';
import ReviewNoteModal, { type ReviewAction } from './ReviewNoteModal';
import {
  DISCIPLINARY_STATUS_LABELS,
  reviewDisciplinary,
  type DisciplinaryRecordRow,
  type DisciplinaryStatus,
} from '../../lib/api/hr';
import { formatDate, formatMoney } from '../../lib/money';

const TONE: Record<DisciplinaryStatus, PillTone> = {
  PENDING_APPROVAL: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  WITHDRAWN: 'gray',
};

type Props = {
  rows: DisciplinaryRecordRow[];
  currentUserId: string;
  /** disciplinary.approve */
  canApprove: boolean;
  showEmployee?: boolean;
  onChanged: (message: string) => void;
};

/** The fine & warning register (architecture plan Part 08: "Disciplinary / fine register"). */
export default function DisciplinaryTable({ rows, currentUserId, canApprove, showEmployee = true, onChanged }: Props) {
  const [action, setAction] = useState<ReviewAction | null>(null);

  function open(r: DisciplinaryRecordRow, kind: 'approve' | 'reject' | 'withdraw') {
    const what = r.type === 'FINE' ? `Fine of ${formatMoney(r.amount)}` : 'Warning';
    const labels = {
      approve: { title: `Approve ${r.type === 'FINE' ? 'fine' : 'warning'}`, confirm: 'Approve', done: `${what} approved.` },
      reject: { title: `Reject ${r.type === 'FINE' ? 'fine' : 'warning'}`, confirm: 'Reject', done: `${what} rejected.` },
      withdraw: { title: 'Withdraw', confirm: 'Withdraw', done: `${what} withdrawn.` },
    }[kind];
    setAction({
      title: labels.title,
      subtitle: `${r.employee.fullName} · ${formatDate(r.incidentDate)}`,
      body: (
        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">{what}</p>
          <p>{r.reason}</p>
          <p className="mt-1 text-xs text-gray-500">Raised by {r.raisedByName ?? '—'}</p>
        </div>
      ),
      confirmLabel: labels.confirm,
      noteLabel: kind === 'reject' ? 'Why? (shown on the record)' : 'Note (optional)',
      noteRequired: kind === 'reject',
      run: async (note) => {
        await reviewDisciplinary(r.id, kind, note || undefined);
        onChanged(labels.done);
      },
    });
  }

  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">No fines or warnings.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-900">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              {showEmployee && <th className="px-4 py-2.5 font-semibold">Employee</th>}
              <th className="px-4 py-2.5 font-semibold">What happened</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fine</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pending = r.status === 'PENDING_APPROVAL';
              const own = r.employee.userId === currentUserId;
              return (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-800">{formatDate(r.incidentDate)}</td>
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
                    <p className="max-w-80 text-gray-900">{r.reason}</p>
                    <p className="text-xs text-gray-500">Raised by {r.raisedByName ?? '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {r.type === 'FINE' ? formatMoney(r.amount) : <span className="text-xs text-gray-500">Warning</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={TONE[r.status]}>{DISCIPLINARY_STATUS_LABELS[r.status]}</Pill>
                    {r.reviewedByName && (
                      <p className="mt-1 text-xs text-gray-500">
                        By {r.reviewedByName}
                        {r.reviewNote ? ` — ${r.reviewNote}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {pending && canApprove && !own && (
                        <>
                          <Button size="sm" onClick={() => open(r, 'approve')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => open(r, 'reject')}>
                            Reject
                          </Button>
                        </>
                      )}
                      {pending && (r.createdBy === currentUserId || canApprove) && (
                        <Button size="sm" variant="secondary" onClick={() => open(r, 'withdraw')}>
                          Withdraw
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
