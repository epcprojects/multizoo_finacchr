'use client';

import { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { forgotPassword } from '../../lib/api/auth';

type ForgotPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/** Same modal as EPCCRM's Forgot Password popup — email in, reset link out. */
export default function ForgotPasswordModal({
  isOpen,
  onClose,
}: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function handleClose() {
    onClose();
    setTimeout(() => {
      setEmail('');
      setError(null);
      setSent(false);
    }, 200);
  }

  async function onContinue() {
    setError(null);
    if (!email) {
      setError('Enter your email address.');
      return;
    }
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || 'Could not send the reset link.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Forgot Password"
      size="small"
      showFooter={!sent}
      onConfirm={onContinue}
      confirmLabel={submitting ? 'Sending…' : 'Continue'}
      confirmDisabled={submitting}
      cancelLabel="Cancel"
    >
      {sent ? (
        <p className="text-sm text-ink">
          If an account exists for <span className="font-medium">{email}</span>,
          we&apos;ve sent a link to reset the password. Check your inbox.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {error && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Input
            label="Email Address"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
          />
        </div>
      )}
    </Modal>
  );
}
