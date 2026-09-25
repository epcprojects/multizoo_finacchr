'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Modal from '../ui/Modal';
import { TextArea } from './ui';
import { errorMessage } from '../../lib/money';

export type ReviewAction = {
  title: string;
  subtitle?: string;
  body?: ReactNode;
  confirmLabel: string;
  noteLabel: string;
  noteRequired?: boolean;
  /** Returns warnings to show once it's done, if any. */
  run: (note: string) => Promise<string[] | void>;
};

/** Approve / reject / cancel with an optional note — the one confirm step for leave and fines. */
export default function ReviewNoteModal({
  action,
  onClose,
  onDone,
}: {
  action: ReviewAction | null;
  onClose: () => void;
  onDone: (warnings: string[]) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote('');
    setError(null);
  }, [action]);

  async function submit() {
    if (!action) return;
    if (action.noteRequired && note.trim().length < 3) return setError('Add a short note.');
    setSaving(true);
    setError(null);
    try {
      onDone((await action.run(note.trim())) ?? []);
    } catch (err) {
      setError(errorMessage(err, 'That did not work.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(action)}
      onClose={onClose}
      title={action?.title ?? ''}
      subtitle={action?.subtitle}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Working…' : action?.confirmLabel ?? 'Confirm'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {action?.body}
        <TextArea label={action?.noteLabel ?? 'Note'} required={action?.noteRequired} value={note} onChange={setNote} rows={2} />
      </div>
    </Modal>
  );
}
