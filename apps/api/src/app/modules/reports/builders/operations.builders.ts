import { BadRequestException } from '@nestjs/common';
import { businessDate, toPaisa } from '@multizoo/utils';
import type { Content } from 'pdfmake/interfaces';
import { date, dateRange, details, heading, money, moneyOrBlank, MONTH_SHORT, note, paragraph, pct, table, type Cell } from '../pdf/pdf-kit';
import { coveredUnits, headline, slug, type BuildContext, type BuiltReport } from './types';

const need = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null || value === '') throw new BadRequestException(`Pick ${what}.`);
  return value;
};

// --- Utility bill allocation sheet ------------------------------------------------------------------

export async function utilityBill(ctx: BuildContext): Promise<BuiltReport> {
  const bill = await ctx.src.utilities.getBill(need(ctx.params.billId, 'a bill'), ctx.user);
  const c = bill.connection;
  const al = bill.allocation;
  const content: Content[] = [
    details([
      ['Connection', `${c.name} (${c.utility})`],
      ['Provider / ref.', [c.provider, c.reference].filter(Boolean).join(' · ')],
      ['Paid by', c.businessUnit.name],
      ['Method', c.method === 'SUB_METERED' ? 'Sub-metered, remainder split by %' : 'Shared by fixed weights'],
      ['Period', `${dateRange(bill.periodFrom, bill.periodTo)} (${bill.days} days)`],
      ['Status', bill.status === 'POSTED' ? `Posted${bill.postedByName ? ` by ${bill.postedByName}` : ''}` : 'Draft'],
    ]),
    headline(ctx, [
      { label: 'Bill', value: money(bill.billAmount), tone: 'accent' },
      ...(bill.totalUnits ? [{ label: 'Units on the bill', value: bill.totalUnits }] : []),
      ...(al?.rate ? [{ label: 'Rate per unit', value: money(al.rate) }] : []),
      ...(al?.remainderUnits ? [{ label: 'Remainder units', value: al.remainderUnits }] : []),
    ]),
  ];
  if (bill.readings.length) {
    content.push(
      heading('Sub-meter readings', `Consumption is pro-rated to a standard ${c.standardDays}-day cycle: (end − start) ÷ days covered × ${c.standardDays}.`),
      table({
        columns: [
          { header: 'Sub-meter', width: '*' },
          { header: 'Unit', width: 44 },
          { header: 'Start', width: 60, align: 'right' },
          { header: 'End', width: 60, align: 'right' },
          { header: 'Days', width: 36, align: 'right' },
        ],
        rows: bill.readings.map((r) => [r.name, r.businessUnit.code, r.start, r.end ?? '—', r.daysCovered ?? bill.days]),
      }),
    );
  }
  if (al) {
    const rows = (list: typeof al.metered): Cell[][] =>
      list.map((r) => [r.label, r.businessUnit.code, r.consumed ?? '', r.units, r.pct ? `${r.pct}%` : '', money(r.charge)]);
    const cols = [
      { header: 'Charged for', width: '*' },
      { header: 'Unit', width: 40 },
      { header: 'Consumed', width: 54, align: 'right' as const },
      { header: 'Units', width: 54, align: 'right' as const },
      { header: 'Share', width: 44, align: 'right' as const },
      { header: 'Charge', width: 70, align: 'right' as const },
    ];
    if (al.metered.length) content.push(heading('Metered'), table({ columns: cols, rows: rows(al.metered) }));
    if (al.remainder.length) content.push(heading(c.method === 'SHARED' ? 'Shares' : 'Remainder split'), table({ columns: cols, rows: rows(al.remainder) }));
    content.push(
      heading('What each unit bears'),
      table({
        columns: [
          { header: 'Unit', width: '*' },
          { header: 'Units', width: 70, align: 'right' },
          { header: 'Charge', width: 90, align: 'right' },
        ],
        rows: al.byUnit.map((u) => [`${u.businessUnit.name}${u.isPayer ? ' (pays the bill)' : ''}`, u.units ?? '', money(u.charge)]),
        totals: [['Total', '', money(al.total)]],
      }),
    );
  }
  for (const msg of [...bill.errors, ...bill.warnings]) content.push(note(msg));
  if (bill.postings.length) {
    content.push(
      note(
        `Posted: ${bill.postings
          .map((p) => `${p.label} (${p.unit.code}) ${p.entry?.displayNo ?? ''}${p.reversal ? ` reversed by ${p.reversal.displayNo}` : ''}`)
          .join(' · ')}`,
      ),
    );
  }
  return {
    subtitle: `${c.name} · ${dateRange(bill.periodFrom, bill.periodTo)}`,
    content,
    unitIds: [...new Set([c.businessUnit.id, ...(al?.byUnit.map((u) => u.businessUnit.id) ?? [])])],
    periodFrom: bill.periodFrom,
    periodTo: bill.periodTo,
    fileStem: `utility-${slug(c.name)}-${bill.periodTo}`,
  };
}

