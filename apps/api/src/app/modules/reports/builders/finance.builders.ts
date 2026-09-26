import { BadRequestException } from '@nestjs/common';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { Content } from 'pdfmake/interfaces';
import {
  date,
  dateRange,
  details,
  heading,
  indented,
  money,
  moneyOrBlank,
  MONTH_SHORT,
  monthName,
  note,
  paragraph,
  table,
  type Cell,
  type Column,
} from '../pdf/pdf-kit';
import type { PnlStatement } from '../report-math';
import { shareOf } from '../report-math';
import { coveredUnits, headline, slug, type BuildContext, type BuiltReport } from './types';

const need = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null || value === '') throw new BadRequestException(`Pick ${what}.`);
  return value;
};

/**
 * Headings × columns as table rows: income, its total, expenses, their
 * total, the net. Sub-accounts are indented under their heading.
 */
function pnlRows(st: PnlStatement, cols: string[], withTotal: boolean, blankZeros = false) {
  const rows: Cell[][] = [];
  const headingRows: number[] = [];
  const pad = (n: number) => Array(n).fill('');
  const width = cols.length + (withTotal ? 1 : 0);
  const cells = (amounts: Record<string, string>, total: string, blank = blankZeros) => [
    ...cols.map((c) => (blank ? moneyOrBlank(amounts[c]) : money(amounts[c] ?? '0'))),
    ...(withTotal ? [money(total)] : []),
  ];
  const block = (label: string, cats: PnlStatement['income'], total: PnlStatement['totalIncome']) => {
    headingRows.push(rows.length);
    rows.push([label, ...pad(width)]);
    if (!cats.length) rows.push([{ text: 'Nothing recorded', italics: true, color: '#7C8A82' }, ...pad(width)]);
    for (const cat of cats) {
      rows.push([cat.accounts.length ? { text: `${cat.code}  ${cat.name}`, bold: true } : `${cat.code}  ${cat.name}`, ...cells(cat.amounts, cat.total)]);
      for (const a of cat.accounts) rows.push([indented(a.name), ...cells(a.amounts, a.total)]);
    }
    headingRows.push(rows.length);
    rows.push([total.name, ...cells(total.amounts, total.total, false)]);
  };
  block('Income', st.income, st.totalIncome);
  block('Expenses', st.expenses, st.totalExpenses);
  headingRows.push(rows.length);
  rows.push([st.net.name, ...cells(st.net.amounts, st.net.total, false)]);
  return { rows, headingRows };
}

// --- Daily cash position ------------------------------------------------------------------

