import { BonusSplitMethod, PayBasis } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { eachDay, type DayKind } from '../hr/hr-math';
import {
  annualTax,
  bonusPool,
  computePayslip,
  divRound,
  earnedForMonth,
  encashableHalves,
  encashmentAmount,
  planRecovery,
  splitExactly,
  statutoryFor,
  type PayDay,
  type StatutoryRules,
  type TaxBand,
} from './payroll-math';

const OFF: StatutoryRules = {
  eobiEnabled: false,
  eobiMinimumWage: '40700',
  eobiEmployeePct: '1',
  eobiEmployerPct: '5',
  eobiApplies: true,
  taxEnabled: false,
  taxBands: [],
  pfEnabled: false,
  pfEmployeePct: '0',
  pfEmployerPct: '0',
};

/** FBR salaried slabs, tax year 2026 (Finance Act 2025) — the seeded default. */
const BANDS: TaxBand[] = [
  { from: '0', rate: '0' },
  { from: '600000', rate: '1' },
  { from: '1200000', rate: '11' },
  { from: '2200000', rate: '23' },
  { from: '3200000', rate: '30' },
  { from: '4100000', rate: '35' },
];

function month(from: string, to: string, rate: number | ((d: string) => number), kind: DayKind = 'PRESENT', basis = PayBasis.MONTHLY): PayDay[] {
  return eachDay(from, to).map((date) => ({
    date,
    kind,
    rate: toPaisa(String(typeof rate === 'function' ? rate(date) : rate)),
    basis,
  }));
}

const rs = (p: bigint) => fromPaisa(p);

