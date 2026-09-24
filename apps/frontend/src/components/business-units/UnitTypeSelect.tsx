'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  createBusinessUnitType,
  listBusinessUnitTypes,
  type BusinessUnitTypeRecord,
} from '../../lib/api/ledger';
import { errorMessage } from '../../lib/money';

const ADD_NEW = '__add_new_type__';

type UnitTypeSelectProps = {
  value: string;
  onChange: (typeId: string, type: BusinessUnitTypeRecord | undefined) => void;
  /** Shows "+ Add new type" — callers pass business_units.manage. */
  canAdd: boolean;
  /** Fired once the list loads, so a form can pick a default. */
  onLoaded?: (types: BusinessUnitTypeRecord[]) => void;
};

/**
 * "Type of business" dropdown backed by the configurable type list. The last
 * option, "+ Add new type", opens a small popup; the saved type is added to
 * the list and selected straight away.
 */
export default function UnitTypeSelect({ value, onChange, canAdd, onLoaded }: UnitTypeSelectProps) {
  const [types, setTypes] = useState<BusinessUnitTypeRecord[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isHolding, setIsHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    const list = await listBusinessUnitTypes();
    setTypes(list);
    onLoadedRef.current?.(list);
    return list;
  }, []);

  useEffect(() => {
    void load().catch(() => setTypes([]));
  }, [load]);

  // A unit whose type was since deactivated still shows its current type.
  const options = types.map((t) => ({ label: t.name, value: t.id }));
  if (canAdd) options.push({ label: '+ Add new type', value: ADD_NEW });

  function openAdd() {
    setName('');
    setDescription('');
    setIsHolding(false);
    setError(null);
    setAddOpen(true);
  }

  async function save() {
    setError(null);
    if (name.trim().length < 2) return setError('Give the type a name.');
    setSaving(true);
    try {
      const created = await createBusinessUnitType({
        name: name.trim(),
        description: description.trim() || undefined,
        isHolding,
      });
      const list = await load();
      onChange(created.id, list.find((t) => t.id === created.id) ?? created);
      setAddOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not add the type.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Select
        label="Type of business"
        required
        showSearch
        placeholder="Choose a type"
        value={value}
        onChange={(v) => {
          if (v === ADD_NEW) openAdd();
          else onChange(v, types.find((t) => t.id === v));
        }}
        options={options}
      />

      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Type of Business"
        subtitle="It will be added to the list and selected for this unit."
        size="small"
        showFooter
        onConfirm={save}
        confirmLabel={saving ? 'Saving…' : 'Save Type'}
        confirmDisabled={saving}
      >
        <div className="flex flex-col gap-4">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <Input label="Type name" required placeholder="e.g. Amusement park" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <Input label="Description" placeholder="Optional" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
          <button type="button" onClick={() => setIsHolding((v) => !v)} className="flex items-start gap-2 text-left">
            <span className="mt-0.5">{isHolding ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
            <span className="text-sm text-gray-800">
              Holding / non-trading
              <span className="block text-xs text-gray-600">
                No daily income to allocate — new units of this type start with a bank account and no reserves.
              </span>
            </span>
          </button>
        </div>
      </Modal>
    </>
  );
}