export async function cashPosition(ctx: BuildContext): Promise<BuiltReport> {
  const asOf = need(ctx.params.asOf, 'a date');
  const unitId = ctx.params.businessUnitId;
  const pos = await ctx.src.ledger.cashPosition(ctx.user, asOf);
  const units = unitId ? pos.units.filter((u) => u.id === unitId) : pos.units;
  if (unitId && !units.length) throw new BadRequestException('You do not have access to this business unit');
  const sum = (f: (u: (typeof units)[number]) => string) => fromPaisa(units.reduce((s, u) => s + toPaisa(f(u)), 0n));
  const byClass = Object.fromEntries(pos.classes.map((c) => [c.id, sum((u) => u.byClass[c.id] ?? '0')]));
  const total = sum((u) => u.total);
  const inflow = sum((u) => u.inflow);
  const outflow = sum((u) => u.outflow);

  const columns: Column[] = [
    { header: 'Unit', width: '*' },
    ...pos.classes.map((c) => ({ header: c.name, width: 62, align: 'right' as const })),
    { header: 'Total', width: 68, align: 'right' },
    { header: 'In today', width: 58, align: 'right' },
    { header: 'Out today', width: 58, align: 'right' },
  ];
  const content: Content[] = [
    headline(ctx, [
      { label: 'Money on hand', value: money(total), tone: 'accent' },
      ...pos.classes.map((c) => ({ label: c.name, value: money(byClass[c.id]) })),
      { label: 'Money in today', value: money(inflow) },
      { label: 'Money out today', value: money(outflow) },
    ]),
    heading('By unit', `Balances at the end of ${date(asOf)}. Transfers between a unit’s own accounts net to nothing; opening balances aren’t counted as the day’s money.`),
    table({
      columns,
      rows: units.map((u) => [
        `${u.code} — ${u.name}`,
        ...pos.classes.map((c) => money(u.byClass[c.id] ?? '0')),
        { text: money(u.total), bold: true },
        money(u.inflow),
        money(u.outflow),
      ]),
      totals: units.length > 1 ? [['All units', ...pos.classes.map((c) => money(byClass[c.id])), money(total), money(inflow), money(outflow)]] : [],
      empty: 'No units to show.',
    }),
    heading('Accounts'),
    table({
      columns: [
        { header: 'Unit', width: 50 },
        { header: 'Code', width: 70 },
        { header: 'Account', width: '*' },
        { header: 'Balance', width: 80, align: 'right' },
      ],
      rows: units.flatMap((u) =>
        u.accounts.map((a) => [u.code, a.code, a.isActive ? a.name : `${a.name} (inactive)`, money(a.balance)]),
      ),
      empty: 'No cash, bank or wallet accounts.',
    }),
  ];
  return {
    subtitle: `${date(asOf)} · ${unitId ? units[0].name : ctx.scopeName}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: asOf,
    periodTo: asOf,
    fileStem: `cash-position-${asOf}${unitId ? `-${units[0].code.toLowerCase()}` : ''}`,
  };
}

// --- Expense report by category ------------------------------------------------------------

export async function expenses(ctx: BuildContext): Promise<BuiltReport> {
  const from = need(ctx.params.from, 'a start date');
  const to = need(ctx.params.to, 'an end date');
  const unitId = ctx.params.businessUnitId;
  const data = await ctx.src.financial.expenses(ctx.user, from, to, unitId);
  const st = data.statement;
  const shown = data.units.filter((u) => st.expenses.length === 0 || toPaisa(st.totalExpenses.amounts[u.id] ?? '0') !== 0n || data.units.length === 1);
  const cols = shown.map((u) => u.id);
  const many = cols.length > 1;

  const rows: Cell[][] = [];
  for (const cat of st.expenses) {
    rows.push([
      { text: `${cat.code}  ${cat.name}`, bold: cat.accounts.length > 0 },
      ...(many ? cols.map((c) => money(cat.amounts[c])) : []),
      money(many ? cat.total : cat.amounts[cols[0]]),
    ]);
    for (const a of cat.accounts) {
      rows.push([indented(a.name), ...(many ? cols.map((c) => money(a.amounts[c])) : []), money(many ? a.total : a.amounts[cols[0]])]);
    }
  }
  const total = many ? st.totalExpenses.total : (st.totalExpenses.amounts[cols[0]] ?? '0.00');
  const content: Content[] = [
    headline(ctx, [
      { label: 'Spent', value: money(total), tone: 'accent' },
      { label: 'Expense lines', value: String(data.lines.length) },
      { label: 'Headings', value: String(st.expenses.length) },
      { label: 'Days', value: String(Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1) },
    ]),
    heading('By account title', 'Heading (account title) and the sub-titles under it — refunds and reversals net off.'),
    table({
      columns: [
        { header: 'Account title', width: '*' },
        ...(many ? shown.map((u) => ({ header: u.code, width: 52, align: 'right' as const })) : []),
        { header: 'Total', width: 64, align: 'right' },
      ],
      rows,
      totals: rows.length ? [['Total spent', ...(many ? cols.map((c) => money(st.totalExpenses.amounts[c])) : []), money(total)]] : [],
      fontSize: many && cols.length > 5 ? 7 : 8,
      empty: 'Nothing was spent in this period.',
    }),
    heading('Every expense line'),
    table({
      columns: [
        { header: 'Date', width: 44 },
        { header: 'Entry', width: 46 },
        { header: 'Unit', width: 34 },
        { header: 'Title / sub-title', width: 110 },
        { header: 'Description', width: '*' },
        { header: 'Amount', width: 58, align: 'right' },
      ],
      rows: data.lines.map((l) => [
        date(l.date),
        l.entryNo,
        l.unit,
        l.subCategory ? `${l.category} › ${l.subCategory}` : l.category,
        l.crossCharge ? `${l.description} (charged to partner${l.costCentre ? `, ${l.costCentre}` : ''})` : l.costCentre ? `${l.description} [${l.costCentre}]` : l.description,
        money(l.amount),
      ]),
      fontSize: 7.5,
      empty: 'No expense lines.',
    }),
  ];
  const unitName = unitId ? (data.units[0]?.name ?? '') : ctx.scopeName;
  return {
    subtitle: `${dateRange(from, to)} · ${unitName}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: from,
    periodTo: to,
    fileStem: `expenses-${from}${from === to ? '' : `-to-${to}`}${unitId ? `-${slug(data.units[0]?.code ?? '')}` : ''}`,
  };
}

