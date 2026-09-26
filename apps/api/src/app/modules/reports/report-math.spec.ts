import { AccountType } from '@multizoo/types';
import { toPaisa } from '@multizoo/utils';
import { buildPnl, partnerShares, partnerStatement, rootOf, shareOf, type PnlAccount, type PnlMovement } from './report-math';

const acc = (id: string, code: string, name: string, type: AccountType, parentId: string | null = null): PnlAccount => ({
  id,
  code,
  name,
  type,
  parentId,
});

const ACCOUNTS: PnlAccount[] = [
  acc('tickets', '4100', 'Ticket Sales', AccountType.INCOME),
  acc('rides', '4400', 'Ride & Attraction Sales', AccountType.INCOME),
  acc('feed', '5100', 'Animal Feed & Medicine', AccountType.EXPENSE),
  acc('carn', '5110', 'Carnivores', AccountType.EXPENSE, 'feed'),
  acc('med', '5160', 'Medicine', AccountType.EXPENSE, 'feed'),
  acc('util', '5300', 'Utilities', AccountType.EXPENSE),
  acc('cash', 'ZOO-1100', 'Cash in Hand', AccountType.ASSET),
];

const mv = (accountId: string, column: string, debit: string, credit = '0'): PnlMovement => ({ accountId, column, debit, credit });

describe('rootOf', () => {
  it('walks a sub-account up to its heading', () => {
    const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));
    expect(rootOf('carn', byId).code).toBe('5100');
    expect(rootOf('util', byId).code).toBe('5300');
  });
});

describe('buildPnl', () => {
  it('nets income and expenses per heading and column, with the sheet’s NET EFFECT', () => {
    const pnl = buildPnl(
      ACCOUNTS,
      [
        mv('tickets', 'ZOO', '0', '14739810'),
        mv('tickets', 'ZOO', '500'), // a refund nets off
        mv('carn', 'ZOO', '60000'),
        mv('med', 'ZOO', '11230'),
        mv('util', 'CAFE', '9000'),
        mv('rides', 'CAFE', '0', '20000'),
        mv('cash', 'ZOO', '14739310'), // not income or expense — ignored
        mv('tickets', 'GIFT', '0', '1'), // not a column — ignored
      ],
      ['ZOO', 'CAFE'],
    );
    expect(pnl.income.map((c) => [c.code, c.amounts.ZOO, c.amounts.CAFE, c.total])).toEqual([
      ['4100', '14739310.00', '0.00', '14739310.00'],
      ['4400', '0.00', '20000.00', '20000.00'],
    ]);
    const feed = pnl.expenses[0];
    expect([feed.code, feed.total]).toEqual(['5100', '71230.00']);
    expect(feed.accounts.map((a) => [a.code, a.total])).toEqual([
      ['5110', '60000.00'],
      ['5160', '11230.00'],
    ]);
    expect(pnl.expenses[1].accounts).toEqual([]); // posted to directly — no sub-lines
    expect(pnl.totalIncome.amounts).toEqual({ ZOO: '14739310.00', CAFE: '20000.00' });
    expect(pnl.totalExpenses.amounts).toEqual({ ZOO: '71230.00', CAFE: '9000.00' });
    expect(pnl.net.amounts).toEqual({ ZOO: '14668080.00', CAFE: '11000.00' });
    expect(pnl.net.total).toBe('14679080.00');
  });

  it('leaves out headings with nothing in them', () => {
    const pnl = buildPnl(ACCOUNTS, [mv('util', 'ZOO', '100'), mv('util', 'ZOO', '0', '100')], ['ZOO']);
    expect(pnl.expenses).toEqual([]);
    expect(pnl.net.total).toBe('0.00');
  });
});

/**
 * `Sample daily exp.xlsx` → MULTIZOO!AS8:BF28, "Profit and Loss Statement
 * of MULTI ZOO for the Year 2026": TOTAL SALES (AT11:BE11, the Ticket sales
 * sheet's M37:X37), Animal's Feed 71,230 in January, NET EFFECT = sales −
 * expenses, MIK PROFIT 70% and MQK PROFIT 30% (`=AT26*70/100`).
 */
