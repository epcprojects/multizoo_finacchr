import { campaignStatement, CampaignLine, capexSummary, parsePaybackMonths, payback } from './capex-math';

/** Parity with `Sample cash flow.xlsx → Dir Invst Zoo` and `Ramazan 2023`. */

describe('Dir Invst Zoo — the investment log', () => {
  // A2:E10 (dates are the sheet's serials 45620 … 45642).
  const log = [
    ['2024-11-24', '219000', 'Boxing machine', '8 Months', 'Entertainment'],
    ['2024-11-25', '500000', 'Claw Machine', '8 Months', 'Entertainment'],
    ['2024-11-26', '500000', 'Riding Machine', '5 Months', 'Entertainment'],
    ['2024-11-27', '200000', 'Hammer Machine', '8 Months', 'Entertainment'],
    ['2024-11-28', '2700000', 'Train', '5 Months', 'Entertainment'],
    ['2024-11-29', '1200000', 'Take away cafe', '6 Months', 'Food'],
    ['2024-11-30', '600000', 'Event Booking Area', '8 Months', 'Service'],
    ['2024-12-01', '20000', 'Coffee take away ', '2 months', 'Food'],
    ['2024-12-16', '27000', 'Madam kiran', '', 'Ismail'],
  ] as const;
  const s = capexSummary(log.map(([purchaseDate, amount, , , nature]) => ({ purchaseDate, amount, nature, unit: 'ZOO' })));

  it('F2 Total Investment = SUM(B2:B1000) = 5,966,000', () => {
    expect(s.total).toBe('5966000.00');
    expect(s.count).toBe(9);
  });
  it('by nature: Entertainment 4,119,000 · Food 1,220,000 · Service 600,000 · “Ismail” 27,000', () => {
    expect(s.byNature).toEqual([
      { nature: 'Entertainment', amount: '4119000.00', count: 5 },
      { nature: 'Food', amount: '1220000.00', count: 2 },
      { nature: 'Service', amount: '600000.00', count: 1 },
      { nature: 'Ismail', amount: '27000.00', count: 1 },
    ]);
    expect(s.byYear).toEqual([{ year: '2024', amount: '5966000.00', count: 9 }]);
  });
  it('“Roi Time Expct” reads as months', () => {
    expect(log.map((r) => parsePaybackMonths(r[3]))).toEqual([8, 8, 5, 8, 5, 6, 8, 2, null]);
    expect(parsePaybackMonths('1 year')).toBe(12);
  });
});

describe('payback — the ROI window as a date, and what the item has earned back', () => {
  const boxing = { cost: '219000', purchaseDate: '2024-11-24', paybackMonths: 8 };

  it('8 months from 24 Nov 2024 is 24 Jul 2025; halfway there, half the cost is expected', () => {
    const r = payback({ ...boxing, earnings: [], today: '2025-03-25' });
    expect(r.expectedBy).toBe('2025-07-24');
    // 121 of 242 days gone.
    expect(r.expectedSoFar).toBe('109500.00');
    expect(r.state).toBe('BEHIND');
    expect(r.recovered).toBe('0.00');
    expect(r.remaining).toBe('219000.00');
  });

  it('ahead of the straight line is on track; reaching the cost is paid back, on the day it happened', () => {
    const earnings = [
      { date: '2024-12-31', amount: '80000' },
      { date: '2025-01-31', amount: '80000' },
      { date: '2025-02-28', amount: '80000' },
    ];
    expect(payback({ ...boxing, earnings: earnings.slice(0, 2), today: '2025-02-01' })).toMatchObject({ state: 'ON_TRACK', recovered: '160000.00', recoveredPct: '73.1' });
    expect(payback({ ...boxing, earnings, today: '2025-03-01' })).toMatchObject({
      state: 'PAID_BACK',
      paidBackOn: '2025-02-28',
      recovered: '240000.00',
      remaining: '0.00',
      recoveredPct: '109.6',
    });
  });

  it('past the date without earning it back is overdue; takings before the purchase don’t count', () => {
    const r = payback({ ...boxing, earnings: [{ date: '2024-11-01', amount: '500000' }, { date: '2025-01-01', amount: '1000' }], today: '2025-08-01' });
    expect(r.state).toBe('OVERDUE');
    expect(r.recovered).toBe('1000.00');
    expect(r.expectedSoFar).toBe('219000.00');
  });

  it('nothing linked on the price list: not tracked, but the target date still shows', () => {
    const r = payback({ ...boxing, earnings: null, today: '2025-01-01' });
    expect(r.state).toBe('NOT_TRACKED');
    expect(r.recovered).toBeNull();
    expect(r.expectedBy).toBe('2025-07-24');
  });

  it('no target: earning, but nothing to be on track for', () => {
    expect(payback({ cost: '27000', purchaseDate: '2024-12-16', paybackMonths: null, earnings: [{ date: '2025-01-01', amount: '1' }], today: '2025-02-01' }).state).toBe('NO_TARGET');
  });
});