// --- Sales & ticketing -------------------------------------------------------------------------------

export async function sales(ctx: BuildContext): Promise<BuiltReport> {
  const year = need(ctx.params.year, 'a year');
  const unitId = ctx.params.businessUnitId;
  const q = { year, businessUnitId: unitId };
  const [grid, yoy, breakup] = await Promise.all([
    ctx.src.sales.grid(q, ctx.user),
    ctx.src.sales.yearOverYear(q, ctx.user),
    ctx.src.sales.breakup(q, ctx.user),
  ]);
  const units = await ctx.src.financial.scopeUnits(ctx.user, unitId);
  const unitName = unitId ? (units[0]?.name ?? '') : ctx.scopeName;

  const content: Content[] = [
    headline(ctx, [
      { label: `Sales ${year}`, value: money(grid.total, { decimals: false }), tone: 'accent' },
      { label: `Sales ${year - 1}`, value: money(yoy.previous, { decimals: false }) },
      { label: 'Change', value: pct(yoy.pct) },
      { label: 'Average per day with sales', value: grid.averagePerSalesDay ? money(grid.averagePerSalesDay) : '—' },
    ]),
    heading('Day × month', 'The Ticket sales sheet’s grid: posted days only. Monthly average is over the month’s calendar days.'),
    table({
      columns: [{ header: 'Day', width: 22, align: 'right' }, ...grid.months.map((m) => ({ header: m.name.slice(0, 3), width: '*', align: 'right' as const }))],
      rows: [
        ...Array.from({ length: 31 }, (_, d) => [String(d + 1), ...grid.months.map((m) => moneyOrBlank(m.days[d], { decimals: false }))] as Cell[]),
      ],
      totals: [
        ['Total', ...grid.months.map((m) => money(m.total, { decimals: false }))],
        ['Avg', ...grid.months.map((m) => money(m.averagePerDay, { decimals: false }))],
        ['Days', ...grid.months.map((m) => String(m.daysWithSales))],
      ],
      fontSize: 6,
      compact: true,
    }),
    heading('Year on year', `Each month against the same month of ${year - 1}.`),
    table({
      columns: [
        { header: 'Month', width: '*' },
        { header: String(year), width: 90, align: 'right' },
        { header: String(year - 1), width: 90, align: 'right' },
        { header: 'Change', width: 90, align: 'right' },
        { header: '%', width: 60, align: 'right' },
      ],
      rows: yoy.months.map((m) => [m.name, money(m.current), money(m.previous), money(m.change), pct(m.pct)]),
      totals: [
        ['Year', money(yoy.current), money(yoy.previous), money(yoy.change), pct(yoy.pct)],
        ...(yoy.toDate ? [['Year to date', money(yoy.toDate.current), money(yoy.toDate.previous), '', pct(yoy.toDate.pct)] as Cell[]] : []),
      ],
      fontSize: 7.5,
    }),
    heading('By item', 'Amount and count per price-list item per month (the sheet’s Z4:AX40 breakup).'),
    table({
      columns: [
        { header: 'Item', width: 110 },
        ...MONTH_SHORT.map((m) => ({ header: m, width: '*', align: 'right' as const })),
        { header: 'Total', width: 56, align: 'right' },
        { header: 'Count', width: 34, align: 'right' },
      ],
      rows: breakup.items.map((it) => [
        it.item,
        ...MONTH_SHORT.map((_, i) => moneyOrBlank(it.months[`${year}-${String(i + 1).padStart(2, '0')}`]?.amount, { decimals: false })),
        money(it.amount, { decimals: false }),
        String(it.quantity || ''),
      ]),
      totals: [
        [
          'Total',
          ...MONTH_SHORT.map((_, i) => moneyOrBlank(breakup.months.find((m) => m.month === `${year}-${String(i + 1).padStart(2, '0')}`)?.amount, { decimals: false })),
          money(breakup.total, { decimals: false }),
          String(breakup.quantity || ''),
        ],
      ],
      fontSize: 6,
      empty: 'Nothing sold this year.',
    }),
  ];

  let eventName = '';
  if (ctx.params.eventId) {
    const cmp = await ctx.src.sales.compare({ eventId: ctx.params.eventId, businessUnitId: unitId }, ctx.user);
    eventName = cmp.event.name;
    const years = cmp.totals.map((t) => t.year);
    content.push(
      heading(`${cmp.event.name}, year by year`, 'Day N of the event in each year: income, adults and children through the gate.'),
      table({
        columns: [
          { header: 'Day', width: 28 },
          ...years.flatMap((y) => [
            { header: `${y}`, width: '*', align: 'right' as const },
            { header: 'Adults', width: 34, align: 'right' as const },
            { header: 'Kids', width: 30, align: 'right' as const },
          ]),
        ],
        rows: cmp.rows.map((r) => [
          `Day ${r.day}`,
          ...years.flatMap((y) => {
            const c = r.byYear[y];
            return [c?.amount ? money(c.amount, { decimals: false }) : '', c?.adults ? String(c.adults) : '', c?.kids ? String(c.kids) : ''];
          }),
        ]),
        totals: [
          ['Total', ...cmp.totals.flatMap((t) => [money(t.amount, { decimals: false }), String(t.adults), String(t.kids)])],
          ['Avg/day', ...cmp.totals.flatMap((t) => [t.averagePerDay ? money(t.averagePerDay) : '—', '', ''])],
          ['Change', ...cmp.totals.flatMap((t) => [t.change ? `${money(t.change.amount, { decimals: false })} (${pct(t.change.pct)})` : '', t.change ? String(t.change.adults) : '', t.change ? String(t.change.kids) : ''])],
        ],
        fontSize: 6.5,
      }),
      paragraph('Average per day is over the days that had sales; footfall counts the price-list items flagged as adult or child entry.'),
    );
  }
  return {
    subtitle: `${year} · ${unitName}${eventName ? ` · with ${eventName}` : ''}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: `${year}-01-01`,
    periodTo: `${year}-12-31`,
    fileStem: `sales-${year}${unitId ? `-${slug(units[0]?.code ?? '')}` : ''}`,
  };
}

// --- Capex register -----------------------------------------------------------------------------------

const PAYBACK: Record<string, string> = {
  PAID_BACK: 'Paid back',
  ON_TRACK: 'On track',
  BEHIND: 'Behind',
  OVERDUE: 'Overdue',
  NO_TARGET: 'No target',
  NOT_TRACKED: 'Not tracked',
};

export async function capexRegister(ctx: BuildContext): Promise<BuiltReport> {
  const unitId = ctx.params.businessUnitId;
  const status = ctx.params.status === 'ACTIVE' || ctx.params.status === 'RETIRED' ? ctx.params.status : undefined;
  const reg = await ctx.src.capex.list({ businessUnitId: unitId, status: status as never }, ctx.user);
  const s = reg.summary;
  const content: Content[] = [
    headline(ctx, [
      { label: 'Total investment', value: money(s.total, { decimals: false }), tone: 'accent' },
      { label: 'Items', value: String(s.count) },
      { label: 'Paid back', value: String(reg.items.filter((i) => i.payback.state === 'PAID_BACK').length) },
      { label: 'Behind or overdue', value: String(reg.items.filter((i) => i.payback.state === 'BEHIND' || i.payback.state === 'OVERDUE').length), tone: 'danger' },
    ]),
    table({
      columns: [
        { header: 'Bought', width: 50 },
        { header: 'Item', width: '*' },
        { header: 'Nature', width: 70 },
        { header: 'Unit', width: 36 },
        { header: 'Cost', width: 64, align: 'right' },
        { header: 'ROI window', width: 50, align: 'right' },
        { header: 'Pays back by', width: 56 },
        { header: 'Earned back', width: 64, align: 'right' },
        { header: 'Payback', width: 56 },
        { header: 'Ledger', width: 56 },
      ],
      rows: reg.items.map((i) => [
        date(i.purchaseDate),
        i.status === 'RETIRED' ? `${i.name} (retired ${i.retiredOn ? date(i.retiredOn) : ''})` : i.note ? `${i.name} — ${i.note}` : i.name,
        i.nature,
        i.businessUnit.code,
        money(i.amount, { decimals: false }),
        i.paybackMonths ? `${i.paybackMonths} mo` : '',
        i.payback.expectedBy ? date(i.payback.expectedBy) : '',
        i.payback.recovered ? `${money(i.payback.recovered, { decimals: false })}${i.payback.recoveredPct ? ` (${i.payback.recoveredPct}%)` : ''}` : '',
        {
          text: PAYBACK[i.payback.state] ?? i.payback.state,
          color: i.payback.state === 'OVERDUE' || i.payback.state === 'BEHIND' ? '#A8433A' : i.payback.state === 'PAID_BACK' ? '#1B6E52' : undefined,
        },
        i.entry ? i.entry.displayNo : i.funding === 'NOT_RECORDED' ? 'Register only' : '',
      ]),
      totals: [['', 'Total', '', '', money(s.total, { decimals: false }), '', '', '', '', '']],
      fontSize: 7,
      empty: 'Nothing on the register.',
    }),
    {
      columns: [
        {
          width: '*',
          stack: [
            heading('By nature'),
            table({
              columns: [
                { header: 'Nature', width: '*' },
                { header: 'Items', width: 34, align: 'right' },
                { header: 'Amount', width: 70, align: 'right' },
              ],
              rows: s.byNature.map((n) => [n.nature, n.count, money(n.amount, { decimals: false })]),
            }),
          ],
        },
        {
          width: '*',
          stack: [
            heading('By unit'),
            table({
              columns: [
                { header: 'Unit', width: '*' },
                { header: 'Items', width: 34, align: 'right' },
                { header: 'Amount', width: 70, align: 'right' },
              ],
              rows: s.byUnit.map((n) => [n.unit, n.count, money(n.amount, { decimals: false })]),
            }),
          ],
        },
        {
          width: '*',
          stack: [
            heading('By year'),
            table({
              columns: [
                { header: 'Year', width: '*' },
                { header: 'Items', width: 34, align: 'right' },
                { header: 'Amount', width: 70, align: 'right' },
              ],
              rows: s.byYear.map((n) => [n.year, n.count, money(n.amount, { decimals: false })]),
            }),
          ],
        },
      ],
      columnGap: 14,
    } as Content,
    paragraph('Payback counts the takings of the price-list items linked to a purchase since the day it was bought, against a straight line to its ROI date.'),
  ];
  const today = businessDate();
  return {
    subtitle: `At ${date(today)} · ${unitId ? (reg.items[0]?.businessUnit.name ?? 'One unit') : ctx.scopeName}${status ? ` · ${status === 'ACTIVE' ? 'in use' : 'retired'}` : ''}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodTo: today,
    fileStem: `capex-register-${today}`,
  };
}

