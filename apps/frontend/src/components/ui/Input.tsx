'use client';

import { InputHTMLAttributes, useMemo, useState } from 'react';
import clsx from 'clsx';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'date';
  required?: boolean;
  helperText?: string;
  errorText?: string;
  wrapperClassName?: string;
};

/** Same shape as EPCCRM's ThemeInput — label, error/helper text, password toggle. */
export default function Input({
  label,
  type = 'text',
  required,
  helperText,
  errorText,
  className,
  wrapperClassName,
  disabled,
  ...props
}: InputProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === 'password';
  const renderedType = isPassword
    ? passwordVisible
      ? 'text'
      : 'password'
    : type;

  const id = useMemo(
    () => props.id ?? props.name ?? label?.toLowerCase().replace(/\s+/g, '-'),
    [props.id, props.name, label],
  );

  return (
    <div className={clsx('w-full', wrapperClassName)}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-sm font-medium text-ink-soft"
        >
          {label} {required && <span className="text-danger">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          disabled={disabled}
          type={renderedType}
          className={clsx(
            'w-full rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:bg-surface-2 disabled:text-ink-faint',
            errorText && 'border-danger focus:border-danger',
            isPassword && 'pr-10',
            className,
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setPasswordVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-faint hover:bg-surface-2"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
          >
            {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {errorText ? (
        <p className="mt-1 text-xs text-danger">{errorText}</p>
      ) : helperText ? (
        <p className="mt-1 text-xs text-ink-faint">{helperText}</p>
      ) : null}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a13.6 13.6 0 0 1-3.1 3.9M6.6 6.6C4.4 8 2 12 2 12s3.5 7 10 7c1.2 0 2.28-.22 3.24-.58"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
