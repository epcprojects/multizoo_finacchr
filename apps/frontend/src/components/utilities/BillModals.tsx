'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import { createBill, postBill, type BillDetail, type ConnectionRecord } from '../../lib/api/utilities';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 18 Aug → 17 Sep: a month on, less a day — the billing cycles on the sheet. */
const cycleEnd = (from: string) => {
  const [y, m, d] = from.split('-').map(Number);
  return addDays(new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10), -1);
};

/** Starts a billing cycle's bill; readings follow on the bill's own page. */
export function NewBillModal({
  isOpen,
  connections,
  connectionId: preset,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  connections: ConnectionRecord[];
  connectionId?: string;
  onClose: () => void;
  onSaved: (b: BillDetail) => void;
}) {
  const [connectionId, setConnectionId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setConnectionId(preset ?? (connections.length === 1 ? connections[0].id : ''));
    setAmount('');
    setUnits('');
    setError(null);
  }, [isOpen, preset, connections]);

  const connection = connections.find((c) => c.id === connectionId);
  useEffect(() => {
    // The next cycle starts the day after the last bill ended.
    const start = connection?.lastBill ? addDays(connection.lastBill.periodTo, 1) : `${todayIso().slice(0, 8)}01`;
    setFrom(start);
    setTo(cycleEnd(start));
  }, [connection]);

  async function submit() {
    setError(null);
    if (!connection) return setError('Choose the connection.');
    if (!from || !to || to < from) return setError('Enter the billing cycle.');
    if (!isAmount(amount) || toPaisa(amount) <= 0n) return setError('Enter the bill amount.');
    if (connection.method === 'SUB_METERED' && (!units || !/^\d{1,12}(\.\d{1,2})?$/.test(units))) return setError('Enter the units on the bill.');
    setSaving(true);
    try {
      onSaved(
        await createBill({
          connectionId: connection.id,
          periodFrom: from,
          periodTo: to,
          billAmount: amount.trim(),
          ...(connection.method === 'SUB_METERED' ? { totalUnits: units.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not start the bill.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New bill" subtitle="One billing cycle" size="medium" showFooter onConfirm={submit} confirmLabel={saving ? 'Saving…' : 'Start bill'} confirmDisabled={saving}>
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Select
          label="Connection"
          required
          value={connectionId}
          onChange={setConnectionId}
          placeholder="Choose a connection"
          options={connections.filter((c) => c.isActive).map((c) => ({ label: `${c.name} · ${c.businessUnit.code}`, value: c.id }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Cycle from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Cycle to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Bill amount (Rs)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          {connection?.method !== 'SHARED' && (
            <Input
              label="Units on the bill"
              required
              inputMode="decimal"
              value={units}
              helperText="The rate per unit is the bill ÷ these."
              onChange={(e) => setUnits(e.target.value.replace(/[^\d.]/g, ''))}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Posts the allocation — and, if it hasn't been entered already, the bill's payment. */
export function PostBillModal({ bill, onClose, onSaved }: { bill: BillDetail | null; onClose: () => void; onSaved: (b: BillDetail) => void }) {
  const [record, setRecord] = useState(false);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountId, setAccountId] = useState('');
  const [reserveId, setReserveId] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unitId = bill?.connection.businessUnit.id;

  useEffect(() => {
    if (!bill || !unitId) return;
    setRecord(false);
    setPaidOn(todayIso() < bill.periodTo ? bill.periodTo : todayIso());
    setError(null);
    void listAccounts({ businessUnitId: unitId }).then((list) => {
      const own = list.filter((a) => a.isActive && a.isPostable && a.businessUnit?.id === unitId);
      setAccounts(own);
      setAccountId(own.find((a) => a.accountClass?.key === 'BANK')?.id ?? own.find((a) => a.accountClass?.isLiquid)?.id ?? '');
      setReserveId(own.find((a) => a.reserveKind === 'BUCKET' && /utilit/i.test(a.name))?.id ?? '');
    });
  }, [bill, unitId]);

  const others = bill?.allocation?.byUnit.filter((u) => !u.isPayer && toPaisa(u.charge) > 0n) ?? [];

  async function submit() {
    if (!bill) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await postBill(bill.id, record ? { paidFromAccountId: accountId, paidOn, reserveAccountId: reserveId || undefined } : {}));
    } catch (err) {
      setError(errorMessage(err, 'Could not post the bill.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={Boolean(bill)} onClose={onClose} title="Post the allocation" size="medium" showFooter onConfirm={submit} confirmLabel={saving ? 'Posting…' : 'Post'} confirmDisabled={saving}>
      {bill && (
        <div className="flex flex-col gap-4">
          {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <div className="rounded-xl border border-gray-200 p-3 text-sm">
            <p className="font-medium text-gray-900">Each unit is charged its share:</p>
            <ul className="mt-1 list-disc pl-5 text-gray-700">
              {others.map((u) => (
                <li key={u.unitKey}>
                  {u.businessUnit.name}: {formatMoney(u.charge)} — Dr its {bill.connection.expenseAccount?.name}, owed to {bill.connection.businessUnit.name}
                </li>
              ))}
              {!others.length && <li>Nothing — the whole bill is {bill.connection.businessUnit.name}&apos;s.</li>}
            </ul>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            Also record paying the {formatMoney(bill.billAmount)} bill (leave off if it’s already entered)
          </label>
          {record && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Paid from"
                required
                value={accountId}
                onChange={setAccountId}
                options={accounts.filter((a) => a.accountClass?.isLiquid).map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))}
              />
              <Input label="Paid on" type="date" required value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} />
              <Select
                label="Out of reserve"
                value={reserveId}
                onChange={setReserveId}
                options={[
                  { label: 'Not from a reserve', value: '' },
                  ...accounts.filter((a) => a.reserveKind === 'BUCKET').map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id })),
                ]}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