// --- Monthly category rollup --------------------------------------------------------------------

export async function categoryRollup(ctx: BuildContext): Promise<BuiltReport> {
  const year = need(ctx.params.year, 'a year');
  const unitId = ctx.params.businessUnitId;
  const data = await ctx.src.financial.pnlByMonth(ctx.user, year, unitId);
  const { rows, headingRows } = pnlRows(data.statement, data.months, true, true);
  for (const p of data.partnerShares.filter((x) => toPaisa(x.total) !== 0n)) {
    rows.push([{ text: `${p.partner}’s share`, italics: true }, ...data.months.map((m) => moneyOrBlank(p.amounts[m])), money(p.total)]);
  }
  const unitName = unitId ? (data.units[0]?.name ?? '') : `${ctx.scopeName} together`;
  const content: Content[] = [
    headline(ctx, [
      { label: 'Income', value: money(data.statement.totalIncome.total) },
      { label: 'Expenses', value: money(data.statement.totalExpenses.total) },
      { label: 'Net', value: money(data.statement.net.total), tone: toPaisa(data.statement.net.total) < 0n ? 'danger' : 'accent' },
    ]),
    table({
      columns: [
        { header: 'Description', width: 128 },
        ...MONTH_SHORT.map((m) => ({ header: m, width: '*', align: 'right' as const })),
        { header: `Total ${year}`, width: 58, align: 'right' },
      ],
      rows,
      headingRows,
      fontSize: 6.5,
    }),
    paragraph(
      'The daily-expense tabs’ “Profit and Loss Statement” block: sales less each expense heading is the net effect; each partner’s share is the net times their share in the unit’s allocation rule in force at the end of that month.',
    ),
  ];
  return {
    subtitle: `${year} · ${unitName}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: `${year}-01-01`,
    periodTo: `${year}-12-31`,
    fileStem: `category-rollup-${year}${unitId ? `-${slug(data.units[0]?.code ?? '')}` : ''}`,
  };
}

// --- Profit & loss -----------------------------------------------------------------------------

export async function pnl(ctx: BuildContext): Promise<BuiltReport> {
  const from = need(ctx.params.from, 'a start date');
  const to = need(ctx.params.to, 'an end date');
  const unitId = ctx.params.businessUnitId;
  const data = await ctx.src.financial.pnlByUnit(ctx.user, from, to, unitId);
  const cols = data.units.map((u) => u.id);
  const many = cols.length > 1;
  const { rows, headingRows } = pnlRows(data.statement, cols, many);

  // Each partner's share of each unit's net, from the unit's rule on the last day.
  const partnerIds = [...new Set([...data.shares.values()].flat().map((s) => s.partnerId))];
  for (const pid of partnerIds) {
    const amounts = cols.map((c) => {
      const share = data.shares.get(c)?.find((s) => s.partnerId === pid);
      return share ? shareOf(data.statement.net.amounts[c], share) : null;
    });
    const total = fromPaisa(amounts.reduce((s, a) => s + (a ? toPaisa(a) : 0n), 0n));
    rows.push([
      { text: `${data.partners.get(pid)?.name ?? 'Partner'}’s share`, italics: true },
      ...amounts.map((a) => (a === null ? '' : money(a))),
      ...(many ? [money(total)] : []),
    ]);
  }
  const shareNotes = cols
    .map((c) => {
      const list = data.shares.get(c) ?? [];
      if (!list.length) return null;
      const code = data.units.find((u) => u.id === c)?.code;
      return `${code} ${list.map((s) => `${data.partners.get(s.partnerId)?.shortName ?? '?'} ${s.pct}%`).join(' / ')}`;
    })
    .filter(Boolean);

  const net = data.statement.net.total;
  const content: Content[] = [
    headline(ctx, [
      { label: 'Income', value: money(data.statement.totalIncome.total) },
      { label: 'Expenses', value: money(data.statement.totalExpenses.total) },
      { label: unitId ? 'Net profit' : 'Consolidated net profit', value: money(net), tone: toPaisa(net) < 0n ? 'danger' : 'accent' },
    ]),
    table({
      columns: [
        { header: 'Account', width: many ? 150 : '*' },
        ...data.units.map((u) => ({ header: u.code, width: many ? '*' : 90, align: 'right' as const })),
        ...(many ? [{ header: 'Consolidated', width: 72, align: 'right' as const }] : []),
      ],
      rows,
      headingRows,
      fontSize: cols.length > 6 ? 6.5 : 7.5,
    }),
    ...(shareNotes.length ? [note(`Partner shares of each unit’s net, from its allocation rule in force on ${date(to)}: ${shareNotes.join(' · ')}.`)] : []),
    paragraph(
      'Income and expense accounts only. Reserve earmarks, loans, partner drawings and campaign funds are balance-sheet movements and don’t appear here. Spending a cost centre charges to a partner is taken off the paying unit’s expenses.',
    ),
  ];
  const unitName = unitId ? (data.units[0]?.name ?? '') : 'Consolidated and per unit';
  const isMonth = from.slice(8) === '01' && to.slice(0, 7) === from.slice(0, 7);
  return {
    subtitle: `${isMonth ? monthName(from.slice(0, 7)) : dateRange(from, to)} · ${unitName}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: from,
    periodTo: to,
    fileStem: `pnl-${isMonth ? from.slice(0, 7) : `${from}-to-${to}`}${unitId ? `-${slug(data.units[0]?.code ?? '')}` : ''}`,
  };
}

