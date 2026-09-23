'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  createAccountClass,
  UNIT_RULE_LABELS,
  updateAccountClass,
  type AccountClassRecord,
  type AccountType,
  type UnitRule,
} from '../../lib/api/ledger';
import { errorMessage } from '../../lib/money';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  accountClass?: AccountClassRecord | null;
};

function Toggle({
  on,
  onChange,
  label,
  hint,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex items-start gap-2 text-left disabled:opacity-50"
    >
      <span className="mt-0.5">{on ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
      <span className="text-sm text-gray-800">
        {label}
        <span className="block text-xs text-gray-600">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Add or edit an account class. The server enforces the rules that keep
 * the ledger coherent (see classRuleViolation); the form nudges towards
 * valid combinations so those errors are rare.
 */
export default function AccountClassFormModal({ isOpen, onClose, onSaved, accountClass }: Props) {
  const editing = Boolean(accountClass);
  const bucketLocked = Boolean(accountClass && (accountClass.isSystem || accountClass.accountCount > 0));

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('ASSET');
  const [unitRule, setUnitRule] = useState<UnitRule>('EITHER');
  const [codeStart, setCodeStart] = useState('');
  const [codeEnd, setCodeEnd] = useState('');
  const [isLiquid, setIsLiquid] = useState(false);
  const [isReserve, setIsReserve] = useState(false);
  const [isReconcilable, setIsReconcilable] = useState(false);
  const [provision, setProvision] = useState(false);
  const [defaultAccountName, setDefaultAccountName] = useState('');
  const [sortOrder, setSortOrder] = useState('100');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const c = accountClass;
    setName(c?.name ?? '');
    setType(c?.type ?? 'ASSET');
    setUnitRule(c?.unitRule ?? 'EITHER');
    setCodeStart(c ? String(c.codeStart) : '');
    setCodeEnd(c ? String(c.codeEnd) : '');
    setIsLiquid(c?.isLiquid ?? false);
    setIsReserve(c?.isReserve ?? false);
    setIsReconcilable(c?.isReconcilable ?? false);
    setProvision(c?.provisionForNewUnits ?? false);
    setDefaultAccountName(c?.defaultAccountName ?? '');
    setSortOrder(String(c?.sortOrder ?? 100));
    setDescription(c?.description ?? '');
    setIsActive(c?.isActive ?? true);
    setError(null);
  }, [isOpen, accountClass]);

  // Money on hand and reserves only make sense as unit-owned assets.
  const assetOnly = type === 'ASSET';
  function setLiquid(v: boolean) {
    setIsLiquid(v);
    if (v) {
      setIsReserve(false);
      setUnitRule('UNIT_REQUIRED');
    }
  }
  function setReserve(v: boolean) {
    setIsReserve(v);
    if (v) {
      setIsLiquid(false);
      setProvision(false);
      setUnitRule('UNIT_REQUIRED');
    }
  }

  async function submit() {
    setError(null);
    const start = Number(codeStart);
    const end = Number(codeEnd);
    if (name.trim().length < 2) return setError('Give the class a name.');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      return setError('The code range must be two whole numbers, e.g. 1700 to 1799.');
    }
    if (start > end) return setError('The code range must start before it ends.');

    const payload = {
      name: name.trim(),
      type,
      unitRule,
      codeStart: start,
      codeEnd: end,
      isLiquid,
      isReserve,
      isReconcilable,
      provisionForNewUnits: provision,
      defaultAccountName: provision ? defaultAccountName.trim() : '',
      sortOrder: Number(sortOrder) || 0,
      description: description.trim(),
    };

    setSubmitting(true);
    try {
      if (accountClass) {
        await updateAccountClass(accountClass.id, {
          ...payload,
          ...(bucketLocked ? { type: undefined } : {}),
          ...(isActive !== accountClass.isActive ? { isActive } : {}),
        });
      } else {
        await createAccountClass(payload);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the class.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit Account Class' : 'Add Account Class'}
      subtitle={
        editing
          ? `${accountClass?.name} · used by ${accountClass?.accountCount} account(s)`
          : 'A kind of account and the rules its accounts follow.'
      }
      position={ModalPosition.RIGHT}
      showFooter
      onConfirm={submit}
      confirmLabel={submitting ? 'Saving…' : editing ? 'Save Changes' : 'Add Class'}
      confirmDisabled={submitting}
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <Input label="Class name" required placeholder="e.g. Fixed Asset" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />

        <div>
          <Select
            label="Bucket"
            required
            value={type}
            onChange={(v) => {
              setType(v as AccountType);
              if (v !== 'ASSET') {
                setIsLiquid(false);
                setIsReserve(false);
              }
            }}
            options={ACCOUNT_TYPES.map((t) => ({ label: ACCOUNT_TYPE_LABELS[t], value: t }))}
          />
          {bucketLocked && (
            <p className="mt-1 text-xs text-gray-600">
              {accountClass?.isSystem
                ? 'Built-in class — its bucket is fixed.'
                : 'Accounts already use this class, so its bucket is fixed.'}
            </p>
          )}
        </div>

        <Select
          label="Business unit"
          required
          value={unitRule}
          onChange={(v) => setUnitRule(v as UnitRule)}
          options={(Object.keys(UNIT_RULE_LABELS) as UnitRule[]).map((r) => ({ label: UNIT_RULE_LABELS[r], value: r }))}
        />

        <div>
          <p className="mb-1.5 text-sm text-gray-800 md:text-base">
            Code range <span className="text-red-500">*</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input aria-label="From" inputMode="numeric" placeholder="From, e.g. 1700" value={codeStart} onChange={(e) => setCodeStart(e.target.value.replace(/\D/g, ''))} />
            <Input aria-label="To" inputMode="numeric" placeholder="To, e.g. 1799" value={codeEnd} onChange={(e) => setCodeEnd(e.target.value.replace(/\D/g, ''))} />
          </div>
          <p className="mt-1 text-xs text-gray-600">
            New accounts in this class are numbered inside this range, using the pattern and step above.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
          <p className="text-sm font-semibold text-gray-900">How accounts of this class behave</p>
          <Toggle
            on={isLiquid}
            onChange={setLiquid}
            disabled={!assetOnly}
            label="Money on hand"
            hint="Appears on the cash-position dashboard and can be used for money in, money out and transfers. Assets owned by a unit only."
          />
          <Toggle
            on={isReserve}
            onChange={setReserve}
            disabled={!assetOnly}
            label="Reserve"
            hint="Earmarked cash — only the income allocation engine may post to it. Assets owned by a unit only."
          />
          <Toggle
            on={isReconcilable}
            onChange={setIsReconcilable}
            disabled={type !== 'ASSET' && type !== 'LIABILITY'}
            label="Can be reconciled"
            hint="Allows recording a physical count or statement balance against the books."
          />
          <Toggle
            on={provision}
            onChange={setProvision}
            disabled={isReserve || unitRule === 'GROUP_ONLY'}
            label="Create for every new business unit"
            hint="The Add Business Unit wizard pre-ticks one account of this class."
          />
          {provision && (
            <Input
              label="Account name for new units"
              placeholder={`e.g. ${name || 'Petty Cash'}`}
              value={defaultAccountName}
              maxLength={120}
              onChange={(e) => setDefaultAccountName(e.target.value)}
            />
          )}
        </div>

        <Input
          label="Display order"
          inputMode="numeric"
          value={sortOrder}
          helperText="Lower numbers appear first — also the column order on the cash-position dashboard."
          onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, ''))}
        />

        <div>
          <label className="mb-1.5 block text-sm font-normal text-gray-800 md:text-base">Description</label>
          <textarea
            rows={2}
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown when someone picks this class for a new account"
            className="w-full rounded-lg border border-gray-200 px-3.5 py-2 text-base text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
          />
        </div>

        {editing && (
          <Toggle
            on={isActive}
            onChange={setIsActive}
            label="Active"
            hint="Inactive classes can't be chosen for new accounts. Only possible once no active account uses it."
          />
        )}
      </div>
    </Modal>
  );
}
