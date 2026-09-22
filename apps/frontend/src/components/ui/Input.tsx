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
          className="mb-1.5 block text-sm md:text-base font-normal text-gray-800"
        >
          {label} {required && <span className="text-red-500"> *</span>}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          disabled={disabled}
          type={renderedType}
          className={clsx(
            'w-full rounded-lg ps-3.5 pe-2 py-2 disabled:bg-gray-100 disabled:text-gray-400 border border-gray-200 bg-transparent text-base font-medium text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400',
            errorText && 'border-red-300 focus:border-red-400',
            isPassword && 'pr-10',
            className,
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setPasswordVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:bg-gray-200"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
          >
            {passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {errorText ? (
        <p className="mt-1 text-xs text-red-600">{errorText}</p>
      ) : helperText ? (
        <p className="mt-1 text-gray-600 text-[10px] md:text-xs">{helperText}</p>
      ) : null}
    </div>
  );
}

/** Copied 1:1 from EPCCRM's public/icons/EyeOpenedIcon.tsx. */
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.0001 13.1253C8.27419 13.1253 6.87508 11.7262 6.87508 10.0003C6.87508 8.27444 8.27419 6.87533 10.0001 6.87533C11.726 6.87533 13.1251 8.27444 13.1251 10.0003C13.1251 11.7262 11.726 13.1253 10.0001 13.1253ZM8.12508 10.0003C8.12508 11.0359 8.96455 11.8753 10.0001 11.8753C11.0356 11.8753 11.8751 11.0359 11.8751 10.0003C11.8751 8.96479 11.0356 8.12533 10.0001 8.12533C8.96455 8.12533 8.12508 8.96479 8.12508 10.0003Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.0001 3.54199C7.85795 3.54199 6.02171 4.48483 4.60034 5.59448C3.17769 6.70512 2.12613 8.01678 1.53792 8.84159L1.49357 8.90344C1.28261 9.19684 1.04175 9.53182 1.04175 10.0003C1.04175 10.4688 1.28261 10.8038 1.49357 11.0972L1.53792 11.1591C2.12614 11.9839 3.17769 13.2955 4.60034 14.4062C6.02171 15.5158 7.85795 16.4587 10.0001 16.4587C12.1422 16.4587 13.9785 15.5158 15.3998 14.4062C16.8225 13.2955 17.874 11.9839 18.4622 11.1591L18.5066 11.0972C18.7176 10.8038 18.9584 10.4688 18.9584 10.0003C18.9584 9.53182 18.7176 9.19684 18.5066 8.90344L18.4622 8.84159C17.874 8.01677 16.8225 6.70512 15.3998 5.59448C13.9785 4.48483 12.1422 3.54199 10.0001 3.54199ZM2.55564 9.56737C3.10581 8.7959 4.07706 7.58881 5.36955 6.57978C6.66331 5.56975 8.23453 4.79199 10.0001 4.79199C11.7656 4.79199 13.3369 5.56975 14.6306 6.57978C15.9231 7.58881 16.8944 8.7959 17.4445 9.56737C17.5806 9.75822 17.6454 9.85141 17.684 9.92559C17.7086 9.97275 17.7085 9.98568 17.7084 9.99833L17.7084 10.0003L17.7084 10.0023C17.7085 10.015 17.7086 10.0279 17.684 10.0751C17.6454 10.1492 17.5806 10.2424 17.4445 10.4333C16.8944 11.2048 15.9231 12.4118 14.6306 13.4209C13.3369 14.4309 11.7656 15.2087 10.0001 15.2087C8.23453 15.2087 6.66331 14.4309 5.36955 13.4209C4.07706 12.4118 3.10581 11.2048 2.55564 10.4333C2.41954 10.2424 2.35476 10.1492 2.31615 10.0751C2.2916 10.0279 2.29167 10.015 2.29174 10.0023L2.29175 10.0003L2.29174 9.99833C2.29167 9.98567 2.2916 9.97275 2.31615 9.92559C2.35476 9.85141 2.41954 9.75822 2.55564 9.56737Z"
        fill="currentColor"
      />
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
