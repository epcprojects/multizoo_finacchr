import { fromPaisa, sumAmounts, toPaisa } from '@multizoo/utils';
import { allocateShared, allocateSubMetered, MeterReadingInput, ShareInput, UtilityMathError } from './utility-math';

/**
 * Formula parity with `Sample cash flow.xlsx → Sub Meters Details`: every
 * billing cycle from Aug 2023 to Jun 2024, and the Admin Block bill
 * division. The sheet keeps unrounded figures (22583.76397); the engine
 * rounds each charge to the paisa and makes them add up to the bill, so
 * every charge is within one paisa of the sheet's, rounded.
 */

const ROOMS = [
  ['inc', 'Incubator room', 'MBF'],
  ['brd', 'Brooder room', 'MBF'],
  ['wrk', 'Zoo workers room', 'ZOO'],
  ['stf', 'Zoo staff room', 'ZOO'],
  ['cafe', 'Panda Cafe', 'CAFE'],
  ['store', 'Z & Co Store', 'ZCO'],
  ['eng', 'Z & Co Engineers Room', 'ZCO'],
] as const;

/** One cycle: bill, units on the bill, [start, end, sheet charge] per room, sheet remainder charge. */
type Cycle = [string, string, string, [string, string, number][], number];

const CYCLES: Cycle[] = [
  ['Sep 2023 (18 Aug–17 Sep)', '280282', '3686', [
    ['51.5', '348.5', 22583.76397], ['90.7', '322.4', 17618.37748], ['0', '23.6', 1794.53478], ['0', '62.3', 4737.267661],
    ['0', '228.4', 17367.44677], ['46.6', '166.3', 9101.941237], ['51.3', '121.5', 5337.980575],
  ], 201740.6875],
  ['Oct 2023', '225845', '2744', [
    ['348.5', '401.5', 4362.166545], ['322.4', '557', 19308.75984], ['23.6', '28.1', 370.3726312], ['62.3', '66.6', 353.9116254],
    ['228.4', '563.2', 27555.72376], ['166.3', '203.2', 3037.055576], ['121.5', '161', 3251.048652],
  ], 167605.9614],
  ['Nov 2023', '97808', '1100', [
    ['401.5', '432', 2711.949091], ['557', '919.1', 32196.61527], ['28.1', '41.6', 1200.370909], ['66.6', '71.2', 409.0152727],
    ['563.2', '815.7', 22451.38182], ['203.2', '225.1', 1947.268364], ['161', '180', 1689.410909],
  ], 35201.98836],
  ['Dec 2023', '150716', '1716', [
    ['432', '563', 11505.70862], ['919.1', '1166', 21685.18671], ['41.6', '81', 3460.495571], ['71.2', '76', 421.5832168],
    ['815.7', '968', 13376.48415], ['225.1', '240', 1308.664569], ['180', '204', 2107.916084],
  ], 96849.96107],
  ['Jan 2024', '163342', '1969', [
    ['563', '681.7', 9846.975825], ['1166', '1397.4', 19196.21067], ['81', '113', 2654.618588], ['76', '84.7', 721.7244286],
    ['968', '1084.5', 9664.470797], ['240', '249.8', 812.9769426], ['204', '224.9', 1733.797765],
  ], 118711.225],
  ['Feb 2024', '137909', '1532', [
    ['681.7', '832.2', 13547.84889], ['1397.4', '1694.7', 26762.62774], ['113', '137.9', 2241.471345], ['84.7', '91.6', 621.1306136],
    ['1084.5', '1263.5', 16113.38838], ['249.8', '261.1', 1017.213903], ['224.9', '246.1', 1908.401305],
  ], 75696.91782],
  ['Mar 2024', '149181', '1578', [
    ['832.2', '970', 13027.33954], ['1694.7', '1903', 19692.27015], ['137.9', '148', 954.8340304], ['91.6', '97', 510.5053232],
    ['1263.5', '1421', 14889.73859], ['261.1', '274', 1219.540494], ['246.1', '267', 1975.844677],
  ], 96910.92719],
  ['Apr 2024', '162770', '1948', [
    ['970', '1146.5', 14747.89784], ['1903', '2035.8', 11096.43532], ['148', '154.3', 526.4122177], ['97', '99.4', 200.5379877],
    ['1421', '1710', 24148.11602], ['274', '285.3', 944.199692], ['267', '285.5', 1545.813655],
  ], 109560.5873],
  ['May 2024', '243054', '3053', [
    ['1146.5', '1341.2', 15500.36482], ['2035.8', '2079.3', 3463.101539], ['154.3', '157.3', 238.8345889], ['99.4', '102.1', 214.95113],
    ['1710', '2118', 32481.50409], ['285.3', '327', 3319.800786], ['285.5', '326', 3224.266951],
  ], 184611.1761],
  ['Jun 2024', '241138', '2808', [
    ['1341.2', '2079.9', 63436.12557], ['2079.3', '2170.8', 7857.595085], ['157.3', '161.8', 386.4391026], ['102.1', '107.5', 463.7269231],
    ['2118', '2948.5', 71319.48326], ['327', '387', 5152.521368], ['326', '368.2', 3623.940028],
  ], 88898.16866],
];

