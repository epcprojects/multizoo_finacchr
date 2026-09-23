'use client';

import type { ReactNode } from 'react';
import Portal from './Portal';
import Button from './Button';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export enum ModalPosition {
  CENTER = 'center',
  RIGHT = 'right',
}

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  size?: 'small' | 'medium' | 'large' | 'extraLarge';
  position?: ModalPosition;
  showFooter?: boolean;
  showHeader?: boolean;
  confirmDisabled?: boolean;
  hideCancelBtn?: boolean;
  outsideClickClose?: boolean;
};

const sizeClasses = {
  small: 'sm:max-w-md',
  medium: 'sm:max-w-lg',
  large: 'sm:max-w-2xl',
  extraLarge: 'sm:max-w-4xl',
};

/** Same structure as EPCCRM's AppModal: portal, center/right position, header/body/footer. */
export default function Modal({
  isOpen,
  onClose,
  title = 'Modal',
  subtitle,
  icon,
  children,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  size = 'medium',
  position = ModalPosition.CENTER,
  showFooter = false,
  showHeader = true,
  confirmDisabled,
  hideCancelBtn,
  outsideClickClose = true,
}: ModalProps) {
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const wrapperClasses =
    position === ModalPosition.RIGHT
      ? 'fixed inset-0 z-100 flex justify-end bg-black/50 backdrop-blur-xs p-0 md:p-5'
      : 'fixed inset-0 z-100 flex min-h-dvh items-end justify-center bg-black/50 backdrop-blur-xs md:items-center';

  const rightModalWidth = size === 'extraLarge' ? 'md:w-[800px]' : 'md:w-[600px]';
  const modalClasses =
    position === ModalPosition.RIGHT
      ? `flex h-full w-full flex-col overflow-hidden bg-surface shadow-xl ${rightModalWidth} md:rounded-xl`
      : `container mx-4 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface shadow-xl md:mx-auto md:rounded-xl ${sizeClasses[size]}`;

  return (
    <Portal>
      <div
        className={wrapperClasses}
        onMouseDown={outsideClickClose ? onClose : undefined}
      >
        <div
          className={modalClasses}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {showHeader && (
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                {icon}
                <div>
                  <h2 className="text-base font-semibold text-black md:text-lg">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="text-gray-800 text-xs font-normal">{subtitle}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto bg-white p-4 md:p-5">
            {children}
          </div>

          {showFooter && (
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-white p-3 md:p-4">
              {!hideCancelBtn && (
                <Button variant="secondary" onClick={onClose}>
                  {cancelLabel}
                </Button>
              )}
              {onConfirm && (
                <Button onClick={onConfirm} disabled={confirmDisabled}>
                  {confirmLabel}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        d="M5 5l10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
