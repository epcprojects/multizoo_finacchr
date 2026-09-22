'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
};

/** Same variant/size shape as EPCCRM's ThemeButton, Multizoo's jade brand. */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-60',
        {
          'bg-accent text-white hover:bg-accent-ink': variant === 'primary',
          'bg-surface border border-line text-ink hover:bg-surface-2':
            variant === 'secondary',
          'bg-danger text-white hover:opacity-90': variant === 'danger',
        },
        size === 'sm' && 'px-3 py-1.5 text-[13px]',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-2.5 text-[15px]',
        className,
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
