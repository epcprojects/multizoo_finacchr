'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from './ui';
import {
  BONUS_TIER_LABELS,
  BONUS_TIERS,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  WEEKDAYS,
  createEmployee,
  listDepartments,
  updateEmployee,
  type BonusTier,
  type DepartmentRecord,
  type DesignationRecord,
  type EmployeeRecord,
  type EmploymentType,
  type PayBasis,
} from '../../lib/api/hr';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import { listUsers, type UserRecord } from '../../lib/api/users';
import { errorMessage, isAmount, todayIso } from '../../lib/money';

type Props = {
  isOpen: boolean;
  employee: EmployeeRecord | null;
  units: BusinessUnitRecord[];
  designations: DesignationRecord[];
  /** Holds users.invite — can link a login. */
  canLinkUser: boolean;
  onClose: () => void;
  onSaved: (employee: EmployeeRecord) => void;
};

const CNIC = /^\d{5}-\d{7}-\d$/;

/** Formats digits as the CNIC is written: 12345-1234567-1. */
function formatCnic(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/**
 * Add or edit an employee. Pay is set here only when they join — a raise
 * later is a dated salary revision, so last month's payroll never changes.
 */
export default function EmployeeFormPanel({ isOpen, employee, units, designations, canLinkUser, onClose, onSaved }: Props) {
  const [fullName, setFullName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [cnic, setCnic] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [unitId, setUnitId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [bonusTier, setBonusTier] = useState<BonusTier | ''>('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('PERMANENT');
  const [joinDate, setJoinDate] = useState(todayIso());
  const [weeklyOff, setWeeklyOff] = useState('');
  const [salary, setSalary] = useState('');
  const [payBasis, setPayBasis] = useState<PayBasis>('MONTHLY');
  const [userId, setUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const e = employee;
    setFullName(e?.fullName ?? '');
    setFatherName(e?.fatherName ?? '');
    setCnic(e?.cnic ?? '');
    setPhone(e?.phone ?? '');
    setAddress(e?.address ?? '');
    setUnitId(e?.businessUnit.id ?? (units.length === 1 ? units[0].id : ''));
    setDepartmentId(e?.department?.id ?? '');
    setDesignationId(e?.designation.id ?? '');
    setBonusTier(e?.bonusTier ?? '');
    setEmploymentType(e?.employmentType ?? 'PERMANENT');
    setJoinDate(e?.joinDate ?? todayIso());
    setWeeklyOff(e?.weeklyOffDay != null ? String(e.weeklyOffDay) : '');
    setSalary('');
    setPayBasis('MONTHLY');
    setUserId(e?.userId ?? '');
    setNotes(e?.notes ?? '');
    setError(null);
    if (canLinkUser) void listUsers().then(setUsers).catch(() => setUsers([]));
  }, [isOpen, employee, units, canLinkUser]);

  useEffect(() => {
    if (!isOpen || !unitId) return setDepartments([]);
    void listDepartments(unitId).then(setDepartments).catch(() => setDepartments([]));
  }, [isOpen, unitId]);

  const designation = designations.find((d) => d.id === designationId);
  const activeDesignations = useMemo(
    () => designations.filter((d) => d.isActive || d.id === employee?.designation.id),
    [designations, employee],
  );

  async function submit() {
    setError(null);
    if (fullName.trim().length < 2) return setError('Enter their full name.');
    if (!unitId) return setError('Choose the business unit they work for.');
    if (!designationId) return setError('Choose a designation.');
    if (cnic && !CNIC.test(cnic)) return setError('CNIC must be 13 digits, written 12345-1234567-1.');
    if (!employee && (!isAmount(salary) || salary.startsWith('-'))) return setError('Enter the starting salary.');

    const common = {
      fullName: fullName.trim(),
      fatherName: fatherName.trim(),
      cnic: cnic || null,
      phone: phone.trim(),
      address: address.trim(),
      businessUnitId: unitId,
      departmentId: departmentId || null,
      designationId,
      bonusTier: bonusTier || null,
      employmentType,
      joinDate,
      weeklyOffDay: weeklyOff === '' ? null : Number(weeklyOff),
      notes: notes.trim(),
      ...(canLinkUser ? { userId: userId || null } : {}),
    };
    setSaving(true);
    try {
      const saved = employee
        ? await updateEmployee(employee.id, common)
        : await createEmployee({ ...common, baseSalary: salary.trim(), payBasis });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the employee.'));
    } finally {
      setSaving(false);
    }
  }

  const transferring = employee && unitId !== employee.businessUnit.id;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      position={ModalPosition.RIGHT}
      title={employee ? `Edit ${employee.fullName}` : 'Add employee'}
      subtitle={employee ? `${employee.employeeCode} · joined ${employee.joinDate}` : 'An HR record — they don’t need a login.'}
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-5">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Person</legend>
          <Input label="Full name" required value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Father’s name" value={fatherName} maxLength={120} onChange={(e) => setFatherName(e.target.value)} />
            <Input
              label="CNIC"
              value={cnic}
              placeholder="12345-1234567-1"
              inputMode="numeric"
              onChange={(e) => setCnic(formatCnic(e.target.value))}
            />
            <Input label="Phone" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Input label="Address" value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Job</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Business unit"
              required
              value={unitId}
              onChange={(v) => {
                setUnitId(v);
                setDepartmentId('');
              }}
              options={units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }))}
            />
            <Select
              label="Department"
              placeholder={unitId ? 'None' : 'Choose a unit first'}
              value={departmentId}
              onChange={setDepartmentId}
              options={[
                { label: 'None', value: '' },
                ...departments.filter((d) => d.isActive).map((d) => ({ label: d.name, value: d.id })),
              ]}
            />
            <Select
              label="Designation"
              required
              showSearch
              value={designationId}
              onChange={setDesignationId}
              options={activeDesignations.map((d) => ({ label: d.name, value: d.id }))}
            />
            <Select
              label="Bonus tier"
              value={bonusTier}
              onChange={(v) => setBonusTier(v as BonusTier | '')}
              options={[
                { label: designation ? `As the designation (${BONUS_TIER_LABELS[designation.bonusTier]})` : 'As the designation', value: '' },
                ...BONUS_TIERS.map((t) => ({ label: BONUS_TIER_LABELS[t], value: t })),
              ]}
            />
            <Select
              label="Employment type"
              required
              value={employmentType}
              onChange={(v) => setEmploymentType(v as EmploymentType)}
              options={EMPLOYMENT_TYPES.map((t) => ({ label: EMPLOYMENT_TYPE_LABELS[t], value: t }))}
            />
            <Input
              label="Join date"
              type="date"
              required
              value={joinDate}
              onChange={(e) => setJoinDate(e.target.value)}
              helperText={employee ? 'Only correctable while nothing is recorded before the new date.' : undefined}
            />
            <Select
              label="Weekly day off"
              value={weeklyOff}
              onChange={setWeeklyOff}
              options={[{ label: 'No fixed day off', value: '' }, ...WEEKDAYS.map((d, i) => ({ label: d, value: String(i) }))]}
            />
          </div>
          {transferring && (
            <p className="rounded-md border border-warning-200 bg-warning-25 px-3 py-2 text-xs text-warning-900">
              Moving them to another unit: days already marked stay with {employee?.businessUnit.name}; from now on they appear on the
              new unit’s sheet.
            </p>
          )}
          {!employee && (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <Input
                label="Starting salary (Rs)"
                required
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value.replace(/[^\d.]/g, ''))}
                helperText="From the join date. Raises are recorded later as dated revisions."
              />
              <Select
                label="Paid"
                value={payBasis}
                onChange={(v) => setPayBasis(v as PayBasis)}
                options={[
                  { label: 'Per month', value: 'MONTHLY' },
                  { label: 'Per day', value: 'DAILY' },
                ]}
              />
            </div>
          )}
        </fieldset>

        {canLinkUser && (
          <Select
            label="Login (optional)"
            placeholder="No login"
            showSearch
            value={userId}
            onChange={setUserId}
            options={[
              { label: 'No login — most staff don’t need one', value: '' },
              ...users.filter((u) => u.isActive).map((u) => ({ label: `${u.fullName} · ${u.email}`, value: u.id })),
            ]}
          />
        )}
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} />
      </div>
    </Modal>
  );
}