// --- Campaign P&L -----------------------------------------------------------------------------------------

export async function campaign(ctx: BuildContext): Promise<BuiltReport> {
  const c = await ctx.src.campaigns.findOne(need(ctx.params.campaignId, 'a campaign'), ctx.user);
  const st = c.statement;
  const content: Content[] = [
    details([
      ['Campaign', c.name],
      ['Host unit', c.businessUnit.name],
      ['Runs', c.endDate ? dateRange(c.startDate, c.endDate) : `From ${date(c.startDate)}`],
      ['Status', c.status === 'CLOSED' ? `Closed ${c.closedOn ? date(c.closedOn) : ''}${c.closeAccount ? ` to ${c.closeAccount.name}` : ''}` : 'Open'],
      ['Fund account', c.fundAccount ? `${c.fundAccount.code} ${c.fundAccount.name}` : ''],
      ['Notes', c.notes ?? ''],
    ]),
    headline(ctx, [
      { label: 'Raised', value: money(st.income) },
      { label: 'Spent', value: money(st.expenses) },
      { label: 'Balance', value: money(st.balance), tone: toPaisa(st.balance) < 0n ? 'danger' : 'accent' },
      ...(st.budget ? [{ label: 'Budget', value: money(st.budget.total) }, { label: 'Still to raise', value: money(st.budget.stillToRaise) }] : []),
    ]),
    {
      columns: [
        {
          width: '*',
          stack: [
            heading('Raised from'),
            table({
              columns: [
                { header: 'Category', width: '*' },
                { header: 'Amount', width: 80, align: 'right' },
              ],
              rows: st.incomeByCategory.map((x) => [x.category, money(x.amount)]),
              totals: [['Total raised', money(st.income)]],
            }),
          ],
        },
        {
          width: '*',
          stack: [
            heading('Spent on'),
            table({
              columns: [
                { header: 'Category', width: '*' },
                { header: 'Amount', width: 80, align: 'right' },
              ],
              rows: st.expensesByCategory.map((x) => [x.category, money(x.amount)]),
              totals: [['Total spent', money(st.expenses)]],
            }),
          ],
        },
      ],
      columnGap: 16,
    } as Content,
  ];
  if (c.budget.length) {
    content.push(
      heading('Budget'),
      table({
        columns: [
          { header: 'Line', width: '*' },
          { header: 'Amount', width: 90, align: 'right' },
        ],
        rows: c.budget.map((b) => [b.label, money(b.amount)]),
        totals: st.budget
          ? [
              ['Budget', money(st.budget.total)],
              ['Left to spend', money(st.budget.left)],
            ]
          : [],
      }),
    );
  }
  content.push(
    heading('Every receipt and payment', 'Reversed entries are listed but don’t count towards the balance.'),
    table({
      columns: [
        { header: 'Date', width: 48 },
        { header: 'Category', width: 70 },
        { header: 'Description', width: '*' },
        { header: 'Raised', width: 60, align: 'right' },
        { header: 'Spent', width: 60, align: 'right' },
        { header: 'Balance', width: 64, align: 'right' },
        { header: 'Entry', width: 46 },
      ],
      rows: c.entries.map((e) => {
        const reversed = e.status === 'REVERSED';
        const txt = (s: string): Cell => (reversed ? { text: s, color: '#7C8A82' } : s);
        return [
          txt(date(e.entryDate)),
          txt(e.category),
          txt(reversed ? `${e.description} (reversed)` : e.description),
          txt(e.type === 'INCOME' ? money(e.amount) : ''),
          txt(e.type === 'EXPENSE' ? money(e.amount) : ''),
          txt(e.balance ? money(e.balance) : ''),
          txt(e.entry?.displayNo ?? ''),
        ];
      }),
      fontSize: 7.5,
      empty: 'Nothing recorded yet.',
    }),
    paragraph('The campaign runs through its own fund: money raised and spent never becomes the host unit’s income or expenses until it’s closed.'),
  );
  return {
    subtitle: `${c.name} · ${c.businessUnit.name}`,
    content,
    unitIds: [c.businessUnit.id],
    periodFrom: c.startDate,
    periodTo: c.endDate,
    fileStem: `campaign-${slug(c.name)}`,
  };
}

