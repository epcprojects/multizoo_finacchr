'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { TextArea } from '../hr/ui';
import { createSalesEvent, updateSalesEvent, type SalesEventRecord } from '../../lib/api/sales';
import { errorMessage } from '../../lib/money';

type Props = {
  isOpen: boolean;
  event: SalesEventRecord | null;
  onClose: () => void;
  onSaved: (e: SalesEventRecord) => void;
};

type Row = { year: string; startDate: string };

/**
 * A peak period compared across years — Eid-ul-Fitr, Eid-ul-Azha. The dates
 * move each year, so each year's first day is entered.
 */
export default function SalesEventModal({ isOpen, event, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [days, setDays] = useState('10');
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(event?.name ?? '');
    setDays(String(event?.days ?? 10));
    setRows(event?.occurrences.map((o) => ({ year: String(o.year), startDate: o.startDate })) ?? [{ year: String(new Date().getFullYear()), startDate: '' }]);
    setNotes(event?.notes ?? '');
    setError(null);
  }, [isOpen, event]);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Give it a name — e.g. Eid-ul-Fitr.');
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError('It runs 1 to 60 days.');
    const occurrences = rows.filter((r) => r.startDate).map((r) => ({ year: Number(r.startDate.slice(0, 4)), startDate: r.startDate }));
    setSaving(true);
    try {
      const payload = { name: name.trim(), days: n, occurrences, notes: notes.trim() || null };
      onSaved(event ? await updateSalesEvent(event.id, payload) : await createSalesEvent(payload));
    } catch (err) {
      setError(errorMessage(err, 'Could not save the event.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={event ? event.name : 'New event'}
      subtitle="A peak period compared day by day across years"
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Input label="Name" required value={name} maxLength={80} placeholder="Eid-ul-Fitr" onChange={(e) => setName(e.target.value)} />
          <Input label="Days compared" required inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-800 md:text-base">First day, each year</span>
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input
                type="date"
                wrapperClassName="flex-1"
                value={r.startDate}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { year: e.target.value.slice(0, 4), startDate: e.target.value } : x)))}
              />
              <Button variant="secondary" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { year: '', startDate: '' }])}>
              + Add a year
            </Button>
          </div>
        </div>
        <TextArea label="Notes" value={notes} rows={2} onChange={setNotes} placeholder="e.g. Pakistan dates, by moon sighting" />
      </div>
    </Modal>
  );
}