// --- Partner statement -------------------------------------------------------------------------

export async function partnerStatement(ctx: BuildContext): Promise<BuiltReport> {
  const partnerId = need(ctx.params.partnerId, 'a partner');
  const year = need(ctx.params.year, 'a year');
  const data = await ctx.src.financial.partnerStatement(ctx.user, partnerId, year);
  const st = data.statement;
  const code = (id: string) => data.units.find((u) => u.id === id)?.code ?? '';

  const content: Content[] = [
    headline(ctx, [
      { label: 'Share of profit', value: money(st.profit) },
      { label: 'Drawn', value: money(st.drawn) },
      { label: 'Balance', value: money(st.balance), tone: toPaisa(st.balance) < 0n ? 'danger' : 'accent' },
      ...(data.equityBalance !== null ? [{ label: 'Capital & current account', value: money(data.equityBalance) }] : []),
    ]),
    heading('By unit', `Share of each unit’s net profit, less what was drawn against it, ${year}${data.through < `${year}-12-31` ? ` to ${date(data.through)}` : ''}.`),
    table({
      columns: [
        { header: 'Unit', width: '*' },
        { header: 'Share', width: 50, align: 'right' },
        { header: 'Profit', width: 80, align: 'right' },
        { header: 'Drawn', width: 80, align: 'right' },
        { header: 'Balance', width: 80, align: 'right' },
      ],
      rows: st.units.map((u) => [
        `${code(u)} — ${data.units.find((x) => x.id === u)?.name ?? ''}`,
        data.pctByUnit[u] ? `${data.pctByUnit[u]}%` : '—',
        money(st.byUnit[u].profit),
        money(st.byUnit[u].drawn),
        money(st.byUnit[u].balance),
      ]),
      totals: [['Yearly total', '', money(st.profit), money(st.drawn), money(st.balance)]],
      empty: 'No share in any unit this year.',
    }),
  ];
  // A unit with nothing in it all year needs no month-by-month table.
  for (const u of st.units.filter((x) => toPaisa(st.byUnit[x].profit) !== 0n || toPaisa(st.byUnit[x].drawn) !== 0n)) {
    let running = 0n;
    content.push(
      heading(`${code(u)} — month by month`),
      table({
        columns: [
          { header: 'Month', width: '*' },
          { header: 'Profit', width: 90, align: 'right' },
          { header: 'Drawn', width: 90, align: 'right' },
          { header: 'Balance to date', width: 90, align: 'right' },
        ],
        rows: st.months.map((m) => {
          const cell = m.byUnit[u];
          running += toPaisa(cell.profit) - toPaisa(cell.drawn);
          return [monthName(m.month), money(cell.profit), money(cell.drawn), money(fromPaisa(running))];
        }),
        totals: [['Total', money(st.byUnit[u].profit), money(st.byUnit[u].drawn), money(st.byUnit[u].balance)]],
      }),
    );
  }
  content.push(
    heading('Drawings and charges', 'Everything debited or credited to the partner’s capital & current account this year: cash drawn, bills charged to their profit, set-offs.'),
    table({
      columns: [
        { header: 'Date', width: 48 },
        { header: 'Entry', width: 46 },
        { header: 'Unit', width: 36 },
        { header: 'Description', width: '*' },
        { header: 'Debit', width: 60, align: 'right' },
        { header: 'Credit', width: 60, align: 'right' },
        { header: 'Drawn to date', width: 64, align: 'right' },
      ],
      rows: data.movements.map((mv) => [
        date(mv.date),
        mv.entryNo,
        mv.unit,
        mv.description,
        toPaisa(mv.debit) ? money(mv.debit) : '',
        toPaisa(mv.credit) ? money(mv.credit) : '',
        money(mv.drawn),
      ]),
      fontSize: 7.5,
      empty: 'Nothing drawn this year.',
    }),
  );
  if (data.reserves.length) {
    content.push(
      heading('Earmarked in profit reserves', `The daily waterfall’s partner share, set aside in each unit — at ${date(data.through)}.`),
      table({
        columns: [
          { header: 'Unit', width: 50 },
          { header: 'Reserve', width: '*' },
          { header: 'Balance', width: 90, align: 'right' },
        ],
        rows: data.reserves.map((r) => [r.unit, r.name, money(r.balance)]),
      }),
    );
  }
  content.push(
    paragraph(
      'Profit is each unit’s monthly net (income less expenses) times the partner’s share in that unit’s allocation rule in force at the month’s end. Drawn is the net debit to their capital & current account in the unit; opening balances aren’t counted.',
    ),
  );
  return {
    subtitle: `${data.partner.name} (${data.partner.shortName}) · ${year}`,
    content,
    unitIds: [],
    periodFrom: `${year}-01-01`,
    periodTo: data.through,
    fileStem: `partner-statement-${slug(data.partner.shortName)}-${year}`,
  };
}

