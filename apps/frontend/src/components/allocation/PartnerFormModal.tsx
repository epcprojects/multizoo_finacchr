'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { createPartner, updatePartner, type PartnerRecord } from '../../lib/api/allocation';
import { listUsers, type UserRecord } from '../../lib/api/users';
import { listEmployees, type EmployeeRecord } from '../../lib/api/hr';
import { errorMessage } from '../../lib/money';

type PartnerFormModalProps = {
  isOpen: boolean;
  partner: PartnerRecord | null;
  /** Holds users.invite — can see the user list to link a login. */
  canLinkUser: boolean;
  /** Can read the employee master — can link their Employee record. */
  canLinkEmployee: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/** Adds or edits a profit-sharing partner. Their share itself is set in each unit's allocation rule. */
export default function PartnerFormModal({ isOpen, partner, canLinkUser, canLinkEmployee, onClose, onSaved }: PartnerFormModalProps) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [userId, setUserId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(partner?.name ?? '');
    setShortName(partner?.shortName ?? '');
    setUserId(partner?.userId ?? '');
    setEmployeeId(partner?.employeeId ?? '');
    setNotes(partner?.notes ?? '');
    setIsActive(partner?.isActive ?? true);
    setError(null);
    if (canLinkUser) void listUsers().then(setUsers).catch(() => setUsers([]));
    if (canLinkEmployee) void listEmployees({ status: 'ACTIVE' }).then(setEmployees).catch(() => setEmployees([]));
  }, [isOpen, partner, canLinkUser, canLinkEmployee]);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Enter the partner’s name.');
    if (!shortName.trim()) return setError('Enter a short name, e.g. MIK.');
    setSaving(true);
    try {
      if (partner) {
        await updatePartner(partner.id, {
          name: name.trim(),
          shortName: shortName.trim(),
          notes,
          isActive,
          ...(canLinkUser ? { userId: userId || null } : {}),
          ...(canLinkEmployee ? { employeeId: employeeId || null } : {}),
        });
      } else {
        await createPartner({
          name: name.trim(),
          shortName: shortName.trim(),
          notes: notes.trim() || undefined,
          ...(canLinkUser && userId ? { userId } : {}),
          ...(canLinkEmployee && employeeId ? { employeeId } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the partner.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={partner ? `Edit ${partner.name}` : 'Add Partner'}
      subtitle="A partner gets a capital & current account now, and a profit reserve in each unit whose rule gives them a share."
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : partner ? 'Save' : 'Add partner'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
          <Input label="Name" required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Short name"
            required
            value={shortName}
            maxLength={20}
            helperText="As the workbooks write it, e.g. MIK"
            onChange={(e) => setShortName(e.target.value.toUpperCase())}
          />
        </div>
        {canLinkUser && (
          <Select
            label="Login (optional)"
            placeholder="Not linked"
            showSearch
            value={userId}
            onChange={setUserId}
            options={[
              { label: 'Not linked', value: '' },
              ...users.filter((u) => u.isActive).map((u) => ({ label: `${u.fullName} · ${u.email}`, value: u.id })),
            ]}
          />
        )}
        {canLinkEmployee && (
          <Select
            label="Employee record (optional)"
            placeholder="Not an employee"
            showSearch
            value={employeeId}
            onChange={setEmployeeId}
            options={[
              { label: 'Not an employee', value: '' },
              ...employees.map((e) => ({ label: `${e.fullName} · ${e.designation.name} (${e.employeeCode})`, value: e.id })),
            ]}
          />
        )}
        <Input label="Notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        {partner && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active — an inactive partner can’t be given a share in a new rule version.
          </label>
        )}
      </div>
    </Modal>
  );
}