describe('rounding helpers', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });

  it('splits exactly, remainders to the largest fractions', () => {
    expect(splitExactly(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(splitExactly(0n, [1n, 2n])).toEqual([0n, 0n]);
    expect(splitExactly(10n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

/**
 * Formula parity (Sprint Zero to Cutover, Part 05): every row of the
 * "Nov 2024 Salary Sheet ZOO" fed through the engine with the sheet's own
 * inputs — New Salary (D), Absent (E), Advance (F), Bonus (H), Fine (I),
 * Food (J) — must give the sheet's Gross (G) and Net (K) to the paisa.
 */
describe('salary-sheet parity — Nov 2024, every row', () => {
  // [name, D, E, F, H, I, J, G, K]
  type Row = [string, number, number, number, number, number, number, string, string];
  const ZOO: Row[] = [
    ['Ali', 25000, 0, 0, 0, 0, 0, '25000.00', '25000.00'],
    ['Abu Bakar', 23000, 0, 0, 0, 0, 0, '23000.00', '23000.00'],
    ['Amir', 25000, 0, 0, 0, 1000, 0, '25000.00', '24000.00'],
    ['Israr udin', 23000, 0, 0, 0, 0, 0, '23000.00', '23000.00'],
    ['Aslam', 38000, 0, 0, 0, 0, 0, '38000.00', '38000.00'],
    ['Aurangzeb', 42350, 0, 0, 0, 0, 0, '42350.00', '42350.00'],
    ['Zaid khan', 23000, 0, 0, 0, 500, 0, '23000.00', '22500.00'],
    ['Riffaqat', 23000, 0, 0, 0, 8830, 0, '23000.00', '14170.00'],
    ['Haseeb Ur Rehman', 27500, 0, 0, 0, 0, 0, '27500.00', '27500.00'],
    ['Ikram Ullah', 25000, 0, 0, 0, 0, 0, '25000.00', '25000.00'],
    ['Jibran', 25000, 0, 0, 0, 1630, 0, '25000.00', '23370.00'],
    ['Jamshed', 35000, 0, 0, 0, 0, 0, '35000.00', '35000.00'],
    ['Kabeer', 32500, 0, 0, 0, 0, 0, '32500.00', '32500.00'],
    ['Sharif khan', 23000, 0, 1500, 0, 0, 0, '21500.00', '21500.00'],
    ['Qasim', 27500, -1, 0, 0, 0, 0, '28416.67', '28416.67'],
    ['Riffaqat (Ticket Incharge)', 33000, 0, 0, 5000, 0, 0, '33000.00', '38000.00'],
    ['Sabtain', 38500, 0, 38500, 0, 0, 0, '0.00', '0.00'],
    ['Sajjad', 38500, 0, 0, 0, 0, 0, '38500.00', '38500.00'],
    ['Qaiser Shahzad', 23000, 0, 0, 0, 8630, 0, '23000.00', '14370.00'],
    ['Shahid Imran', 27500, -2, 0, 0, 0, 0, '29333.33', '29333.33'],
    ['Shahzad', 27500, 0, 0, 0, 0, 0, '27500.00', '27500.00'],
    ['Hazrat nawab', 25000, 0, 0, 0, 0, 0, '25000.00', '25000.00'],
    ['Shoukat', 28000, 0, 850, 0, 0, 0, '27150.00', '27150.00'],
    ['Shoukat Ali', 23000, 0, 0, 0, 0, 0, '23000.00', '23000.00'],
    ['Tahir', 23000, -1, 0, 0, 0, 0, '23766.67', '23766.67'],
    ['Umer Daraz', 30000, 0, 0, 0, 0, 0, '30000.00', '30000.00'],
    ['Usama', 23000, 1, 0, 0, 0, 0, '22233.33', '22233.33'],
    ['Younas Sb', 66000, -1, 300, 8000, 0, 0, '67900.00', '75900.00'],
  ];
  const CAFE: Row[] = [
    ['Abdul Bais', 25000, 0, 0, 0, 500, 0, '25000.00', '24500.00'],
    ['Khalid', 35000, -1, 0, 0, 100, 0, '36166.67', '36066.67'],
    ['Shahzaib', 23000, 0, 12000, 0, 100, 0, '11000.00', '10900.00'],
    ['Zain Ali', 30000, 3, 0, 0, 100, 0, '27000.00', '26900.00'],
  ];
  const MBF: Row[] = [
    ['Asif Khan', 27500, 0, 0, 0, 0, 0, '27500.00', '27500.00'],
    ['Haris Javeed', 35000, 0, 0, 2000, 0, 0, '35000.00', '37000.00'],
  ];

  function run([, d, e, f, h, i, j]: Row) {
    const earned = earnedForMonth({
      days: month('2024-11-01', '2024-11-30', d),
      monthDays: 30,
      daysPerMonth: 30,
      payrollAbsentHalves: e * 2,
    });
    return computePayslip({
      earned,
      poolBonus: 0n,
      allowances: toPaisa(String(h)),
      fines: toPaisa(String(i)),
      food: toPaisa(String(j)),
      otherDeductions: 0n,
      advances: f ? [{ id: 'adv', issueDate: '2024-11-05', outstanding: toPaisa(String(f)), installment: null }] : [],
      advanceOverride: null,
      statutory: OFF,
    });
  }

  it.each([...ZOO, ...CAFE, ...MBF])('%s', (...row) => {
    const r = run(row as Row);
    expect(rs(r.gross)).toBe(row[7]);
    expect(rs(r.net)).toBe(row[8]);
  });

  it('Multi Zoo block totals the sheet’s Advance (F34 41,150) and Bonus (H34 13,000) columns', () => {
    const results = ZOO.map(run);
    expect(rs(results.reduce((s, r) => s + r.advanceRecovered, 0n))).toBe('41150.00');
    expect(rs(results.reduce((s, r) => s + r.bonus, 0n))).toBe('13000.00');
  });

  it('flags the three rows where the sheet typed a figure instead of its formula', () => {
    // Majid Husain: 5 absent on 23,000 → formula 19,166.67; the sheet typed 19,150.
    expect(rs(run(['Majid Husain', 23000, 5, 0, 0, 0, 0, '', '']).gross)).toBe('19166.67');
    // Azhar: 20 absent on 35,000 → formula 11,666.67; the sheet typed 11,666.
    expect(rs(run(['Azhar', 35000, 20, 0, 0, 0, 0, '', '']).gross)).toBe('11666.67');
    // Shafaqat: an advance equal to the salary → formula Gross 0; the sheet typed 26,000 (and Net 0).
    const shafaqat = run(['Shafaqat', 26000, 0, 26000, 0, 0, 0, '', '']);
    expect(rs(shafaqat.gross)).toBe('0.00');
    expect(rs(shafaqat.net)).toBe('0.00');
  });
});

describe('salary for part of a month', () => {
  it('pays a joiner Salary/30 per day employed', () => {
    const r = earnedForMonth({ days: month('2024-11-16', '2024-11-30', 30000), monthDays: 30, daysPerMonth: 30, payrollAbsentHalves: 0 });
    expect(rs(r.earned)).toBe('15000.00');
  });

  it('pays a leaver in a 31-day month per day, never more than the month', () => {
    const r = earnedForMonth({ days: month('2024-10-01', '2024-10-20', 31000), monthDays: 31, daysPerMonth: 30, payrollAbsentHalves: 0 });
    expect(rs(r.earned)).toBe('20666.67');
    const almost = earnedForMonth({ days: month('2024-10-01', '2024-10-30', 31000), monthDays: 31, daysPerMonth: 30, payrollAbsentHalves: 0 });
    expect(rs(almost.earned)).toBe('31000.00');
  });

  it('weights a mid-month raise by days in a full month', () => {
    const r = earnedForMonth({
      days: month('2024-10-01', '2024-10-31', (d) => (d < '2024-10-16' ? 30000 : 33000)),
      monthDays: 31,
      daysPerMonth: 30,
      payrollAbsentHalves: 0,
    });
    expect(rs(r.earned)).toBe('31548.39');
    expect(rs(r.salary)).toBe('33000.00');
  });

  it('deducts absences at the latest rate, and a full month absent never goes below zero', () => {
    const r = earnedForMonth({ days: month('2024-10-01', '2024-10-31', 30000), monthDays: 31, daysPerMonth: 30, payrollAbsentHalves: 62 });
    expect(rs(r.absenceDeduction)).toBe('31000.00');
    const slip = computePayslip({
      earned: r, poolBonus: 0n, allowances: 0n, fines: 0n, food: 0n, otherDeductions: 0n, advances: [], advanceOverride: null, statutory: OFF,
    });
    expect(rs(slip.salaryForDays)).toBe('0.00');
    expect(rs(slip.net)).toBe('0.00');
  });

  it('pays daily-wage staff for days worked, half days and paid leave', () => {
    const days: PayDay[] = [
      ...month('2024-11-01', '2024-11-20', 1000, 'PRESENT', PayBasis.DAILY),
      ...month('2024-11-21', '2024-11-22', 1000, 'HALF_DAY', PayBasis.DAILY),
      ...month('2024-11-23', '2024-11-23', 1000, 'EXTRA', PayBasis.DAILY),
      ...month('2024-11-24', '2024-11-24', 1000, 'LEAVE_PAID', PayBasis.DAILY),
      ...month('2024-11-25', '2024-11-26', 1000, 'ABSENT', PayBasis.DAILY),
      ...month('2024-11-27', '2024-11-30', 1000, 'OFF', PayBasis.DAILY),
    ];
    const r = earnedForMonth({ days, monthDays: 30, daysPerMonth: 30, payrollAbsentHalves: 4 });
    expect(r.basis).toBe(PayBasis.DAILY);
    expect(r.paidHalves).toBe(46);
    expect(rs(r.earned)).toBe('23000.00');
    expect(r.absenceDeduction).toBe(0n);
  });
});

describe('advances', () => {
  const adv = (id: string, issueDate: string, outstanding: number, installment: number | null = null) => ({
    id,
    issueDate,
    outstanding: toPaisa(String(outstanding)),
    installment: installment === null ? null : toPaisa(String(installment)),
  });

  it('recovers instalments oldest first', () => {
    const plan = planRecovery([adv('b', '2024-11-10', 5000, 2000), adv('a', '2024-10-01', 1000)], toPaisa('50000'));
    expect(plan.map((p) => [p.id, rs(p.amount)])).toEqual([
      ['a', '1000.00'],
      ['b', '2000.00'],
    ]);
  });

  it('never takes more than the pay left', () => {
    const plan = planRecovery([adv('a', '2024-10-01', 30000)], toPaisa('12000'));
    expect(rs(plan[0].amount)).toBe('12000.00');
    expect(planRecovery([adv('a', '2024-10-01', 30000)], toPaisa('-5'))).toEqual([]);
  });

  it('honours an override (0 skips the month)', () => {
    expect(planRecovery([adv('a', '2024-10-01', 30000)], toPaisa('50000'), 0n)).toEqual([]);
    const plan = planRecovery([adv('a', '2024-10-01', 3000), adv('b', '2024-10-05', 3000)], toPaisa('50000'), toPaisa('4000'));
    expect(plan.map((p) => rs(p.amount))).toEqual(['3000.00', '1000.00']);
  });
});

describe('statutory deductions', () => {
  it('taxes each slice of annual income at its own band', () => {
    expect(annualTax(toPaisa('600000'), BANDS)).toBe(0n);
    expect(rs(annualTax(toPaisa('1200000'), BANDS))).toBe('6000.00');
    expect(rs(annualTax(toPaisa('2200000'), BANDS))).toBe('116000.00');
    expect(rs(annualTax(toPaisa('3000000'), BANDS))).toBe('300000.00');
    expect(rs(annualTax(toPaisa('5000000'), BANDS))).toBe('931000.00');
  });

  it('charges EOBI on the minimum wage, not the salary, and spreads tax over twelve months', () => {
    const on: StatutoryRules = { ...OFF, eobiEnabled: true, taxEnabled: true, taxBands: BANDS, pfEnabled: true, pfEmployeePct: '8.33', pfEmployerPct: '8.33' };
    const s = statutoryFor(on, toPaisa('250000'), toPaisa('250000'));
    expect(rs(s.eobiEmployee)).toBe('407.00');
    expect(rs(s.eobiEmployer)).toBe('2035.00');
    expect(rs(s.tax)).toBe('25000.00');
    expect(rs(s.pfEmployee)).toBe('20825.00');
    const low = statutoryFor(on, toPaisa('25000'), toPaisa('25000'));
    expect(low.tax).toBe(0n);
    expect(rs(low.eobiEmployee)).toBe('407.00');
  });

  it('leaves everything off by default — the workbook has no statutory columns', () => {
    expect(statutoryFor(OFF, toPaisa('250000'), toPaisa('250000'))).toEqual({
      eobiEmployee: 0n, eobiEmployer: 0n, tax: 0n, pfEmployee: 0n, pfEmployer: 0n,
    });
  });

  it('takes EOBI and tax off net, and counts the employer share as cost', () => {
    const earned = earnedForMonth({ days: month('2024-11-01', '2024-11-30', 30000), monthDays: 30, daysPerMonth: 30, payrollAbsentHalves: 0 });
    const slip = computePayslip({
      earned, poolBonus: 0n, allowances: 0n, fines: 0n, food: 0n, otherDeductions: 0n, advances: [], advanceOverride: null,
      statutory: { ...OFF, eobiEnabled: true },
    });
    expect(rs(slip.net)).toBe('29593.00');
    expect(rs(slip.cost)).toBe('32035.00');
  });
});

/**
 * The hidden "Bonus Calculator" sheet: school-trip sales of 702,860 → a
 * 5% pool of 35,143 (FLOOR to the rupee); supervisors 38% by trips (G1 6,
 * G2 15, G3 0, G4 2 → 580.62 a trip), ticketers 38% between three,
 * workers 14%, managers 10%.
 */
describe('Bonus Calculator parity', () => {
  const rules = [
    { tier: 'SUPERVISOR', pct: '38', split: BonusSplitMethod.BY_UNITS, roundUp: false },
    { tier: 'TICKETER', pct: '38', split: BonusSplitMethod.EQUAL, roundUp: false },
    { tier: 'WORKER', pct: '14', split: BonusSplitMethod.EQUAL, roundUp: true },
    { tier: 'MANAGER', pct: '10', split: BonusSplitMethod.EQUAL, roundUp: false },
  ];
  const members = [
    { employeeId: 'G1', tier: 'SUPERVISOR', units: '6' },
    { employeeId: 'G2', tier: 'SUPERVISOR', units: '15' },
    { employeeId: 'G3', tier: 'SUPERVISOR', units: '0' },
    { employeeId: 'G4', tier: 'SUPERVISOR', units: '2' },
    { employeeId: 'T1', tier: 'TICKETER', units: '1' },
    { employeeId: 'T2', tier: 'TICKETER', units: '1' },
    { employeeId: 'T3', tier: 'TICKETER', units: '1' },
  ];

  it('reproduces the pool, the tier amounts and every share', () => {
    const r = bonusPool(toPaisa('702860'), '5', rules, members);
    expect(rs(r.pool)).toBe('35143.00');
    expect(r.tiers.map((t) => rs(t.amount))).toEqual(['13354.34', '13354.34', '4920.02', '3514.30']);
    expect(r.tiers[0].perUnit).toBe('580.62');
    const share = (id: string) => rs(r.shares.find((s) => s.employeeId === id)?.amount ?? -1n);
    // The sheet: C2 3,483.74 · C3 8,709.35 · C4 0 · C5 1,161.25; ticketers 4,451.45 each (4,451.4467).
    expect([share('G1'), share('G2'), share('G3'), share('G4')]).toEqual(['3483.74', '8709.35', '0.00', '1161.25']);
    expect([share('T1'), share('T2'), share('T3')]).toEqual(['4451.45', '4451.45', '4451.44']);
    // Nobody in the worker or manager tiers on that sheet → their shares wait, visibly.
    expect(rs(r.undistributed)).toBe('8434.32');
  });

  it('rounds the pool down and a round-up tier’s shares up', () => {
    expect(rs(bonusPool(toPaisa('999.99'), '5', rules, []).pool)).toBe('49.00');
    const r = bonusPool(toPaisa('702860'), '5', rules, [
      { employeeId: 'W1', tier: 'WORKER', units: '1' },
      { employeeId: 'W2', tier: 'WORKER', units: '1' },
      { employeeId: 'W3', tier: 'WORKER', units: '1' },
    ]);
    // CEILING(4,920.02 ÷ 3, 1) = 1,641 each — 2.98 more than the tier, never less.
    expect(r.shares.map((s) => rs(s.amount))).toEqual(['1641.00', '1641.00', '1641.00']);
    expect(rs(r.tiers[2].distributed - r.tiers[2].amount)).toBe('2.98');
  });

  it('a pool that rounds to zero pays nothing', () => {
    const r = bonusPool(toPaisa('10'), '5', rules, members);
    expect(r.pool).toBe(0n);
    expect(r.shares.every((s) => s.amount === 0n)).toBe(true);
  });
});

describe('leave encashment', () => {
  it('pays carried + adjusted + the entitlement earned to the exit date − taken', () => {
    // 14 days a year, leaving 30 June: 14 × 181/365 = 6.94 → 6.5 days earned.
    const halves = encashableHalves({ exitDate: '2026-06-30', carriedIn: 4, adjustments: 0, entitlement: 28, eligibleFrom: '2020-01-01', taken: 6 });
    expect(halves).toBe(11);
    expect(rs(encashmentAmount(toPaisa('30000'), PayBasis.MONTHLY, halves, 30))).toBe('5500.00');
    expect(rs(encashmentAmount(toPaisa('1200'), PayBasis.DAILY, 3, 30))).toBe('1800.00');
  });

  it('counts nothing before eligibility and never goes negative', () => {
    expect(encashableHalves({ exitDate: '2026-03-01', carriedIn: 0, adjustments: 0, entitlement: 14, eligibleFrom: '2026-07-01', taken: 0 })).toBe(0);
    expect(encashableHalves({ exitDate: '2026-12-31', carriedIn: 0, adjustments: 0, entitlement: 28, eligibleFrom: '2025-01-01', taken: 40 })).toBe(0);
  });
});
