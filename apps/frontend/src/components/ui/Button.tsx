'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
};

/** Copied 1:1 from EPCCRM's ThemeButton — same variants, sizes, radius. */
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
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-300 ease-in-out disabled:cursor-not-allowed disabled:opacity-60',
        {
          'bg-accent text-white hover:bg-[#542ad4]': variant === 'primary',
          'bg-white border border-gray-200 text-black hover:bg-gray-100 drop-shadow-xs':
            variant === 'secondary',
          'bg-danger text-white hover:opacity-90': variant === 'danger',
        },
        size === 'sm' && 'py-1.75 px-3 text-[13px] gap-1',
        size === 'md' && 'py-2 px-4 text-[15px] gap-1.5',
        size === 'lg' && 'py-2.5 px-5 text-base gap-1.5',
        className,
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
