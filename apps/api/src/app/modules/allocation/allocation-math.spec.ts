import { AllocationMethod } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import { allocate, fromScaled, ruleViolations, toScaled, type RuleInput } from './allocation-math';

const { PERCENT, PARTS } = AllocationMethod;

/** Terse rule builder: tranche(name, share, method, [[key, weight], …]). */
function tranche(name: string, share: string, method: AllocationMethod, lines: [string, string][]) {
  return { name, share, method, lines: lines.map(([key, weight]) => ({ key, label: key, weight })) };
}

/**
 * Asserts the engine against a Formula-sheet row: every bucket within one
 * paisa of the workbook's unrounded value, and the buckets totalling the
 * day's income exactly (the workbook itself leaks fractions of a paisa).
 */
function expectParity(rule: RuleInput, income: string, workbook: Record<string, number>) {
  const result = allocate(toPaisa(income), rule);
  const byKey = new Map(result.byKey.map((b) => [b.key, b.amount]));
  for (const [key, value] of Object.entries(workbook)) {
    const ours = byKey.get(key);
    expect(ours).toBeDefined();
    const exactPaisa = value * 100;
    expect(Math.abs(Number(ours) - exactPaisa)).toBeLessThanOrEqual(1);
  }
  expect(result.byKey.reduce((s, b) => s + b.amount, 0n)).toBe(toPaisa(income));
  return byKey;
}

describe('scaled percentages', () => {
  it('round-trips 4 decimal places without floats', () => {
    expect(toScaled('65')).toBe(650000n);
    expect(toScaled('33.3333')).toBe(333333n);
    expect(fromScaled(655000n)).toBe('65.5');
    expect(fromScaled(10000n)).toBe('1');
    expect(() => toScaled('1.23456')).toThrow();
    expect(() => toScaled('-5')).toThrow();
  });
});

describe('rule validation', () => {
  const ok: RuleInput = {
    tranches: [tranche('Ops', '90', PERCENT, [['a', '60'], ['b', '40']]), tranche('Partners', '10', PARTS, [['p', '1'], ['q', '1']])],
  };

  it('accepts a complete rule', () => {
    expect(ruleViolations(ok)).toEqual([]);
  });

  it('requires the tranches to take exactly 100% of income', () => {
    const rule = { tranches: [{ ...ok.tranches[0], share: '89' }, ok.tranches[1]] };
    expect(ruleViolations(rule).join(' ')).toMatch(/take 99%/);
  });

  it('requires a percent tranche to total exactly 100%', () => {
    const rule = { tranches: [tranche('Ops', '90', PERCENT, [['a', '60'], ['b', '39.9999']]), ok.tranches[1]] };
    expect(ruleViolations(rule).join(' ')).toMatch(/99\.9999%/);
  });

  it('lets parts add up to anything', () => {
    const rule = { tranches: [ok.tranches[0], tranche('Partners', '10', PARTS, [['p', '25'], ['q', '40']])] };
    expect(ruleViolations(rule)).toEqual([]);
  });

  it('rejects zero, empty, duplicate and over-precise lines', () => {
    const bad = (lines: [string, string][]) =>
      ruleViolations({ tranches: [tranche('T', '100', PARTS, lines)] }).join(' ');
    expect(bad([['a', '0']])).toMatch(/more than 0/);
    expect(bad([])).toMatch(/at least one line/);
    expect(bad([['a', '1'], ['a', '2']])).toMatch(/appears twice/);
    expect(bad([['a', '1.00001']])).toMatch(/4 decimal places/);
    expect(bad([['', '1']])).toMatch(/choose where/);
  });
});

describe('allocate', () => {
  it('always totals the gross exactly, even when parts divide unevenly', () => {
    const rule = { tranches: [tranche('All', '100', PARTS, [['a', '1'], ['b', '1'], ['c', '1']])] };
    const r = allocate(100n, rule); // Rs 1.00 three ways
    expect(r.lines.map((l) => l.amount)).toEqual([34n, 33n, 33n]);
    expect(r.byKey.reduce((s, b) => s + b.amount, 0n)).toBe(100n);
  });

  it('gives a zero-income day nothing', () => {
    const rule = { tranches: [tranche('All', '100', PERCENT, [['a', '50'], ['b', '50']])] };
    expect(allocate(0n, rule).lines.every((l) => l.amount === 0n)).toBe(true);
  });

  it('mirrors a negative (correction) day', () => {
    const rule = { tranches: [tranche('All', '100', PARTS, [['a', '1'], ['b', '2']])] };
    expect(allocate(-300n, rule).lines.map((l) => l.amount)).toEqual([-100n, -200n]);
  });

  it('sums a target that appears in two tranches (Joy Land capital)', () => {
    const rule = {
      tranches: [tranche('Ops', '80', PERCENT, [['cap', '35'], ['other', '65']]), tranche('Capital', '20', PERCENT, [['cap', '100']])],
    };
    const r = allocate(toPaisa('100'), rule);
    expect(r.byKey.find((b) => b.key === 'cap')?.amount).toBe(toPaisa('48'));
  });

  it("reports each line's effective share of income", () => {
    const rule = {
      tranches: [tranche('Ops', '65', PERCENT, [['feed', '30'], ['rest', '70']]), tranche('Partners', '35', PARTS, [['a', '25'], ['b', '40']])],
    };
    const pct = allocate(0n, rule).lines.map((l) => l.percentOfIncome);
    expect(pct).toEqual(['19.5', '45.5', '13.4615', '21.5385']);
  });

  it('scales to a seven-figure day without drift', () => {
    const rule = { tranches: [tranche('All', '100', PARTS, [['a', '7'], ['b', '11'], ['c', '13']])] };
    const gross = toPaisa('9876543.21');
    const r = allocate(gross, rule);
    expect(r.byKey.reduce((s, b) => s + b.amount, 0n)).toBe(gross);
    // 7/31 of it is 2,230,187.1764…; floors leave 2 paisa over, which go to
    // the two largest remainders (b at .871, then a at .645).
    expect(r.byKey.map((b) => fromPaisa(b.amount))).toEqual(['2230187.18', '3504579.85', '4141776.18']);
  });
});