describe('Ramazan 2023 — a standalone campaign P&L', () => {
  // C5:C10 — received for the drive.
  const received: [string, string, string][] = [
    ['2023-03-22', '80000', 'Received from Taouqeer Ali'],
    ['2023-03-22', '200000', 'Received From Ibrahim khan via MYK to Umer'],
    ['2023-04-06', '15500', 'Received from Ibrar Hussain'],
    ['2023-04-11', '100000', 'Received From Ibrahim khan via MYK to Umer'],
    ['2023-04-13', '90000', 'Received From Ibrahim khan via MYK to Umer'],
    ['2023-04-20', '250000', 'Received From Ibrahim khan via MYK to Umer'],
  ];
  // D13:D46 — issued for it (A = date).
  const issued: [string, string, string][] = [
    ['2023-03-22', '50000', 'Raw material'], ['2023-03-25', '30000', 'Raw material'], ['2023-03-25', '20000', 'Biryani'],
    ['2023-03-26', '10000', 'Biryani'], ['2023-03-27', '25000', 'Cash to cooks'], ['2023-03-28', '30000', 'Cash to cooks'],
    ['2023-03-28', '25000', 'Cash to cooks'], ['2023-03-29', '20000', 'Cash to cooks'], ['2023-04-01', '40000', 'Cash to cooks'],
    ['2023-04-02', '15000', 'Cash to cooks'], ['2023-04-03', '15000', 'Cash to cooks'], ['2023-04-04', '20000', 'Cash to cooks'],
    ['2023-04-05', '20000', 'Cash to cooks'], ['2023-04-08', '15500', 'Cash to cooks'], ['2023-04-08', '45000', 'Cash to cooks'],
    ['2023-04-08', '25000', 'Cash to cooks'], ['2023-04-08', '73000', 'Biryani'], ['2023-04-09', '30000', 'Cash to cooks'],
    ['2023-04-09', '5813', 'Family rations'], ['2023-04-09', '14000', 'Family rations'], ['2023-04-09', '20000', 'Cash to cooks'],
    ['2023-04-11', '30000', 'Cash to cooks'], ['2023-04-12', '20000', 'Cash to cooks'], ['2023-04-13', '16000', 'Gas'],
    ['2023-04-13', '20000', 'Cash to cooks'], ['2023-04-15', '40000', 'Cash to cooks'], ['2023-04-16', '20000', 'Cash to cooks'],
    ['2023-04-17', '20000', 'Cash to cooks'], ['2023-04-18', '33000', 'Cash to cooks'], ['2023-04-18', '20000', 'Cash to cooks'],
    ['2023-04-18', '20000', 'Cash to cooks'], ['2023-04-19', '17000', 'Gas'], ['2023-04-19', '50000', 'Cash to cooks'],
    ['2023-04-29', '11250', 'Cash to cooks'],
  ];
  const lines: CampaignLine[] = [
    ...received.map(([date, amount]) => ({ date, amount, type: 'INCOME' as const, category: 'Donations' })),
    ...issued.map(([date, amount, category]) => ({ date, amount, type: 'EXPENSE' as const, category })),
  ];
  // O7:O11 — "Total Amount Required For 30 Days @25000" and the rest.
  const budget = [
    { label: 'Iftari & sehri, 30 days @ 25,000', amount: '750000' },
    { label: '1 family ration packet', amount: '5313' },
    { label: 'Cash given to Qasim Khan', amount: '33000' },
    { label: 'Cash given to Qasim Khan', amount: '20000' },
    { label: 'Gas cylinder payment', amount: '33000' },
  ];
  const s = campaignStatement(lines, budget);

  it('C2 Total income 735,500 · D2 Total expenses 865,563 · C3 Balance −130,063', () => {
    expect(s.income).toBe('735500.00');
    expect(s.expenses).toBe('865563.00');
    expect(s.balance).toBe('-130063.00');
  });

  it('the running balance ends on C3, and the drive was 17.7% over what it raised', () => {
    expect(s.byDate[0]).toEqual({ date: '2023-03-22', income: '280000.00', expenses: '50000.00', balance: '230000.00' });
    expect(s.byDate[s.byDate.length - 1].balance).toBe('-130063.00');
    expect(s.overRaisedPct).toBe('17.7');
  });

  it('O12 the budget, 841,313; still to raise 105,813 (the sheet’s O20 355,813 misses the 250,000 of 20 Apr)', () => {
    expect(s.budget).toEqual({ total: '841313.00', stillToRaise: '105813.00', left: '-24250.00', spentPct: '102.9' });
  });

  it('spending by category, largest first, adding back up to D2', () => {
    expect(s.expensesByCategory).toEqual([
      { category: 'Cash to cooks', amount: '629750.00' },
      { category: 'Biryani', amount: '103000.00' },
      { category: 'Raw material', amount: '80000.00' },
      { category: 'Gas', amount: '33000.00' },
      { category: 'Family rations', amount: '19813.00' },
    ]);
    expect(s.incomeByCategory).toEqual([{ category: 'Donations', amount: '735500.00' }]);
  });

  it('no budget, no budget block', () => {
    expect(campaignStatement(lines).budget).toBeNull();
  });
});