// --- Loans --------------------------------------------------------------------------------

const DIRECTION: Record<string, string> = { RECEIVABLE: 'They owe us', PAYABLE: 'We owe them' };
const METHOD: Record<string, string> = { CASH: 'Cash', ON_ACCOUNT: 'On account', PROFIT_SETOFF: 'Profit set-off', OPENING: 'Opening' };

export async function loans(ctx: BuildContext): Promise<BuiltReport> {
  const counterpartyId = ctx.params.counterpartyId;
  if (counterpartyId) {
    const s = await ctx.src.loans.counterpartyStatement(counterpartyId, ctx.user);
    const net = s.totals.net;
    const content: Content[] = [
      headline(ctx, [
        { label: 'Loans, net', value: money(s.totals.loansNet) },
        { label: 'Staff advances', value: money(s.totals.staffAdvances) },
        {
          label: toPaisa(net) >= 0n ? 'They owe us' : 'We owe them',
          value: money(fromPaisa(toPaisa(net) < 0n ? -toPaisa(net) : toPaisa(net))),
          tone: 'accent',
        },
      ]),
      heading('Loans'),
      table({
        columns: [
          { header: 'Loan', width: 50 },
          { header: 'Unit', width: 36 },
          { header: 'Which way', width: 64 },
          { header: 'Purpose', width: '*' },
          { header: 'Status', width: 52 },
          { header: 'Principal', width: 62, align: 'right' },
          { header: 'Repaid', width: 62, align: 'right' },
          { header: 'Outstanding', width: 62, align: 'right' },
        ],
        rows: s.loans.map((l) => [
          l.loanNo,
          l.businessUnit.code,
          DIRECTION[l.direction] ?? l.direction,
          l.purpose,
          l.status.replace('_', ' ').toLowerCase(),
          money(l.principal),
          money(l.repaid),
          money(l.outstanding),
        ]),
        fontSize: 7.5,
        empty: 'No loans.',
      }),
      heading('Every movement', 'Positive: they owe us more; negative: we owe them more.'),
      table({
        columns: [
          { header: 'Date', width: 48 },
          { header: 'Loan', width: 50 },
          { header: 'Description', width: '*' },
          { header: 'How', width: 58 },
          { header: 'Amount', width: 62, align: 'right' },
          { header: 'Net after', width: 66, align: 'right' },
        ],
        rows: s.movements.map((mv) => [
          date(mv.date),
          `${mv.loan.loanNo} ${mv.loan.unit}`,
          mv.description,
          METHOD[mv.method] ?? mv.method,
          `${mv.effect === 'DECREASE' ? '−' : ''}${money(mv.amount)}`,
          money(mv.net),
        ]),
        fontSize: 7.5,
        empty: 'No movements.',
      }),
    ];
    if (s.staffAdvances.length) {
      content.push(
        heading('Salary advances'),
        table({
          columns: [
            { header: 'Issued', width: 50 },
            { header: 'Reason', width: '*' },
            { header: 'Status', width: 64 },
            { header: 'Amount', width: 62, align: 'right' },
            { header: 'Recovered', width: 62, align: 'right' },
            { header: 'Outstanding', width: 62, align: 'right' },
          ],
          rows: s.staffAdvances.map((a) => [
            date(a.issueDate),
            a.reason,
            a.status.replace('_', ' ').toLowerCase(),
            money(a.amount),
            money(a.recovered),
            money(a.outstanding),
          ]),
          fontSize: 7.5,
        }),
      );
    }
    return {
      subtitle: `${s.counterparty.name} · at ${date(businessDate())}`,
      content,
      unitIds: [...new Set(s.loans.map((l) => l.businessUnit.id))],
      fileStem: `loan-statement-${slug(s.counterparty.name)}`,
    };
  }

  const [list, stats] = await Promise.all([ctx.src.loans.list({}, ctx.user), ctx.src.loans.stats(ctx.user)]);
  const open = list.filter((l) => l.status === 'ACTIVE' || l.status === 'PENDING_APPROVAL');
  const content: Content[] = [
    headline(ctx, [
      { label: 'Owed to us', value: money(stats.owedToUs), tone: 'accent' },
      { label: 'We owe', value: money(stats.weOwe) },
      { label: 'Inter-unit open', value: money(stats.interUnitOpen) },
      { label: 'Staff advances', value: money(stats.staffAdvances) },
    ]),
    heading('Open loans', 'Active loans and those awaiting a Partner’s approval.'),
    table({
      columns: [
        { header: 'Loan', width: 48 },
        { header: 'Counterparty', width: 100 },
        { header: 'Unit', width: 34 },
        { header: 'Which way', width: 60 },
        { header: 'Purpose', width: '*' },
        { header: 'Principal', width: 60, align: 'right' },
        { header: 'Repaid', width: 60, align: 'right' },
        { header: 'Outstanding', width: 62, align: 'right' },
      ],
      rows: open.map((l) => [
        l.loanNo,
        l.counterparty?.name ?? '—',
        l.businessUnit?.code ?? '',
        DIRECTION[l.direction] ?? l.direction,
        l.status === 'PENDING_APPROVAL' ? `${l.purpose} (awaiting approval)` : l.purpose,
        money(l.principal),
        money(l.repaid),
        money(l.outstanding),
      ]),
      fontSize: 7.5,
      empty: 'No open loans.',
    }),
  ];
  return {
    subtitle: `All counterparties · at ${date(businessDate())}`,
    content,
    unitIds: coveredUnits(ctx),
    fileStem: 'loans-summary',
  };
}

