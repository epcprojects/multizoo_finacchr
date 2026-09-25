import { rollupCostCentre, CostCentreLine } from './cost-centre-math';

/**
 * Parity with `342 Expense` → "342 Media Office Expenses (Paid from Zoo MIK
 * Profit)", the right-hand block the sheet totals by category.
 */
describe('342 Media Office — by category (342 Expense, columns G–J)', () => {
  const MIK = 'MIK';
  const row = (date: string, category: string, amount: string): CostCentreLine => ({
    month: `${date.slice(6)}-${date.slice(3, 5)}`,
    category,
    amount,
    chargedTo: MIK,
  });
  const lines: CostCentreLine[] = [
    // Transport & Food
    row('06-07-2026', 'Transport & Food', '11000'),
    row('07-07-2026', 'Transport & Food', '750'),
    row('07-07-2026', 'Transport & Food', '800'),
    row('08-07-2026', 'Transport & Food', '1070'),
    row('08-07-2026', 'Transport & Food', '3080'),
    row('08-07-2026', 'Transport & Food', '250'),
    row('11-07-2026', 'Transport & Food', '1800'),
    row('18-07-2026', 'Transport & Food', '5000'),
    row('18-07-2026', 'Transport & Food', '3000'),
    // Development
    row('08-07-2026', 'Development', '160000'),
    row('11-07-2026', 'Development', '2500'),
    row('11-07-2026', 'Development', '23500'),
    row('14-07-2026', 'Development', '5000'),
    row('14-07-2026', 'Development', '209600'), // =…−35000
    row('15-07-2026', 'Development', '26400'),
    row('16-07-2026', 'Development', '69000'),
    // Assets
    row('08-07-2026', 'Assets', '265500'),
    row('20-07-2026', 'Assets', '284000'),
  ];

  it('category totals: J14 26,750 · J23 496,000 · J27 549,500', () => {
    const r = rollupCostCentre(lines);
    expect(Object.fromEntries(r.byCategory.map((c) => [c.category, c.amount]))).toEqual({
      'Transport & Food': '26750.00',
      Development: '496000.00',
      Assets: '549500.00',
    });
  });

  it('grand total J28 = 1,072,250, all of it charged to MIK’s profit', () => {
    const r = rollupCostCentre(lines);
    expect(r.total).toBe('1072250.00');
    expect(r.byCharge).toEqual([{ chargedTo: MIK, amount: '1072250.00' }]);
    expect(r.byMonth).toEqual([
      expect.objectContaining({ month: '2026-07', amount: '1072250.00' }),
    ]);
  });

  it('a reversal nets out of its category and month', () => {
    const r = rollupCostCentre([...lines, { ...row('21-07-2026', 'Assets', '-284000'), month: '2026-08' }]);
    expect(r.byCategory.find((c) => c.category === 'Assets')?.amount).toBe('265500.00');
    expect(r.byMonth.map((m) => [m.month, m.amount])).toEqual([
      ['2026-07', '1072250.00'],
      ['2026-08', '-284000.00'],
    ]);
  });

  it('spending on the unit’s own P&L and a partner’s are kept apart', () => {
    const r = rollupCostCentre([
      { month: '2026-07', category: 'Marketing', amount: '220000', chargedTo: null },
      { month: '2026-07', category: 'Marketing', amount: '1000', chargedTo: MIK },
    ]);
    expect(r.byCharge).toEqual([
      { chargedTo: null, amount: '220000.00' },
      { chargedTo: MIK, amount: '1000.00' },
    ]);
  });
});