describe('Parity — MULTIZOO P&L block (AS8:BF28)', () => {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const sales = ['14739810', '9036420', '14616690', '9938560', '9560770', '10971060', '14843988.5', '12341500', '2307550', '0', '0', '0'];
  const pnl = buildPnl(
    ACCOUNTS,
    [...months.map((m, i) => mv('tickets', m, '0', sales[i])), mv('carn', '01', '71230')],
    months,
  );

  it('TOTAL SALES, TOTAL EXPENSES and NET EFFECT', () => {
    expect(pnl.totalIncome.total).toBe('98356348.50'); // BF11
    expect(pnl.totalExpenses.amounts['01']).toBe('71230.00'); // AT25
    expect(pnl.net.amounts['01']).toBe('14668580.00'); // AT26
    expect(pnl.net.amounts['02']).toBe('9036420.00'); // AU26
    expect(pnl.net.total).toBe('98285118.50'); // BF26
  });

  it('MIK 70% / MQK 30% of the net, month by month', () => {
    const [mik, mqk] = partnerShares([
      { partnerId: 'MIK', weight: '70' },
      { partnerId: 'MQK', weight: '30' },
    ]);
    expect([mik.pct, mqk.pct]).toEqual(['70.00', '30.00']);
    expect(shareOf(pnl.net.amounts['01'], mik)).toBe('10268006.00'); // AT27
    expect(shareOf(pnl.net.amounts['01'], mqk)).toBe('4400574.00'); // AT28
    expect(shareOf(pnl.net.amounts['02'], mik)).toBe('6325494.00'); // AU27
    expect(shareOf(pnl.net.amounts['02'], mqk)).toBe('2710926.00'); // AU28

    const statement = partnerStatement(
      months.map((m) => ({ month: `2026-${m}`, net: { ZOO: pnl.net.amounts[m] } })),
      { ZOO: mik },
      new Map(),
    );
    expect(statement.profit).toBe('68799582.95'); // BF27
    const mqkYear = partnerStatement(
      months.map((m) => ({ month: `2026-${m}`, net: { ZOO: pnl.net.amounts[m] } })),
      { ZOO: mqk },
      new Map(),
    );
    expect(mqkYear.profit).toBe('29485535.55'); // BF28
  });
});

describe('partnerShares', () => {
  it('turns parts into shares that total 100% of the net', () => {
    const shares = partnerShares([
      { partnerId: 'MIK', weight: '1' },
      { partnerId: 'MQK', weight: '1' },
      { partnerId: 'HAIDER', weight: '1' },
    ]);
    expect(shares.map((s) => s.pct)).toEqual(['33.33', '33.33', '33.33']);
    expect(shareOf('100', shares[0])).toBe('33.33');
    expect(shareOf('-147137', shares[2])).toBe('-49045.67'); // a loss is shared too, rounded half away from zero
  });

  it('counts a partner in two tranches once', () => {
    const shares = partnerShares([
      { partnerId: 'A', weight: '25' },
      { partnerId: 'B', weight: '40' },
      { partnerId: 'A', weight: '15' },
    ]);
    expect(shares.map((s) => [s.partnerId, s.pct])).toEqual([
      ['A', '50.00'],
      ['B', '50.00'],
    ]);
  });

  it('is empty when no partner shares in the unit', () => {
    expect(partnerShares([])).toEqual([]);
  });
});

/**
 * `Sample cash flow.xlsx` → `Profit & Loss Statement` U1:W17, Haider Khan:
 * each month's third of Jungle Joys' net (V4:V15, imported from the gift
 * shop's row 24) against what he drew there (W4:W15, SUMIFS over his
 * profit account AA:AF — 1,223 + 1,254 in May, 154 in June, 5,426 in July).
 * V16 = 127,367.3333, W16 = 8,057, V17 = V16 − W16 = 119,310.3333.
 */
describe('Parity — Haider’s statement (Profit & Loss Statement!U1:W17)', () => {
  // Jungle Joys' monthly net, Jan–Sep 2026: three times V4:V12.
  const nets = ['177048', '26301', '169654', '138306', '-147137', '173886', '-27606', '-76941', '-51409', '0', '0', '0'];
  const haider = partnerShares([
    { partnerId: 'MIK', weight: '1' },
    { partnerId: 'MQK', weight: '1' },
    { partnerId: 'HAIDER', weight: '1' },
  ])[2];
  const drawings = new Map([
    ['2026-05|GIFT', toPaisa('1223') + toPaisa('1254')],
    ['2026-06|GIFT', toPaisa('154')],
    ['2026-07|GIFT', toPaisa('5426')],
  ]);
  const statement = partnerStatement(
    nets.map((net, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, net: { GIFT: net } })),
    { GIFT: haider },
    drawings,
  );

  it('each month’s share (V4:V15)', () => {
    expect(statement.months.map((m) => m.profit).slice(0, 9)).toEqual([
      '59016.00',
      '8767.00',
      '56551.33',
      '46102.00',
      '-49045.67',
      '57962.00',
      '-9202.00',
      '-25647.00',
      '-17136.33',
    ]);
  });

  it('drawn by month (W8:W10) and the year (W16)', () => {
    expect(statement.months[4].drawn).toBe('2477.00');
    expect(statement.months[5].drawn).toBe('154.00');
    expect(statement.months[6].drawn).toBe('5426.00');
    expect(statement.drawn).toBe('8057.00');
  });

  it('V16 and the balance V17 = V16 − W16, to the paisa', () => {
    expect(statement.profit).toBe('127367.33');
    expect(statement.balance).toBe('119310.33');
    expect(statement.byUnit.GIFT).toEqual({ profit: '127367.33', drawn: '8057.00', balance: '119310.33' });
  });

  it('a unit they drew in but have no share of still shows', () => {
    const s = partnerStatement([{ month: '2026-01', net: { GIFT: '300' } }], { GIFT: haider }, new Map([['2026-01|ZOO', toPaisa('50')]]));
    expect(s.units).toEqual(['GIFT', 'ZOO']);
    expect(s.byUnit.ZOO).toEqual({ profit: '0.00', drawn: '50.00', balance: '-50.00' });
    expect(s.balance).toBe('50.00');
  });
});