// --- Cost centre ----------------------------------------------------------------------------

export async function costCentre(ctx: BuildContext): Promise<BuiltReport> {
  const id = need(ctx.params.costCentreId, 'a cost centre');
  const from = ctx.params.from;
  const to = ctx.params.to;
  const r = await ctx.src.costCentres.report(id, { from, to, businessUnitId: ctx.params.businessUnitId }, ctx.user);
  const cats = r.byCategory.map((c) => c.category);
  const cc = r.costCentre;
  const content: Content[] = [
    details([
      ['Cost centre', `${cc.code} — ${cc.name}`],
      ['Charged to', cc.chargeTo === 'PARTNER' ? `${cc.partner?.name ?? 'A partner'}’s profit` : 'The paying unit’s own P&L'],
      ['Home unit', cc.businessUnit?.name ?? 'Any unit'],
      ['Period', from && to ? dateRange(from, to) : 'All time'],
    ]),
    headline(ctx, [
      { label: 'Spent', value: money(r.total), tone: 'accent' },
      ...r.byCharge.map((c) => ({ label: c.chargedTo ? `Borne by ${c.chargedTo}` : 'Borne by the unit', value: money(c.amount) })),
    ]),
    heading('By category'),
    table({
      columns: [
        { header: 'Category', width: '*' },
        { header: 'Amount', width: 90, align: 'right' },
      ],
      rows: r.byCategory.map((c) => [c.category, money(c.amount)]),
      totals: [['Total', money(r.total)]],
      empty: 'Nothing spent.',
    }),
    heading('By month'),
    table({
      columns: [
        { header: 'Month', width: 70 },
        ...cats.map((c) => ({ header: c, width: '*', align: 'right' as const })),
        { header: 'Total', width: 70, align: 'right' },
      ],
      rows: r.byMonth.map((mo) => [monthName(mo.month), ...cats.map((c) => money(mo.byCategory[c] ?? '0')), money(mo.amount)]),
      fontSize: cats.length > 5 ? 7 : 8,
      empty: 'Nothing spent.',
    }),
    heading('By unit'),
    table({
      columns: [
        { header: 'Paid by', width: '*' },
        { header: 'Amount', width: 90, align: 'right' },
      ],
      rows: r.byUnit.map((u) => [u.unit, money(u.amount)]),
    }),
  ];
  return {
    subtitle: `${cc.code} ${cc.name} · ${from && to ? dateRange(from, to) : 'All time'}`,
    content,
    unitIds: coveredUnits(ctx, ctx.params.businessUnitId),
    periodFrom: from ?? null,
    periodTo: to ?? null,
    fileStem: `cost-centre-${slug(cc.code)}${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}`,
  };
}
