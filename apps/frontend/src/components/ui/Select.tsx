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
        <label className="mb-1.5 block text-sm font-medium text-ink-soft">
          {label} {required && <span className="text-danger">*</span>}
        </label>
      )}
      <Menu as="div" className="relative w-full">
        <MenuButton className="flex h-10.5 w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none focus:border-accent">
          <span className="truncate text-left">
            {selectedLabel || (
              <span className="text-ink-faint">{placeholder}</span>
            )}
          </span>
          <ChevronDownIcon />
        </MenuButton>

        <MenuItems
          anchor="bottom start"
          className="z-50 w-[var(--button-width)] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg outline-none [--anchor-gap:6px]"
        >
          {showSearch && (
            <div className="sticky top-0 bg-surface p-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-9 w-full rounded-md border border-line bg-transparent px-2.5 text-sm text-ink outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-ink-faint">
                No results
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
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                      isSelected
                        ? 'bg-accent-soft text-accent-ink'
                        : 'text-ink hover:bg-surface-2'
                    }`}
                  >
                    {props.isMulti && (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? 'border-accent bg-accent text-white'
                            : 'border-line'
                        }`}
                      >
                        {isSelected && <CheckIcon />}
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
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink-faint">
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6.2 4.8 9 10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
