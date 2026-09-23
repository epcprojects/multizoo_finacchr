'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  ACCOUNT_TYPE_LABELS,
  createAccount,
  updateAccount,
  type AccountClassRecord,
  type AccountRecord,
  type BusinessUnitRecord,
} from '../../lib/api/ledger';
import { errorMessage } from '../../lib/money';

type AccountFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (account: AccountRecord) => void;
  account?: AccountRecord | null;
  accounts: AccountRecord[];
  classes: AccountClassRecord[];
  units: BusinessUnitRecord[];
  /** Pre-selects the unit for a new account (e.g. from the unit's edit panel). */
  defaultUnitId?: string;
};

/**
 * Add or edit one account. Everything about what the account may be —
 * its bucket, whether it needs a unit, where its code is numbered from —
 * comes from the chosen class (Accounts → Settings), not from this form.
 */
export default function AccountFormModal({
  isOpen,
  onClose,
  onSaved,
  account,
  accounts,
  classes,
  units,
  defaultUnitId,
}: AccountFormModalProps) {
  const editing = Boolean(account);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
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
    setClassId(account?.accountClass?.id ?? '');
    setBusinessUnitId(account?.businessUnit?.id ?? defaultUnitId ?? '');
    setParentId(account?.parentId ?? '');
    setCode(account?.code ?? '');
    setIsHeading(account ? !account.isPostable : false);
    setDescription(account?.description ?? '');
    setIsActive(account?.isActive ?? true);
    setError(null);
  }, [isOpen, account, defaultUnitId]);

  const cls = classes.find((c) => c.id === classId);
  const needsUnit = cls?.unitRule === 'UNIT_REQUIRED';
  const noUnit = cls?.unitRule === 'GROUP_ONLY';

  // When editing, an account can only move to a class in the same bucket.
  const classOptions = classes
    .filter((c) => c.isActive || c.id === classId)
    .filter((c) => !account || c.type === account.type)
    .map((c) => ({ label: `${c.name} — ${ACCOUNT_TYPE_LABELS[c.type]}`, value: c.id }));

  const headingOptions = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            !a.isPostable &&
            cls &&
            a.type === cls.type &&
            (a.businessUnit?.id ?? '') === (noUnit ? '' : businessUnitId),
        )
        .map((a) => ({ label: `${a.code} · ${a.name}`, value: a.id })),
    [accounts, cls, businessUnitId, noUnit],
  );

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Give the account a name.');
    if (!cls) return setError('Choose the kind of account.');
    setSubmitting(true);
    try {
      if (account) {
        onSaved(
          await updateAccount(account.id, {
            ...(account.isSystem ? {} : { name: name.trim() }),
            ...(code.trim() && code.trim() !== account.code ? { code: code.trim() } : {}),
            ...(!account.isSystem && classId !== account.accountClass?.id ? { classId } : {}),
            description: description.trim(),
            ...(isActive !== account.isActive ? { isActive } : {}),
          }),
        );
      } else {
        if (needsUnit && !businessUnitId) {
          setSubmitting(false);
          return setError(`${cls.name} accounts must belong to a business unit — choose one.`);
        }
        onSaved(
          await createAccount({
            name: name.trim(),
            classId: cls.id,
            businessUnitId: noUnit ? undefined : businessUnitId || undefined,
            parentId: parentId || undefined,
            code: code.trim() || undefined,
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

        <div>
          <Select
            label="Kind of account"
            required
            showSearch
            placeholder="Choose a class"
            value={classId}
            onChange={(v) => {
              setClassId(v);
              if (!editing) setParentId('');
            }}
            options={classOptions}
          />
          {cls && (
            <p className="mt-1 text-xs text-gray-600">
              {cls.description ? `${cls.description} ` : ''}
              {editing
                ? `Can move to another ${ACCOUNT_TYPE_LABELS[cls.type].toLowerCase()} class.`
                : `Numbered ${cls.codeStart}–${cls.codeEnd}.`}{' '}
              <span className="text-gray-500">Classes are managed in Accounts → Settings.</span>
            </p>
          )}
        </div>

        {editing ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {account?.businessUnit ? `Belongs to ${account.businessUnit.name}` : 'Group-wide'}
          </p>
        ) : (
          cls &&
          !noUnit && (
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
          )
        )}
        {!editing && noUnit && (
          <p className="-mt-2 text-xs text-gray-600">
            {cls?.name} accounts are shared by every unit — each entry records which unit it&apos;s for.
          </p>
        )}

        {!editing && cls && (
          <Select
            label="Sits under heading (optional)"
            showSearch
            placeholder={headingOptions.length ? 'No heading' : 'No headings of this kind yet'}
            value={parentId}
            onChange={setParentId}
            options={[{ label: 'No heading', value: '' }, ...headingOptions]}
          />
        )}

        <Input
          label="Code"
          placeholder="Leave blank to number it automatically"
          value={code}
          maxLength={30}
          helperText={
            editing
              ? 'Codes are labels — changing one doesn’t affect any entry or balance.'
              : 'Blank uses the numbering pattern from Accounts → Settings.'
          }
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9\-_./]/g, ''))}
        />

        {!editing && (
          <button type="button" onClick={() => setIsHeading((v) => !v)} className="flex items-start gap-2 text-left">
            <span className="mt-0.5">{isHeading ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
            <span className="text-sm text-gray-800">
              This is a heading
              <span className="block text-xs text-gray-600">
                Headings group sub-accounts (like “Animal Feed &amp; Medicine”) and can’t take entries directly.
              </span>
            </span>
          </button>
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
