'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import RuleWaterfall from './RuleWaterfall';
import RulePreviewPanel from './RulePreviewPanel';
import {
  RULE_STATUS_LABELS,
  ruleAction,
  ruleToPayload,
  type AllocationRuleRecord,
  type RuleStatus,
} from '../../lib/api/allocation';
import { errorMessage, formatDate } from '../../lib/money';

export const STATUS_TONES: Record<RuleStatus, string> = {
  DRAFT: 'bg-gray-50 text-gray-700 border-gray-200',
  PENDING_APPROVAL: 'bg-warning-25 text-warning-800 border-warning-200',
  APPROVED: 'bg-green-50 text-green-700 border-green-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  WITHDRAWN: 'bg-gray-50 text-gray-500 border-gray-200',
  SUPERSEDED: 'bg-gray-50 text-gray-500 border-gray-200',
};

export function StatusChip({ rule }: { rule: Pick<AllocationRuleRecord, 'status' | 'isCurrent' | 'isUpcoming'> }) {
  const label = rule.isCurrent ? 'In force' : rule.isUpcoming ? 'Approved · upcoming' : RULE_STATUS_LABELS[rule.status];
  return (
    <span
      className={clsx(
        'whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        rule.isCurrent ? 'border-accent bg-accent-soft text-accent' : STATUS_TONES[rule.status],
      )}
    >
      {label}
    </span>
  );
}

export function effectiveRange(rule: Pick<AllocationRuleRecord, 'effectiveFrom' | 'effectiveTo' | 'status'>) {
  if (rule.status !== 'APPROVED') return `From ${formatDate(rule.effectiveFrom)} (once approved)`;
  return rule.effectiveTo
    ? `${formatDate(rule.effectiveFrom)} – ${formatDate(rule.effectiveTo)}`
    : `From ${formatDate(rule.effectiveFrom)}`;
}

type RuleReviewModalProps = {
  rule: AllocationRuleRecord | null;
  onClose: () => void;
  currentUserId: string;
  canApprove: boolean;
  canPropose: boolean;
  onChanged: (rule: AllocationRuleRecord) => void;
  onEditDraft?: (rule: AllocationRuleRecord) => void;
};

/**
 * One rule version, in full: who proposed it and why, the waterfall, and —
 * while it's still a proposal — what it would have done to the last month
 * of real income. This is where a Partner approves or rejects.
 */
export default function RuleReviewModal({
  rule,
  onClose,
  currentUserId,
  canApprove,
  canPropose,
  onChanged,
  onEditDraft,
}: RuleReviewModalProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setError(null);
  }, [rule?.id]);

  const payload = useMemo(() => (rule ? ruleToPayload(rule) : []), [rule]);
  if (!rule) return null;

  const isProposal = rule.status === 'DRAFT' || rule.status === 'PENDING_APPROVAL';
  const isAuthor = rule.createdBy === currentUserId;

  async function act(action: 'submit' | 'approve' | 'reject' | 'withdraw') {
    if (!rule) return;
    setBusy(action);
    setError(null);
    try {
      onChanged(await ruleAction(rule.id, action, note.trim() || undefined));
    } catch (err) {
      setError(errorMessage(err, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${rule.businessUnit?.name ?? 'Allocation rule'} — version ${rule.version}`}
      subtitle={effectiveRange(rule)}
      position={ModalPosition.RIGHT}
      size="extraLarge"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip rule={rule} />
          <span className="text-xs text-gray-600">
            {rule.createdByName ? `Drafted by ${rule.createdByName}` : 'Seeded from the workbook'}
            {rule.submittedByName && rule.submittedAt ? ` · submitted ${new Date(rule.submittedAt).toLocaleDateString('en-GB')}` : ''}
            {rule.reviewedByName && rule.reviewedAt
              ? ` · ${rule.status === 'REJECTED' ? 'rejected' : 'approved'} by ${rule.reviewedByName}`
              : ''}
          </span>
        </div>

        {rule.note && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-500">Why this version</p>
            <p className="text-sm text-gray-900">{rule.note}</p>
          </div>
        )}
        {rule.reviewNote && (
          <div
            className={clsx(
              'rounded-xl border px-3 py-2',
              rule.status === 'REJECTED' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50',
            )}
          >
            <p className="text-xs font-medium text-gray-500">Reviewer&apos;s note</p>
            <p className="text-sm text-gray-900">{rule.reviewNote}</p>
          </div>
        )}

        <RuleWaterfall tranches={rule.tranches} />

        {isProposal && (
          <section className="rounded-xl border border-gray-200 p-3">
            <p className="mb-3 text-sm font-semibold text-gray-900">What this would change</p>
            <RulePreviewPanel businessUnitId={rule.businessUnitId} tranches={payload} />
          </section>
        )}

        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {rule.status === 'PENDING_APPROVAL' && canApprove && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-25 p-3">
            <p className="text-sm text-warning-900">
              Approving makes this the rule for {rule.businessUnit?.name} from {formatDate(rule.effectiveFrom)}. Days before that
              keep the rule they were allocated under.
            </p>
            <Input
              label="Note to the proposer"
              placeholder="Optional for approval, helpful for a rejection"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" onClick={() => act('reject')} disabled={Boolean(busy)}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </Button>
              <Button onClick={() => act('approve')} disabled={Boolean(busy)}>
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </div>
        )}

        {isProposal && (canPropose || canApprove) && (
          <div className="flex flex-wrap justify-end gap-2">
            {(isAuthor || canApprove) && (
              <Button variant="secondary" onClick={() => act('withdraw')} disabled={Boolean(busy)}>
                {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
              </Button>
            )}
            {rule.status === 'DRAFT' && onEditDraft && (
              <Button variant="secondary" onClick={() => onEditDraft(rule)} disabled={Boolean(busy)}>
                Edit draft
              </Button>
            )}
            {rule.status === 'DRAFT' && (
              <Button onClick={() => act(canApprove ? 'approve' : 'submit')} disabled={Boolean(busy)}>
                {canApprove ? 'Approve & publish' : busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