/**
 * Formula parity — rows from `Sample cash flow.xlsx`, sheet "Formula".
 * Income and expected buckets are the workbook's cached values; the rules
 * are transcribed from the formulas in those cells (not from the column
 * headers, which have drifted — see docs/module-03-income-allocation.md).
 */
describe('formula parity: Formula sheet', () => {
  // Multi Zoo, formulas in row 3 (Oct 2021): =(B3*65%)*45%, =(B3*65/100)*5%, … =B3*1/100, =(B3*34/100)*25/65
  const zoo2021: RuleInput = {
    tranches: [
      tranche('Operations & reserves', '65', PERCENT, [
        ['Salary', '45'], ['Development', '5'], ['Utilities', '10'], ['Feed', '30'],
        ['Transport', '2'], ['Maintenance', '3'], ['Capital', '5'],
      ]),
      tranche('Employee relief', '1', PERCENT, [['Employee Relief', '100']]),
      tranche('Partners', '34', PARTS, [['MIK', '25'], ['MQK', '40']]),
    ],
  };

  it.each([
    ['row 3', '67460', { Salary: 19732.05, Development: 2192.45, Utilities: 4384.9, Feed: 13154.7, Transport: 876.98, Maintenance: 1315.47, Capital: 2192.45, 'Employee Relief': 674.6, MIK: 8821.692308, MQK: 14114.70769 }],
    ['row 5', '44950', { Salary: 13147.875, Development: 1460.875, Utilities: 2921.75, Feed: 8765.25, Transport: 584.35, Maintenance: 876.525, Capital: 1460.875, 'Employee Relief': 449.5, MIK: 5878.076923, MQK: 9404.923077 }],
    ['row 12', '111060', { Salary: 32485.05, Development: 3609.45, Utilities: 7218.9, Feed: 21656.7, Transport: 1443.78, Maintenance: 2165.67, Capital: 3609.45, 'Employee Relief': 1110.6, MIK: 14523.23077, MQK: 23237.16923 }],
  ])('Multi Zoo 2021, %s', (_row, income, expected) => {
    expectParity(zoo2021, income, expected);
  });

  // Multi Zoo, formulas in row 1534 (Jan 2026): =(B1534*30%) … =(B1534*11%*70%), =(B1534*11%*30%)
  const zoo2026: RuleInput = {
    tranches: [
      tranche('Reserves', '89', PARTS, [
        ['Salary', '30'], ['Marketing', '3'], ['Medicine', '3'], ['Development', '11'], ['Utilities', '7'],
        ['Feed', '25'], ['Transport', '1'], ['Maintenance', '3'], ['Capital', '5'], ['Employee Relief', '1'],
      ]),
      tranche('Partners', '11', PERCENT, [['MIK', '70'], ['MQK', '30']]),
    ],
  };

  it('Multi Zoo 2026, row 1786 (11 Sep 2026)', () => {
    const r = expectParity(zoo2026, '96400', {
      Salary: 28920, Marketing: 2892, Medicine: 2892, Development: 10604, Utilities: 6748, Feed: 24100,
      Transport: 964, Maintenance: 2892, Capital: 4820, 'Employee Relief': 964, MIK: 7422.8, MQK: 3181.2,
    });
    // Whole-percent rule on a round number: exact to the paisa, no remainder at all.
    expect(fromPaisa(r.get('Feed') as bigint)).toBe('24100.00');
  });

  // Panda Cafe, formulas in row 3 (Oct 2021): =(Q3*90%)*20% … =Q3*1/100, =(Q3*9/100)*25/65
  const cafe2021: RuleInput = {
    tranches: [
      tranche('Operations & reserves', '90', PERCENT, [
        ['Salary', '20'], ['Fuel', '10'], ['Utilities', '5'], ['Stock', '43'], ['Oil', '7'],
        ['Transport', '2'], ['Maintenance', '5'], ['Capital', '8'],
      ]),
      tranche('Employee relief', '1', PERCENT, [['Employee Relief', '100']]),
      tranche('Partners', '9', PARTS, [['MIK', '25'], ['MQK', '40']]),
    ],
  };

  it('Panda Cafe 2021, row 3', () => {
    expectParity(cafe2021, '17515', {
      Salary: 3152.7, Fuel: 1576.35, Utilities: 788.175, Stock: 6778.305, Oil: 1103.445, Transport: 315.27,
      Maintenance: 788.175, Capital: 1261.08, 'Employee Relief': 175.15, MIK: 606.2884615, MQK: 970.0615385,
    });
  });

  // Panda Cafe, current (values in row 1786; partner formulas from row 1534: =(Q1534*8/100)*50%)
  const cafe2026: RuleInput = {
    tranches: [
      tranche('Operations & reserves', '90', PERCENT, [
        ['Salary', '19'], ['Marketing', '1'], ['Fuel', '7'], ['Utilities', '3'], ['Rent', '5'], ['Stock', '43'],
        ['Oil', '7'], ['Transport', '2'], ['Maintenance', '5'], ['Capital', '8'],
      ]),
      tranche('Employee relief', '2', PERCENT, [['Employee Relief', '100']]),
      tranche('Partners', '8', PERCENT, [['MIK', '50'], ['MQK', '50']]),
    ],
  };

  it('Panda Cafe 2026, row 1786 (11 Sep 2026)', () => {
    expectParity(cafe2026, '20441', {
      Salary: 3495.411, Marketing: 183.969, Fuel: 1287.783, Utilities: 551.907, Rent: 919.845, Stock: 7910.667,
      Oil: 1287.783, Transport: 367.938, Maintenance: 919.845, Capital: 1471.752, 'Employee Relief': 408.82,
      MIK: 817.64, MQK: 817.64,
    });
  });

  // Jungle Joys, row 3 (Jan 2026): =(AG3*90%)*25% …, =(AG3*10%)/3 for each of three partners
  const gift2026: RuleInput = {
    tranches: [
      tranche('Operations & reserves', '90', PERCENT, [
        ['Salary', '25'], ['Utilities', '7'], ['Stock', '50'], ['Rent', '2'], ['Transport', '1'],
        ['Maintenance', '3'], ['Capital', '10'], ['Employee Relief', '1'], ['Marketing', '1'],
      ]),
      tranche('Partners', '10', PARTS, [['MIK', '1'], ['MQK', '1'], ['Haider', '1']]),
    ],
  };

  it('Jungle Joys 2026, row 3 — a three-way split that cannot divide evenly', () => {
    const r = expectParity(gift2026, '1240', {
      Salary: 279, Utilities: 78.12, Stock: 558, Rent: 22.32, Transport: 11.16, Maintenance: 33.48,
      Capital: 111.6, 'Employee Relief': 11.16, Marketing: 11.16, MIK: 41.33333333, MQK: 41.33333333, Haider: 41.33333333,
    });
    // Rs 124 / 3: the workbook shows 41.333… three times (124.00 only by accident of display);
    // here the stray paisa goes to the first partner and the total is exact.
    expect([r.get('MIK'), r.get('MQK'), r.get('Haider')].map((p) => fromPaisa(p as bigint))).toEqual(['41.34', '41.33', '41.33']);
  });

  it('Jungle Joys 2026, row 4', () => {
    expectParity(gift2026, '23706', {
      Salary: 5333.85, Utilities: 1493.478, Stock: 10667.7, Rent: 426.708, Transport: 213.354, Maintenance: 640.062,
      Capital: 2133.54, 'Employee Relief': 213.354, Marketing: 213.354, MIK: 790.2, MQK: 790.2, Haider: 790.2,
    });
  });

  // Joy Land, row 3 (Jan 2026): =AV3*0.8*0.25 …, capital =(AV3*0.8*0.35)+AV3*0.2 — no partner split
  const joyland2026: RuleInput = {
    tranches: [
      tranche('Operations & reserves', '80', PERCENT, [
        ['Salary', '25'], ['Utilities', '10'], ['Stock', '17'], ['Rent', '2'], ['Transport', '1'],
        ['Maintenance', '8'], ['Capital', '35'], ['Employee Relief', '1'], ['Marketing', '1'],
      ]),
      tranche('Capital (development)', '20', PERCENT, [['Capital', '100']]),
    ],
  };

  it.each([
    ['row 3', '10580', { Salary: 2116, Utilities: 846.4, Stock: 1438.88, Rent: 169.28, Transport: 84.64, Maintenance: 677.12, Capital: 5078.4, 'Employee Relief': 84.64, Marketing: 84.64 }],
    ['row 5', '33060', { Salary: 6612, Utilities: 2644.8, Stock: 4496.16, Rent: 528.96, Transport: 264.48, Maintenance: 2115.84, Capital: 15868.8, 'Employee Relief': 264.48, Marketing: 264.48 }],
  ])('Joy Land 2026, %s', (_row, income, expected) => {
    expectParity(joyland2026, income, expected);
  });
});
