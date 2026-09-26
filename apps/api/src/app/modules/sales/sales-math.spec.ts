import {
  dayProblems,
  DayFigures,
  divRound,
  eventComparison,
  itemBreakup,
  ItemSale,
  lineAmount,
  pctChange,
  salesGrid,
  yearOverYear,
} from './sales-math';

/**
 * Formula parity with `sample income.xlsx` (Ticket sales, Cafe Sales,
 * Joy Land, Jungle Joy) and `Sample cash flow.xlsx → Eid Sales Comperison`.
 */

describe('a line is Qty × Rate (Ticket sales, column I = H × G)', () => {
  it('row 5: 421 Entry Ticket Adult @ 24 = 10,104', () => {
    expect(lineAmount(421, '24')).toBe('10104.00');
  });
  it('row 6: 623 (=76+547) @ 6,345 = 3,952,935 — typed, and the product agrees', () => {
    expect(lineAmount(76 + 547, '6345')).toBe('3952935.00');
  });
  it('rows 7–9: Jumbo 21 @ 154, Fish Feed 14 @ 154, Birds Feed 130 @ 154', () => {
    expect([lineAmount(21, '154'), lineAmount(14, '154'), lineAmount(130, '154')]).toEqual(['3234.00', '2156.00', '20020.00']);
  });
  it('paisa rates stay exact; fractional or negative quantities are refused', () => {
    expect(lineAmount(3, '33.33')).toBe('99.99');
    expect(() => lineAmount(1.5, '10')).toThrow();
    expect(() => lineAmount(-1, '10')).toThrow();
  });
});

describe('Ticket sales — the day-of-month × month grid (L4:X39)', () => {
  const rows = [
    { date: '2026-01-01', amount: '10104' },
    { date: '2026-01-02', amount: '3952935' },
    { date: '2026-01-01', amount: '3234' },
    { date: '2026-01-01', amount: '2156' },
    { date: '2026-01-01', amount: '20020' },
  ];
  const g = salesGrid(2026, rows);

  it('M5 (1st January) = 35,514: every line dated that day, summed', () => {
    expect(g.months[0].days[0]).toBe('35514.00');
    expect(g.months[0].days[1]).toBe('3952935.00');
    expect(g.months[0].days[2]).toBeNull();
  });
  it('M37 Total Sales = 3,988,449 and U1 Grand Total the same', () => {
    expect(g.months[0].total).toBe('3988449.00');
    expect(g.total).toBe('3988449.00');
  });
  it('M38 Monthly Avg Sale = M37 / 31 = 128,659.65 (sheet 128,659.6452)', () => {
    expect(g.months[0].averagePerDay).toBe('128659.65');
    expect(g.months[1].daysInMonth).toBe(28); // N38 = N37/28
  });
  it('S39 Yearly Avg Sale Per Day = U1 / COUNTIF(>1) = 1,994,224.50', () => {
    expect(g.daysWithSales).toBe(2);
    expect(g.averagePerSalesDay).toBe('1994224.50');
  });
  it('a date outside the year, or 30 February, never lands in the grid', () => {
    const other = salesGrid(2026, [{ date: '2025-12-31', amount: '5' }]);
    expect(other.total).toBe('0.00');
    expect(other.months[1].days[29]).toBeNull();
    expect(other.averagePerSalesDay).toBeNull();
  });
});

describe('Cafe / Joy Land / Jungle Joy — day totals only (C4:N38)', () => {
  const cases = [
    { sheet: 'Cafe Sales', days: ['545', '15436', '645164'], total: '661145.00', avg: '21327.26', perDay: '220381.67' },
    { sheet: 'Joy Land', days: ['251453', '154', '154'], total: '251761.00', avg: '8121.32', perDay: '83920.33' },
    { sheet: 'Jungle Joy (Gift shop)', days: ['1364', '153453'], total: '154817.00', avg: '4994.10', perDay: '77408.50' },
  ];
  for (const c of cases) {
    it(`${c.sheet}: total ${c.total}, C37 = C36/31 ≈ ${c.avg}, J38 = K1/COUNT = ${c.perDay}`, () => {
      const g = salesGrid(2026, c.days.map((amount, i) => ({ date: `2026-01-0${i + 1}`, amount })));
      expect(g.months[0].total).toBe(c.total);
      expect(g.total).toBe(c.total);
      expect(g.months[0].averagePerDay).toBe(c.avg);
      expect(g.averagePerSalesDay).toBe(c.perDay);
    });
  }
});