/** The sheet's figure, rounded half up to the paisa. */
const sheetPaisa = (value: number) => Math.round(value * 100);

describe('Zoo Green Meter — sub-metered cycles (Sub Meters Details)', () => {
  it.each(CYCLES)('%s: every charge within a paisa of the sheet, and the charges add up to the bill', (_label, bill, units, rooms, remainder) => {
    const readings: MeterReadingInput[] = rooms.map(([start, end], i) => ({
      key: ROOMS[i][0],
      label: ROOMS[i][1],
      unitKey: ROOMS[i][2],
      start,
      end,
    }));
    const result = allocateSubMetered({
      billAmount: bill,
      totalUnits: units,
      standardDays: 30,
      readings,
      remainder: [{ unitKey: 'ZOO', label: 'Remaining units consumed by Multi Zoo', pct: '100' }],
    });

    rooms.forEach(([, , sheet], i) => {
      const ours = Number(toPaisa(result.metered[i].charge));
      expect(Math.abs(ours - sheetPaisa(sheet))).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(Number(toPaisa(result.remainder[0].charge)) - sheetPaisa(remainder))).toBeLessThanOrEqual(1);
    expect(sumAmounts([...result.metered, ...result.remainder].map((r) => r.charge))).toBe(toAmount(bill));
    expect(result.total).toBe(toAmount(bill));
  });

  it('Sep 2023: consumed = end − start, remainder = bill units − Σ sub-meters (G47 1032.9, G48 2653.1)', () => {
    const [, bill, units, rooms] = CYCLES[0];
    const result = allocateSubMetered({
      billAmount: bill,
      totalUnits: units,
      standardDays: 30,
      readings: rooms.map(([start, end], i) => ({ key: ROOMS[i][0], label: ROOMS[i][1], unitKey: ROOMS[i][2], start, end })),
      remainder: [{ unitKey: 'ZOO', pct: '100' }],
    });
    expect(result.metered.map((r) => r.consumed)).toEqual(['297.00', '231.70', '23.60', '62.30', '228.40', '119.70', '70.20']);
    expect(result.remainderUnits).toBe('2653.10');
    expect(result.rate).toBe('76.0396'); // E52 = 76.03960933
  });

  it('by unit: MBF pays the incubator and brooder rooms, Z & Co its store and engineers, the Zoo its rooms and the rest', () => {
    const [, bill, units, rooms, remainder] = CYCLES[0];
    const result = allocateSubMetered({
      billAmount: bill,
      totalUnits: units,
      standardDays: 30,
      readings: rooms.map(([start, end], i) => ({ key: ROOMS[i][0], label: ROOMS[i][1], unitKey: ROOMS[i][2], start, end })),
      remainder: [{ unitKey: 'ZOO', pct: '100' }],
    });
    const by = Object.fromEntries(result.byUnit.map((u) => [u.unitKey, Number(toPaisa(u.charge))]));
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
    near(by.MBF, sheetPaisa(22583.76397 + 17618.37748));
    near(by.ZCO, sheetPaisa(9101.941237 + 5337.980575));
    near(by.CAFE, sheetPaisa(17367.44677));
    near(by.ZOO, sheetPaisa(1794.53478 + 4737.267661 + remainder));
  });

  describe('Aug 2023 (16 Jul–17 Aug): meters installed mid-cycle, pro-rated to 30 days, remainder 70 / 30', () => {
    const result = allocateSubMetered({
      billAmount: '378848',
      totalUnits: '4806',
      standardDays: 30,
      readings: [
        { key: 'bon', label: 'Cafe Bonanza', unitKey: 'CAFE', start: '0', end: '582.4', daysCovered: 26 },
        { key: 'inc', label: 'Incubator Room', unitKey: 'MBF', start: '0', end: '51.5', daysCovered: 13 },
        { key: 'brd', label: 'Brooder Room', unitKey: 'MBF', start: '0', end: '90.7', daysCovered: 13 },
        { key: 'store', label: 'Z & Co Store', unitKey: 'ZCO', start: '0', end: '46.6', daysCovered: 13 },
        { key: 'eng', label: 'Z & Co Engineers Room', unitKey: 'ZCO', start: '0', end: '51.3', daysCovered: 13 },
      ],
      remainder: [
        { unitKey: 'ZOO', label: 'Remaining units 70% charged to Zoo', pct: '70' },
        { unitKey: 'CAFE', label: 'Remaining units 30% charged to Panda Cafe', pct: '30' },
      ],
    });

    it('deserving units = consumed ÷ days × 30 (H9 = G9/26*30 → 672; H10 = G10/13*30 → 118.85)', () => {
      expect(result.metered.map((r) => r.units)).toEqual(['672.00', '118.85', '209.31', '107.54', '118.38']);
      expect(result.remainderUnits).toBe('3579.92'); // H15
      expect(result.remainder.map((r) => r.units)).toEqual(['2505.95', '1073.98']); // H16, H17
    });

    it('priced at the bill’s own rate, 378,848 ÷ 4,806 — the sheet typed 78.83, which over-charges 8.98 in all', () => {
      expect(result.rate).toBe('78.8281');
      expect(result.metered.map((r) => r.charge)).toEqual(['52972.51', '9368.42', '16499.33', '8477.06', '9332.04']);
      expect(result.remainder.map((r) => r.charge)).toEqual(['197539.05', '84659.59']);
      expect(sumAmounts([...result.metered, ...result.remainder].map((r) => r.charge))).toBe('378848.00');
      // The sheet at 78.83: I9..I13 + I16 + I17 = 378,856.98 against a bill of 378,848.
      const sheet = [52973.76, 9368.642308, 16499.72538, 8477.256923, 9332.259231, 197543.7353, 84661.60085];
      expect(fromPaisa(BigInt(sheetPaisa(sheet.reduce((a, b) => a + b, 0))) - 37884800n)).toBe('8.98');
    });
  });

  describe('guards', () => {
    const base = { billAmount: '1000', totalUnits: '100', standardDays: 30 };
    it('sub-meters reading more than the main meter', () => {
      expect(() =>
        allocateSubMetered({ ...base, readings: [{ key: 'a', label: 'A', unitKey: 'X', start: '0', end: '120' }], remainder: [] }),
      ).toThrow(UtilityMathError);
    });
    it('an end reading below the start', () => {
      expect(() =>
        allocateSubMetered({ ...base, readings: [{ key: 'a', label: 'A', unitKey: 'X', start: '50', end: '40' }], remainder: [] }),
      ).toThrow(/below the start/);
    });
    it('a remainder split that isn’t 100%', () => {
      expect(() =>
        allocateSubMetered({ ...base, readings: [], remainder: [{ unitKey: 'X', pct: '70' }, { unitKey: 'Y', pct: '20' }] }),
      ).toThrow(/split 100%/);
    });
    it('no remainder needs no split: the sub-meters read the whole bill', () => {
      const r = allocateSubMetered({ ...base, readings: [{ key: 'a', label: 'A', unitKey: 'X', start: '0', end: '100' }], remainder: [] });
      expect(r.metered[0].charge).toBe('1000.00');
      expect(r.remainderUnits).toBe('0.00');
    });
    it('thirds of a rupee still add up to the bill', () => {
      const r = allocateSubMetered({ ...base, billAmount: '100', readings: [], remainder: [
        { unitKey: 'X', pct: '33.3333' }, { unitKey: 'Y', pct: '33.3333' }, { unitKey: 'Z', pct: '33.3334' },
      ] });
      expect(r.remainder.map((x) => x.charge)).toEqual(['33.33', '33.33', '33.34']);
    });
  });
});

describe('Admin Block IESCO bill division — shared by offices owned', () => {
  const OFFICES: ShareInput[] = [
    { label: 'CEO Office', weights: { ZCO: '0.5', ZOO: '0.5' } },
    { label: 'PA Office', weights: { ZCO: '0.5', ZOO: '0.5' } },
    { label: 'Manager Office', weights: { ZOO: '1' } },
    { label: 'Design Office', weights: { ZCO: '1', ZOO: '0' } },
    { label: 'PM Office', weights: { ZCO: '1' } },
    { label: 'Zoo Director Office', weights: { ZOO: '1' } },
    { label: 'Z&C Director Office', weights: { ZCO: '1' } },
    { label: 'Procurement Office', weights: { ZCO: '1' } },
    { label: 'Accounts Office', weights: { ZCO: '0.5', ZOO: '0.5' } },
    { label: 'Ticket Ghar', weights: { ZOO: '1' } },
  ];

  it.each([
    ['87271', '47999.05', '39271.95'], // L142, L141
    ['27997', '15398.35', '12598.65'], // M185, M186
    ['11802', '6491.10', '5310.90'],
    ['16043', '8823.65', '7219.35'],
    ['98368', '54102.40', '44265.60'],
  ])('bill %s → Z & Co 5.5 of 10 offices %s, Zoo 4.5 of 10 %s', (bill, zco, zoo) => {
    const result = allocateShared(bill, OFFICES);
    const by = Object.fromEntries(result.byUnit.map((u) => [u.unitKey, u.charge]));
    expect(by).toEqual({ ZCO: zco, ZOO: zoo });
    expect(result.remainder.map((r) => r.pct)).toEqual(['55', '45']);
  });

  it('shares that don’t divide evenly still add up to the bill', () => {
    const r = allocateShared('100', [{ label: 'x', weights: { A: '1', B: '1', C: '1' } }]);
    expect(r.byUnit.map((u) => u.charge)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('refuses no weights at all', () => {
    expect(() => allocateShared('100', [{ label: 'x', weights: { A: '0' } }])).toThrow(UtilityMathError);
  });
});

function toAmount(value: string) {
  return fromPaisa(toPaisa(value));
}
