import { AccountType } from '@multizoo/types';
import { fromPaisa, sumAmounts, toPaisa } from '@multizoo/utils';
import {
  assertBalanced,
  runningBalances,
  swapSides,
  toNormalBalance,
  UnbalancedEntryError,
} from './ledger-math';

describe('money helpers', () => {
  it('round-trips amounts through paisa without float drift', () => {
    expect(toPaisa('0.1') + toPaisa('0.2')).toBe(toPaisa('0.3'));
    expect(fromPaisa(toPaisa('12160777'))).toBe('12160777.00');
    expect(fromPaisa(toPaisa('-35.5'))).toBe('-35.50');
    expect(sumAmounts(['19732.05', '2192.45', null, '4384.90'])).toBe('26309.40');
  });

  it('rejects anything that is not a plain 2-decimal amount', () => {
    expect(() => toPaisa('1.234')).toThrow();
    expect(() => toPaisa('1e5')).toThrow();
    expect(() => toPaisa('abc')).toThrow();
  });

  it('holds seven-figure balances summed over years exactly', () => {
    // 6,000 rows of Rs 2,192.45 — the kind of column the Formula sheet fills.
    let total = 0n;
    for (let i = 0; i < 6000; i++) total += toPaisa('2192.45');
    expect(fromPaisa(total)).toBe('13154700.00');
  });
});

describe('assertBalanced', () => {
  it('accepts a balanced two-line entry and returns its total', () => {
    expect(
      assertBalanced([
        { debit: '500.00' },
        { credit: '500' },
      ]),
    ).toBe(50000n);
  });

  it('accepts a split entry (one debit, many credits)', () => {
    expect(
      assertBalanced([
        { debit: '67460' },
        { credit: '19180' },
        { credit: '48280' },
      ]),
    ).toBe(toPaisa('67460'));
  });

  it.each([
    ['a single line', [{ debit: '10' }]],
    ['unequal sides', [{ debit: '10' }, { credit: '9.99' }]],
    ['a line with both sides', [{ debit: '10', credit: '10' }, { credit: '0' }]],
    ['a line with neither side', [{ debit: '10' }, { credit: '10' }, {}]],
    ['a zero line', [{ debit: '0' }, { credit: '0' }]],
  ])('rejects %s', (_label, lines) => {
    expect(() => assertBalanced(lines)).toThrow(UnbalancedEntryError);
  });
});

describe('runningBalances — the workbook formula =I5+G6-H6', () => {
  it('reproduces the Bank Balance sheet running balance row by row', () => {
    // "Qasim Khan Having Cash in Account" block: G9=E9, then G10=G9+E10-F10.
    const rows = [
      { debit: '1453.00', credit: '0' },
      { debit: '134.00', credit: '0' },
      { debit: '2364.00', credit: '0' },
    ];
    expect(runningBalances(0n, rows, AccountType.ASSET)).toEqual([
      '1453.00',
      '1587.00',
      '3951.00',
    ]);
  });

  it('starts from an opening balance and handles withdrawals', () => {
    // Follow the Rupee: cash 140,000 → feed −12,000 → payroll −35,233.
    const rows = [
      { debit: '0', credit: '12000' },
      { debit: '0', credit: '35233' },
    ];
    expect(runningBalances(toPaisa('140000'), rows, AccountType.ASSET)).toEqual([
      '128000.00',
      '92767.00',
    ]);
  });

  it('shows credit-normal accounts (income, liabilities) as positive balances', () => {
    const rows = [{ debit: '0', credit: '100000' }, { debit: '0', credit: '2500.50' }];
    expect(runningBalances(0n, rows, AccountType.INCOME)).toEqual([
      '100000.00',
      '102500.50',
    ]);
    expect(toNormalBalance(-toPaisa('30000'), AccountType.LIABILITY)).toBe(toPaisa('30000'));
  });
});

describe('swapSides', () => {
  it('builds a reversal that exactly cancels the original', () => {
    const original = [
      { accountId: 'cash', debit: '0.00', credit: '500.00' },
      { accountId: 'maint', debit: '500.00', credit: '0.00' },
    ];
    const reversal = swapSides(original);
    expect(reversal).toEqual([
      { accountId: 'cash', debit: '500.00', credit: '0.00' },
      { accountId: 'maint', debit: '0.00', credit: '500.00' },
    ]);
    expect(assertBalanced(reversal)).toBe(assertBalanced(original));

    const net = runningBalances(0n, [...original.slice(0, 1), ...reversal.slice(0, 1)], AccountType.ASSET);
    expect(net[net.length - 1]).toBe('0.00');
  });
});