describe('Ticket sales — category-wise breakup (Z4:AX40)', () => {
  const jan = (item: string, quantity: number, amount: string): ItemSale => ({ month: '2026-01', item, quantity, amount });
  const sales = [
    jan('Entry Ticket Adult', 421, '10104'),
    jan('Entry Ticket Adult', 623, '3952935'),
    jan('Jumbo Ticket 370', 21, '3234'),
    jan('Fish Feed', 14, '2156'),
    jan('Birds Feed', 130, '20020'),
  ];
  const b = itemBreakup(sales, ['Birds Feed', 'Entry Ticket Adult', 'Fish Feed', 'Jumbo Ticket 370']);

  it('AA6/AB6 Birds Feed 20,020 / 130; AA18/AB18 Entry Ticket Adult 3,963,039 / 1,044', () => {
    const row = (item: string) => b.items.find((i) => i.item === item)?.months['2026-01'];
    expect(row('Birds Feed')).toEqual({ amount: '20020.00', quantity: 130 });
    expect(row('Entry Ticket Adult')).toEqual({ amount: '3963039.00', quantity: 1044 });
    expect(row('Fish Feed')).toEqual({ amount: '2156.00', quantity: 14 });
    expect(row('Jumbo Ticket 370')).toEqual({ amount: '3234.00', quantity: 21 });
  });
  it('AA40/AB40 Total = 3,988,449 / 1,209, in the price list’s order', () => {
    expect(b.total).toBe('3988449.00');
    expect(b.quantity).toBe(1209);
    expect(b.months).toEqual([{ month: '2026-01', amount: '3988449.00', quantity: 1209 }]);
    expect(b.items.map((i) => i.item)).toEqual(['Birds Feed', 'Entry Ticket Adult', 'Fish Feed', 'Jumbo Ticket 370']);
  });
  it('amount-only lines add to the amount but not the count', () => {
    const r = itemBreakup([{ month: '2026-01', item: 'Cafe sales', quantity: null, amount: '545' }]);
    expect(r.quantity).toBe(0);
    expect(r.total).toBe('545.00');
  });
});

describe('Eid Sales Comperison — day N of the event, year against year', () => {
  // Zoo tickets, Eid-ul-Fitr: income D11:F20, adults G11:I20, kids J11:L20.
  const fitr = {
    2022: { start: '2022-05-03', income: [477410, 983570, 723870, 380950, 287350, 215250, 43300, 41850, 21180, 34510], adults: [1585, 3277, 2432, 1194, 976, 675, 146, 165, 91, 148], kids: [1088, 2009, 1659, 751, 572, 399, 90, 64, 45, 45] },
    2023: { start: '2023-04-22', income: [451741, 862146, 812378, 532847, 157787, 92526, 120886, 100301, 263187, 278487], adults: [1260, 2331, 2261, 1421, 507, 304, 305, 286, 734, 814], kids: [559, 1084, 1002, 683, 163, 94, 164, 119, 323, 323] },
    2024: { start: '2024-04-10', income: [440920, 890684, 1532370, 1311755, 1825003, 190977, 345997], adults: [922, 1767, 3199, 3011, 3654, 454, 714], kids: [564, 1160, 2061, 1370, 2430, 228, 334] },
  } as const;
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const daily = new Map<string, DayFigures>();
  for (const y of Object.values(fitr)) {
    y.income.forEach((amount, i) => daily.set(addDays(y.start, i), { amount: String(amount), adults: y.adults[i], kids: y.kids[i] }));
  }
  const cmp = eventComparison(
    10,
    Object.entries(fitr).map(([year, y]) => ({ year: Number(year), startDate: y.start })),
    daily,
  );
  const total = (year: number) => cmp.totals.find((t) => t.year === year);

  it('row 21 totals: income 3,209,240 · 3,672,286 · 6,537,706', () => {
    expect([2022, 2023, 2024].map((y) => total(y)?.amount)).toEqual(['3209240.00', '3672286.00', '6537706.00']);
  });
  it('footfall totals: adults 10,689 · 10,223 · 13,721; kids 6,722 · 4,514 · 8,147', () => {
    expect([2022, 2023, 2024].map((y) => [total(y)?.adults, total(y)?.kids])).toEqual([
      [10689, 6722],
      [10223, 4514],
      [13721, 8147],
    ]);
  });
  it('row 22 Avarage/Day for the full ten-day years: 320,924 and 367,228.60', () => {
    expect(total(2022)?.averagePerDay).toBe('320924.00');
    expect(total(2023)?.averagePerDay).toBe('367228.60');
  });
  it('2024 had seven days of sales: averaged over those (the sheet’s S22 rule), not ÷10 as F22 does', () => {
    expect(total(2024)?.daysWithSales).toBe(7);
    expect(total(2024)?.averagePerDay).toBe('933958.00');
    expect(cmp.rows[7].byYear[2024]).toEqual({ date: '2024-04-17', amount: null, adults: null, kids: null });
  });
  it('change on the year before: +3,498 adults (G27 “3500 Adult More”), +78.0% income (G30 says 44%)', () => {
    expect(total(2024)?.change).toEqual({ amount: '2865420.00', pct: '78.0', adults: 3498, kids: 3633 });
    expect(total(2022)?.change).toBeNull();
  });

  it('Panda Cafe, Eid-ul-Fitr 2024: S21 1,111,109, S22 = S21 / COUNT = 158,729.86', () => {
    const cafe = [77835, 120000, 235130, 259325, 279185, 55024, 84610];
    const m = new Map(cafe.map((amount, i) => [addDays('2024-04-10', i), { amount: String(amount), adults: 0, kids: 0 }]));
    const r = eventComparison(10, [{ year: 2024, startDate: '2024-04-10' }], m);
    expect(r.totals[0].amount).toBe('1111109.00');
    expect(r.totals[0].averagePerDay).toBe('158729.86');
  });

  it('Eid-ul-Azha zoo tickets: 2,132,210 → 2,177,130, “44920 more income in 2023” (G69)', () => {
    const azha = {
      2022: { start: '2022-07-10', income: [107760, 311680, 483510, 304860, 168820, 185950, 190140, 267560, 56730, 55200] },
      2023: { start: '2023-06-29', income: [77050, 390830, 442350, 365500, 110100, 117730, 150910, 109300, 220190, 193170] },
    };
    const m = new Map<string, DayFigures>();
    for (const y of Object.values(azha)) y.income.forEach((a, i) => m.set(addDays(y.start, i), { amount: String(a), adults: 0, kids: 0 }));
    const r = eventComparison(10, Object.entries(azha).map(([year, y]) => ({ year: Number(year), startDate: y.start })), m);
    expect(r.totals.map((t) => t.amount)).toEqual(['2132210.00', '2177130.00']);
    expect(r.totals.map((t) => t.averagePerDay)).toEqual(['213221.00', '217713.00']); // D59, E59
    expect(r.totals[1].change?.amount).toBe('44920.00');
  });

  it('an event must run 1–60 days', () => {
    expect(() => eventComparison(0, [], new Map())).toThrow();
  });
});

