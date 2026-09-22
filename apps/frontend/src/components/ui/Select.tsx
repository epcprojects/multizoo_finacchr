'use client';

import { Menu, MenuButton, MenuItems } from '@headlessui/react';
import { useState } from 'react';

export type SelectOption = { label: string; value: string };

type SelectBaseProps = {
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  required?: boolean;
  showSearch?: boolean;
};

type SelectSingleProps = SelectBaseProps & {
  isMulti?: false;
  value?: string;
  onChange: (value: string) => void;
};

type SelectMultiProps = SelectBaseProps & {
  isMulti: true;
  value: string[];
  onChange: (value: string[]) => void;
};

type SelectProps = SelectSingleProps | SelectMultiProps;

/** Same interaction shape as EPCCRM's ThemeDropDown — Headless UI Menu, single or multi. */
export default function Select(props: SelectProps) {
  const { options, label, placeholder = 'Select…', required, showSearch } = props;
  const [query, setQuery] = useState('');

  const selectedValues = props.isMulti
    ? props.value
    : props.value
      ? [props.value]
      : [];

  const selectedLabel = props.isMulti
    ? options
        .filter((o) => selectedValues.includes(o.value))
        .map((o) => o.label)
        .join(', ')
    : (options.find((o) => o.value === props.value)?.label ?? '');

  const filtered = showSearch
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  function toggle(value: string) {
    if (props.isMulti) {
      const next = selectedValues.includes(value)
        ? selectedValues.filter((v) => v !== value)
        : [...selectedValues, value];
      props.onChange(next);
    } else {
      props.onChange(value);
    }
  }

  return (
    <div className="w-full">
      {label && (
        <label className="mb-1 block text-base font-normal text-gray-800">
          {label} {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <Menu as="div" className="relative w-full">
        <MenuButton className="flex h-10.5 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 md:px-3.5 md:py-2 text-gray-900 outline-none focus:ring-0">
          <span className="truncate text-left text-sm">
            {selectedLabel || (
              <span className="text-gray-400">{placeholder}</span>
            )}
          </span>
          <ChevronDownIcon />
        </MenuButton>

        <MenuItems
          anchor="bottom start"
          className="z-50 w-[var(--button-width)] rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-[0px_14px_34px_rgba(0,0,0,0.1)] outline-none [--anchor-gap:8px]"
        >
          {showSearch && (
            <div className="sticky top-0 bg-white p-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-gray-300"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-xs md:text-sm text-gray-500">
                No results found
              </div>
            ) : (
              filtered.map((option) => {
                const isSelected = selectedValues.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(option.value)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-medium ${
                      isSelected ? 'bg-gray-100 text-gray-800' : 'text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    {props.isMulti && (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isSelected ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}
                      </span>
                    )}
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </MenuItems>
      </Menu>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="shrink-0 text-gray-500">
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckedBoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect width="16" height="16" rx="4" fill="#673DE6" />
      <path d="M4 8.2 6.8 11 12 5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UncheckedBoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="white" stroke="#D1D5DB" />
    </svg>
  );
}
