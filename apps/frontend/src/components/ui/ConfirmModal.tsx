'use client';

import type { ReactNode } from 'react';
import Portal from './Portal';
import Button from './Button';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  variant?: 'danger' | 'primary';
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

/** Same shape as EPCCRM's ConfirmActionModal — icon circle, danger/primary variant. */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isSubmitting = false,
  variant = 'primary',
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  useBodyScrollLock(isOpen);
  if (!isOpen) return null;
  const isDanger = variant === 'danger';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-100 flex min-h-dvh items-end justify-center bg-black/50 backdrop-blur-xs md:items-center"
        onMouseDown={isSubmitting ? undefined : onClose}
      >
        <div
          className="container mx-4 w-full max-w-md rounded-t-xl bg-surface p-5 shadow-xl md:mx-auto md:rounded-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: isDanger
                  ? 'var(--error-100)'
                  : 'var(--accent-soft)',
                color: isDanger ? 'var(--danger)' : 'var(--accent)',
              }}
            >
              <WarnIcon />
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 disabled:opacity-50"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="mt-3">
            <h2 className="text-xl font-bold text-ink">{title}</h2>
            <div className="mt-2 text-sm leading-6 text-ink-soft">
              {message}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={isDanger ? 'danger' : 'primary'}
              className="w-full"
              onClick={() => void onConfirm()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Please wait…' : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function WarnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 8v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M10.29 3.86 2.82 16.34C1.98 17.74 2.99 19.5 4.62 19.5h14.76c1.63 0 2.64-1.76 1.8-3.16L13.71 3.86c-.81-1.35-2.61-1.35-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