describe('rounding and percentages', () => {
  it('averages round half-up to the paisa, negatives away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });
  it('percent change to one decimal; nothing to compare against gives null', () => {
    expect(pctChange(653770600n, 367228600n)).toBe('78.0');
    expect(pctChange(90n, 100n)).toBe('-10.0');
    expect(pctChange(5n, 0n)).toBeNull();
  });
});

describe('year over year, month by month', () => {
  const amounts = [
    { date: '2025-01-05', amount: '1000' },
    { date: '2025-03-01', amount: '500' },
    { date: '2026-01-10', amount: '1500' },
    { date: '2026-03-20', amount: '100' },
  ];
  it('January +50%, March −80%, the year to date compares like with like', () => {
    const r = yearOverYear(2026, amounts, '2026-03-05');
    expect(r.months[0]).toMatchObject({ current: '1500.00', previous: '1000.00', change: '500.00', pct: '50.0' });
    expect(r.months[2]).toMatchObject({ current: '100.00', previous: '500.00', pct: '-80.0' });
    expect(r.current).toBe('1600.00');
    expect(r.previous).toBe('1500.00');
    // 1 Jan – 5 Mar: 1,500 against 1,500 (2025's 1 Mar counts; 2026's 20 Mar is still to come).
    expect(r.toDate).toEqual({ current: '1500.00', previous: '1500.00', pct: '0.0' });
  });
  it('a finished year has no to-date line', () => {
    expect(yearOverYear(2025, amounts, '2026-03-05').toDate).toBeNull();
  });
});

describe('a day’s sheet before posting', () => {
  it('the takings received must equal the sales', () => {
    expect(dayProblems([{ amount: '100' }], [{ accountId: 'cash', amount: '60' }, { accountId: 'wallet', amount: '40' }])).toEqual([]);
    expect(dayProblems([{ amount: '100' }], [{ accountId: 'cash', amount: '90' }])[0]).toMatch(/don’t match/);
    expect(dayProblems([], [])).toContain('Add at least one line.');
    expect(dayProblems([{ amount: '0' }], [])[0]).toMatch(/nothing/);
  });
});
