'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  createAccount,
  SUBTYPE_LABELS,
  updateAccount,
  type AccountRecord,
  type AccountSubtype,
  type BusinessUnitRecord,
} from '../../lib/api/ledger';
import { errorMessage } from '../../lib/money';

const UNIT_OWNED: AccountSubtype[] = ['CASH', 'BANK', 'WALLET', 'RESERVE'];
const GROUP_ONLY: AccountSubtype[] = ['INCOME', 'EXPENSE'];
const SUBTYPE_TYPE: Record<AccountSubtype, AccountRecord['type']> = {
  CASH: 'ASSET',
  BANK: 'ASSET',
  WALLET: 'ASSET',
  RESERVE: 'ASSET',
  RECEIVABLE: 'ASSET',
  PAYABLE: 'LIABILITY',
  EQUITY: 'EQUITY',
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
};

const SUBTYPE_HINTS: Partial<Record<AccountSubtype, string>> = {
  RESERVE: 'Earmarked cash for one purpose. Only the income allocation engine moves reserves.',
  INCOME: 'Shared by every unit — each entry records which unit earned it.',
  EXPENSE: 'Shared by every unit — each entry records which unit spent it.',
};

type AccountFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (account: AccountRecord) => void;
  account?: AccountRecord | null;
  accounts: AccountRecord[];
  units: BusinessUnitRecord[];
};

export default function AccountFormModal({
  isOpen,
  onClose,
  onSaved,
  account,
  accounts,
  units,
}: AccountFormModalProps) {
  const editing = Boolean(account);
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState<AccountSubtype>('EXPENSE');
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [parentId, setParentId] = useState('');
  const [code, setCode] = useState('');
  const [isHeading, setIsHeading] = useState(false);
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(account?.name ?? '');
    setSubtype(account?.subtype ?? 'EXPENSE');
    setBusinessUnitId(account?.businessUnit?.id ?? '');
    setParentId(account?.parentId ?? '');
    setCode('');
    setIsHeading(account ? !account.isPostable : false);
    setDescription(account?.description ?? '');
    setIsActive(account?.isActive ?? true);
    setError(null);
  }, [isOpen, account]);

  const needsUnit = UNIT_OWNED.includes(subtype);
  const noUnit = GROUP_ONLY.includes(subtype);

  const headingOptions = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            !a.isPostable &&
            a.type === SUBTYPE_TYPE[subtype] &&
            (a.businessUnit?.id ?? '') === (noUnit ? '' : businessUnitId),
        )
        .map((a) => ({ label: `${a.code} · ${a.name}`, value: a.id })),
    [accounts, subtype, businessUnitId, noUnit],
  );

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Give the account a name.');
    setSubmitting(true);
    try {
      if (account) {
        onSaved(
          await updateAccount(account.id, {
            ...(account.isSystem ? {} : { name: name.trim() }),
            description: description.trim(),
            ...(isActive !== account.isActive ? { isActive } : {}),
          }),
        );
      } else {
        if (needsUnit && !businessUnitId) {
          setSubmitting(false);
          return setError('Choose the business unit this account belongs to.');
        }
        onSaved(
          await createAccount({
            name: name.trim(),
            subtype,
            businessUnitId: noUnit ? undefined : businessUnitId || undefined,
            parentId: parentId || undefined,
            code: code.trim() ? code.trim().toUpperCase() : undefined,
            isPostable: !isHeading,
            description: description.trim() || undefined,
          }),
        );
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not save the account.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit Account' : 'Add Account'}
      subtitle={editing ? `${account?.code} · ${account?.name}` : 'A new line in the chart of accounts.'}
      position={ModalPosition.RIGHT}
      showFooter
      onConfirm={submit}
      confirmLabel={submitting ? 'Saving…' : editing ? 'Save Changes' : 'Add Account'}
      confirmDisabled={submitting}
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <Input
          label="Account name"
          required
          placeholder="e.g. Reptiles"
          value={name}
          maxLength={120}
          disabled={account?.isSystem}
          helperText={account?.isSystem ? 'System account — the name is fixed.' : undefined}
          onChange={(e) => setName(e.target.value)}
        />

        {!editing && (
          <>
            <div>
              <Select
                label="Kind of account"
                required
                value={subtype}
                onChange={(v) => {
                  setSubtype(v as AccountSubtype);
                  setParentId('');
                }}
                options={(Object.keys(SUBTYPE_LABELS) as AccountSubtype[]).map((s) => ({
                  label: `${SUBTYPE_LABELS[s]} (${SUBTYPE_TYPE[s].toLowerCase()})`,
                  value: s,
                }))}
              />
              {SUBTYPE_HINTS[subtype] && <p className="mt-1 text-xs text-gray-600">{SUBTYPE_HINTS[subtype]}</p>}
            </div>

            {!noUnit && (
              <Select
                label={needsUnit ? 'Business unit' : 'Business unit (optional)'}
                required={needsUnit}
                showSearch
                placeholder={needsUnit ? 'Choose a unit' : 'Group-wide'}
                value={businessUnitId}
                onChange={(v) => {
                  setBusinessUnitId(v);
                  setParentId('');
                }}
                options={[
                  ...(needsUnit ? [] : [{ label: 'Group-wide (no unit)', value: '' }]),
                  ...units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id })),
                ]}
              />
            )}

            <Select
              label="Sits under heading (optional)"
              showSearch
              placeholder={headingOptions.length ? 'No heading' : 'No headings of this kind yet'}
              value={parentId}
              onChange={setParentId}
              options={[{ label: 'No heading', value: '' }, ...headingOptions]}
            />

            <Input
              label="Code"
              placeholder="Leave blank to number it automatically"
              value={code}
              maxLength={30}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            />

            <button
              type="button"
              onClick={() => setIsHeading((v) => !v)}
              className="flex items-start gap-2 text-left"
            >
              <span className="mt-0.5">{isHeading ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
              <span className="text-sm text-gray-800">
                This is a heading
                <span className="block text-xs text-gray-600">
                  Headings group sub-accounts (like “Animal Feed &amp; Medicine”) and can’t take entries directly.
                </span>
              </span>
            </button>
          </>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-normal text-gray-800 md:text-base">Description</label>
          <textarea
            rows={3}
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What belongs in this account (optional)"
            className="w-full rounded-lg border border-gray-200 px-3.5 py-2 text-base text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
          />
        </div>

        {editing && !account?.isSystem && (
          <button type="button" onClick={() => setIsActive((v) => !v)} className="flex items-start gap-2 text-left">
            <span className="mt-0.5">{isActive ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
            <span className="text-sm text-gray-800">
              Active
              <span className="block text-xs text-gray-600">
                An account can only be deactivated once its balance is zero.
              </span>
            </span>
          </button>
        )}
      </div>
    </Modal>
  );
}
