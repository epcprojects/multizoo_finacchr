'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from '../hr/ui';
import { listEmployees, type EmployeeRecord } from '../../lib/api/hr';
import { createCounterparty, updateCounterparty, type CounterpartyKind, type CounterpartyRecord } from '../../lib/api/loans';
import { errorMessage } from '../../lib/money';

const KINDS: { value: CounterpartyKind; label: string; hint: string }[] = [
  { value: 'PERSON', label: 'A person', hint: 'An officer holding a cash float, a relative, anyone outside the payroll.' },
  { value: 'EMPLOYEE', label: 'An employee', hint: 'Their loans sit beside their salary advances.' },
  { value: 'ORGANISATION', label: 'A company', hint: 'A supplier, a landlord, a business owed or owing money.' },
];

/** Someone money moves to and from. Partners and units are already here. */
export default function CounterpartyModal({
  isOpen,
  counterparty,
  existing,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  counterparty: CounterpartyRecord | null;
  existing: CounterpartyRecord[];
  onClose: () => void;
  onSaved: (c: CounterpartyRecord) => void;
}) {
  const [kind, setKind] = useState<CounterpartyKind>('PERSON');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setKind(counterparty?.kind ?? 'PERSON');
    setName(counterparty?.name ?? '');
    setEmployeeId('');
    setPhone(counterparty?.phone ?? '');
    setNotes(counterparty?.notes ?? '');
    setActive(counterparty?.isActive ?? true);
    setError(null);
    if (!counterparty) void listEmployees({}).then(setEmployees).catch(() => setEmployees([]));
  }, [isOpen, counterparty]);

  const nameEditable = !counterparty || counterparty.kind === 'PERSON' || counterparty.kind === 'ORGANISATION';
  const taken = new Set(existing.map((c) => c.employee?.id).filter(Boolean));

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      if (counterparty) {
        onSaved(
          await updateCounterparty(counterparty.id, {
            ...(nameEditable ? { name: name.trim() } : {}),
            phone: phone.trim() || null,
            notes: notes.trim() || null,
            isActive: active,
          }),
        );
      } else {
        if (kind === 'EMPLOYEE' && !employeeId) throw new Error('Choose the employee.');
        if (kind !== 'EMPLOYEE' && name.trim().length < 2) throw new Error('Enter their name.');
        onSaved(
          await createCounterparty({
            kind,
            ...(kind === 'EMPLOYEE' ? { employeeId } : { name: name.trim() }),
            phone: phone.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error && !('response' in err) ? err.message : errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={counterparty ? counterparty.name : 'New counterparty'}
      subtitle="Someone the group lends to, borrows from, or holds money for"
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {!counterparty && (
          <div className="flex flex-col gap-2">
            {KINDS.map((k) => (
              <label key={k.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${kind === k.value ? 'border-accent bg-accent-soft/40' : 'border-gray-200'}`}>
                <input type="radio" name="kind" className="mt-1" checked={kind === k.value} onChange={() => setKind(k.value)} />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{k.label}</span>
                  <span className="block text-xs text-gray-600">{k.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {!counterparty && kind === 'EMPLOYEE' ? (
          <Select
            label="Employee"
            required
            showSearch
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="Choose someone"
            options={employees
              .filter((e) => !taken.has(e.id))
              .map((e) => ({ label: `${e.fullName} · ${e.businessUnit.code} · ${e.designation.name}`, value: e.id }))}
          />
        ) : (
          <Input
            label="Name"
            required
            value={name}
            maxLength={120}
            disabled={!nameEditable}
            helperText={nameEditable ? undefined : 'Comes from their own record.'}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <Input label="Phone" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
        <TextArea label="Notes" rows={2} value={notes} onChange={setNotes} />
        {counterparty && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active — can be chosen for new loans
          </label>
        )}
      </div>
    </Modal>
  );
}
