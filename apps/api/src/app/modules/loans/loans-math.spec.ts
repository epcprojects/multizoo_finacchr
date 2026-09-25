import { LoanMovementEffect } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { headroom, increaseNeedsApproval, loanRunningBalances, LoanMovementRow, summarizeLoan } from './loans-math';

const up = (amount: string): LoanMovementRow => ({ effect: LoanMovementEffect.INCREASE, amount });
const down = (amount: string): LoanMovementRow => ({ effect: LoanMovementEffect.DECREASE, amount });

describe('Loan Dir to Mik — principal − Σ repayments (H2 = A$2 − SUM(E$2:E2))', () => {
  // A4:A8, the "Break down of amount taken": 3,000,000 + 450,000 + 2,200,000 + 2,000,000 + 1,000,000.
  const drawdowns = ['3000000', '450000', '2200000', '2000000', '1000000'].map(up);
  // E2:E9, each "Rifaqat cash taken from Mik Profit" or given back.
  const repayments = ['1000000', '2050000', '1000000', '1600000', '300000', '800000', '500000', '900000'].map(down);

  it('the breakdown adds up to the total taken (A2 = 8,650,000)', () => {
    expect(summarizeLoan(drawdowns).principal).toBe('8650000.00');
  });

  it('the remaining balance after each return matches column H', () => {
    const balances = loanRunningBalances(repayments, '8650000');
    expect(balances).toEqual(
      ['7650000', '5600000', '4600000', '3000000', '2700000', '1900000', '1400000', '500000'].map((v) => fromPaisa(toPaisa(v))),
    );
  });

  it('the total left (I2) — drawdowns then returns, as their own rows', () => {
    expect(summarizeLoan([...drawdowns, ...repayments])).toEqual({
      principal: '8650000.00',
      repaid: '8150000.00',
      outstanding: '500000.00',
    });
  });
});

describe('Qasim Khan Loan Account — E4 = E3 + C4 − D4', () => {
  // D = what MQK paid for the Zoo (the Zoo owes more); C = loan returned to him.
  const rows: [string, 'D' | 'C'][] = [
    ['105000', 'D'], ['105000', 'D'], ['9220', 'D'], ['812000', 'D'], ['550000', 'D'], ['50000', 'D'],
    ['1900000', 'D'], ['500000', 'D'], ['1000000', 'D'], ['1000000', 'D'], ['2000000', 'D'], ['400000', 'D'],
    ['500000', 'D'], ['52000', 'D'], ['86550', 'D'], ['1500000', 'C'], ['314500', 'D'], ['500000', 'C'],
    ['400000', 'C'], ['500000', 'C'], ['500000', 'C'],
  ];
  const sheetBalance = [
    -105000, -210000, -219220, -1031220, -1581220, -1631220, -3531220, -4031220, -5031220, -6031220, -8031220,
    -8431220, -8931220, -8983220, -9069770, -7569770, -7884270, -7384270, -6984270, -6484270, -5984270,
  ];

  it('what the Zoo owes MQK after every row is minus the sheet’s balance', () => {
    const owed = loanRunningBalances(rows.map(([amount, col]) => (col === 'D' ? up(amount) : down(amount))));
    expect(owed).toEqual(sheetBalance.map((b) => fromPaisa(BigInt(-b) * 100n)));
  });

  it('closes at 5,984,270 owed', () => {
    expect(summarizeLoan(rows.map(([a, c]) => (c === 'D' ? up(a) : down(a)))).outstanding).toBe('5984270.00');
  });
});

describe('the approved ceiling', () => {
  it('no ceiling: every further advance waits for a Partner', () => {
    expect(increaseNeedsApproval('0.00', '1.00', null)).toBe(true);
    expect(headroom('100.00', null)).toBeNull();
  });
  it('within the ceiling posts straight away; past it waits', () => {
    expect(increaseNeedsApproval('40000.00', '10000', '50000')).toBe(false);
    expect(increaseNeedsApproval('40000.00', '10000.01', '50000')).toBe(true);
    expect(headroom('40000.00', '50000')).toBe('10000.00');
    expect(headroom('60000.00', '50000')).toBe('0.00');
  });
  it('over-repaid: the balance goes negative (they are now owed)', () => {
    expect(loanRunningBalances([up('100'), down('150')])).toEqual(['100.00', '-50.00']);
  });
  it('rejects a zero movement', () => {
    expect(() => loanRunningBalances([up('0')])).toThrow();
  });
});
