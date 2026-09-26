import { BadRequestException } from '@nestjs/common';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import type { Content } from 'pdfmake/interfaces';
import { date, dateRange, details, figures, heading, money, monthName, note, pageBreak, paragraph, table, type Cell } from '../pdf/pdf-kit';
import { coveredUnits, headline, slug, type BuildContext, type BuiltReport } from './types';

const need = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null || value === '') throw new BadRequestException(`Pick ${what}.`);
  return value;
};

const STATUS: Record<string, string> = {
  DRAFT: 'Draft — figures recalculate from the live records until it’s finalised',
  FINALIZED: 'Finalised — to pay',
  PAID: 'Paid',
};

type PayrollRun = Awaited<ReturnType<BuildContext['src']['payroll']['findOne']>>;
type PayRow = PayrollRun['rows'][number];

const neg = (amount: string) => fromPaisa(-toPaisa(amount));

const statutory = (r: Pick<PayRow, 'eobiEmployee' | 'tax' | 'pfEmployee'>) =>
  fromPaisa(toPaisa(r.eobiEmployee) + toPaisa(r.tax) + toPaisa(r.pfEmployee));

// --- Payroll register ------------------------------------------------------------------------

export async function payrollRegister(ctx: BuildContext): Promise<BuiltReport> {
  const run = await ctx.src.payroll.findOne(need(ctx.params.runId, 'a payroll run'), ctx.user);
  const t = run.totals as Record<string, string>;
  const content: Content[] = [
    headline(ctx, [
      { label: 'People', value: String(run.rows.length) },
      { label: 'Gross', value: money(t.gross) },
      { label: 'Net payable', value: money(t.net), tone: 'accent' },
      { label: 'Cost to the unit', value: money(t.cost) },
      { label: 'Still to pay', value: money(run.unpaid) },
    ]),
    note(STATUS[run.status] ?? run.status),
    table({
      columns: [
        { header: 'Code', width: 38 },
        { header: 'Name', width: '*' },
        { header: 'Designation', width: 70 },
        { header: 'Salary', width: 50, align: 'right' },
        { header: 'Absent', width: 30, align: 'right' },
        { header: 'Absence ded.', width: 48, align: 'right' },
        { header: 'Advance', width: 46, align: 'right' },
        { header: 'Gross', width: 52, align: 'right' },
        { header: 'Bonus', width: 46, align: 'right' },
        { header: 'Fines', width: 40, align: 'right' },
        { header: 'Food', width: 40, align: 'right' },
        { header: 'Other ded.', width: 44, align: 'right' },
        { header: 'Statutory', width: 44, align: 'right' },
        { header: 'Net', width: 54, align: 'right' },
        { header: 'Paid on', width: 46 },
      ],
      rows: run.rows.map((r) => [
        r.employeeCode,
        r.fullName,
        r.designation ?? '',
        r.payBasis === 'DAILY' ? `${money(r.salary)}/day` : money(r.salary),
        r.absentDays,
        money(r.absenceDeduction),
        money(r.advance),
        money(r.gross),
        money(r.bonus),
        money(r.fines),
        money(r.food),
        money(r.otherDeductions),
        money(statutory(r)),
        { text: money(r.net), bold: true },
        r.paidOn ? date(r.paidOn) : '',
      ]),
      totals: [
        [
          'Total',
          `${run.rows.length} people`,
          '',
          '',
          '',
          money(t.absenceDeduction),
          money(t.advance),
          money(t.gross),
          money(t.bonus),
          money(t.fines),
          money(t.food),
          money(t.otherDeductions),
          money(statutory(t as unknown as PayRow)),
          money(t.net),
          '',
        ],
      ],
      fontSize: 6.8,
      empty: 'Nobody on this run.',
    }),
    paragraph(
      'The salary sheet’s arithmetic: Gross = salary − salary ÷ days × absent days − advances recovered; Net = gross + bonus − fines − food − other deductions − the employee’s statutory contributions.',
    ),
  ];
  if (run.errors.length || run.warnings.length) {
    content.push(heading('Needs attention'), ...[...run.errors, ...run.warnings].map((w) => note(w)));
  }
  if (run.accrualEntry || run.payments.length) {
    content.push(
      note(
        [
          run.accrualEntry?.displayNo ? `Cost posted as ${run.accrualEntry.displayNo}.` : '',
          ...run.payments.map((p) => `${p.count} paid ${p.date ? date(p.date) : ''} (${money(p.amount)}) as ${p.displayNo ?? '—'}.`),
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
  }
  return {
    subtitle: `${monthName(run.month)} · ${run.businessUnit.name}`,
    content,
    unitIds: [run.businessUnit.id],
    periodFrom: `${run.month}-01`,
    periodTo: null,
    fileStem: `payroll-register-${run.month}-${slug(run.businessUnit.code)}`,
  };
}

// --- Payslips -----------------------------------------------------------------------------------

function payslip(
  run: Pick<PayrollRun, 'month' | 'status' | 'businessUnit'>,
  r: PayRow,
  employee: { cnic: string | null; joinDate: string; employmentType: string } | null,
): Content[] {
  const d = r.details;
  const line = (label: string, amount: string, bold = false): Cell[] => [
    bold ? { text: label, bold: true } : label,
    bold ? { text: money(amount), bold: true } : money(amount),
  ];
  const earnings: Cell[][] = [
    line(r.payBasis === 'DAILY' ? 'Daily rate' : 'Monthly salary', r.salary),
    line(`Earned${d.paidDays ? ` (${d.paidDays} days)` : ''}`, r.earned),
    line('Less absences', neg(r.absenceDeduction)),
    line('Less advance recovered', neg(r.advance)),
    line('Gross', r.gross, true),
    ...(toPaisa(r.poolBonus) ? [line('Commission pool', r.poolBonus)] : []),
    ...(toPaisa(r.allowances) ? [line('Allowances / incentives', r.allowances)] : []),
  ];
  const deductions: Cell[][] = [
    ...(toPaisa(r.fines) ? [line('Fines', r.fines)] : []),
    ...(toPaisa(r.food) ? [line('Food', r.food)] : []),
    ...(toPaisa(r.otherDeductions) ? [line('Other deductions', r.otherDeductions)] : []),
    ...(toPaisa(r.eobiEmployee) ? [line('EOBI (employee)', r.eobiEmployee)] : []),
    ...(toPaisa(r.tax) ? [line('Income tax', r.tax)] : []),
    ...(toPaisa(r.pfEmployee) ? [line('Provident fund (employee)', r.pfEmployee)] : []),
  ];
  const a = d.attendance;
  return [
    details([
      ['Name', r.fullName],
      ['Employee code', r.employeeCode],
      ['Designation', r.designation ?? ''],
      ['Department', r.department ?? ''],
      ['Unit', run.businessUnit.name],
      ['Month', monthName(run.month)],
      ['CNIC', employee?.cnic ?? ''],
      ['Joined', employee ? date(employee.joinDate) : ''],
    ]),
    {
      columns: [
        {
          width: '*',
          stack: [
            heading('Earnings'),
            table({ columns: [{ header: '', width: '*' }, { header: 'Rs', width: 80, align: 'right' }], rows: earnings }),
          ],
        },
        {
          width: '*',
          stack: [
            heading('Deductions'),
            table({
              columns: [{ header: '', width: '*' }, { header: 'Rs', width: 80, align: 'right' }],
              rows: deductions.length ? deductions : [['None', '']],
            }),
          ],
        },
      ],
      columnGap: 18,
    } as Content,
    figures([
      { label: 'Net payable', value: `Rs ${money(r.net)}`, tone: 'accent' },
      { label: 'Status', value: r.paidOn ? `Paid ${date(r.paidOn)}` : run.status === 'DRAFT' ? 'Draft' : 'To pay' },
    ]),
    heading('Attendance'),
    table({
      columns: [
        { header: 'Working days', align: 'right', width: '*' },
        { header: 'Present', align: 'right', width: '*' },
        { header: 'Half days', align: 'right', width: '*' },
        { header: 'Absent', align: 'right', width: '*' },
        { header: 'Paid leave', align: 'right', width: '*' },
        { header: 'Unpaid leave', align: 'right', width: '*' },
        { header: 'Extra days', align: 'right', width: '*' },
        { header: 'Not marked', align: 'right', width: '*' },
      ],
      rows: [[a.workingDays, a.present, a.halfDays, a.absent, a.paidLeave, a.unpaidLeave, a.extraDays, a.unmarked]],
    }),
    ...(d.fines.length || d.allowances.length || d.food.length || d.deductions.length || d.poolShares.length || d.recoveries.length
      ? [
          heading('Details'),
          table({
            columns: [
              { header: 'What', width: 110 },
              { header: 'Description', width: '*' },
              { header: 'Amount', width: 80, align: 'right' },
            ],
            rows: [
              ...d.poolShares.map((p) => ['Commission pool', `${p.title} (${p.tier.toLowerCase()})`, money(p.amount)]),
              ...d.allowances.map((x) => ['Allowance', x.description, money(x.amount)]),
              ...d.fines.map((f) => ['Fine', `${date(f.date)} — ${f.reason}`, money(f.amount)]),
              ...d.food.map((x) => ['Food', x.description, money(x.amount)]),
              ...d.deductions.map((x) => ['Deduction', x.description, money(x.amount)]),
              ...d.recoveries.map((x) => ['Advance recovered', `Advance of ${date(x.issueDate)} — ${money(x.outstandingAfter)} still owed after`, money(x.amount)]),
            ],
            fontSize: 7.5,
          }),
        ]
      : []),
  ];
}

export async function payslips(ctx: BuildContext): Promise<BuiltReport> {
  const runId = need(ctx.params.runId, 'a payroll run');
  const employeeId = ctx.params.employeeId;
  if (employeeId) {
    const view = await ctx.src.payroll.payslip(runId, employeeId, ctx.user);
    return {
      title: 'Payslip',
      subtitle: `${view.row.fullName} · ${monthName(view.run.month)} · ${view.run.businessUnit.name}`,
      content: payslip(view.run, view.row, view.employee),
      unitIds: [view.run.businessUnit.id],
      periodFrom: `${view.run.month}-01`,
      fileStem: `payslip-${view.run.month}-${slug(view.row.employeeCode)}`,
    };
  }
  const run = await ctx.src.payroll.findOne(runId, ctx.user);
  if (!run.rows.length) throw new BadRequestException('Nobody is on this payroll run.');
  const content: Content[] = [];
  run.rows.forEach((r, i) => {
    if (i > 0) content.push(pageBreak());
    content.push(...payslip(run, r, null));
  });
  return {
    subtitle: `${monthName(run.month)} · ${run.businessUnit.name} · ${run.rows.length} people`,
    content,
    unitIds: [run.businessUnit.id],
    periodFrom: `${run.month}-01`,
    fileStem: `payslips-${run.month}-${slug(run.businessUnit.code)}`,
  };
}

// --- Bonus / incentive sheet ---------------------------------------------------------------------

const TIER: Record<string, string> = { MANAGER: 'Managers', SUPERVISOR: 'Supervisors', TICKETER: 'Ticketers', WORKER: 'Workers', NONE: '—' };

export async function bonusSheet(ctx: BuildContext): Promise<BuiltReport> {
  const pool = await ctx.src.bonus.findOne(need(ctx.params.poolId, 'a commission pool'), ctx.user);
  const content: Content[] = [
    details([
      ['Pool', pool.title],
      ['Unit', pool.businessUnit.name],
      ['Month', monthName(pool.month)],
      ['Basis', pool.basis ?? ''],
      ['Status', pool.status === 'APPROVED' ? `Approved${pool.approvedByName ? ` by ${pool.approvedByName}` : ''}` : 'Draft'],
      ['Payroll policy', `v${pool.policyVersion}`],
    ]),
    headline(ctx, [
      { label: 'Qualifying sales', value: money(pool.qualifyingSales) },
      { label: 'Commission', value: `${pool.commissionPct}%` },
      { label: 'Pool (rounded down)', value: money(pool.pool), tone: 'accent' },
      { label: 'Not distributed', value: money(pool.undistributed) },
    ]),
    heading('Tiers', 'Each tier’s share of the pool, divided by head or by a count per person, rounded up where the policy says so.'),
    table({
      columns: [
        { header: 'Tier', width: '*' },
        { header: '% of pool', width: 50, align: 'right' },
        { header: 'Amount', width: 70, align: 'right' },
        { header: 'Split', width: 70 },
        { header: 'People', width: 40, align: 'right' },
        { header: 'Units', width: 44, align: 'right' },
        { header: 'Per head / unit', width: 64, align: 'right' },
        { header: 'Paid out', width: 64, align: 'right' },
      ],
      rows: pool.tiers.map((t) => [
        TIER[t.tier] ?? t.tier,
        `${t.pct}%`,
        money(t.amount),
        t.split === 'EQUAL' ? 'Per head' : `Per ${t.unitLabel ?? 'unit'}`,
        t.headcount,
        t.split === 'BY_UNITS' ? t.totalUnits : '',
        t.perUnit ? `${money(t.perUnit)}${t.roundUp ? ' ↑' : ''}` : '',
        money(t.distributed),
      ]),
      fontSize: 7.5,
    }),
    heading('People'),
    table({
      columns: [
        { header: 'Code', width: 44 },
        { header: 'Name', width: '*' },
        { header: 'Designation', width: 100 },
        { header: 'Tier', width: 64 },
        { header: 'Count', width: 40, align: 'right' },
        { header: 'Amount', width: 70, align: 'right' },
      ],
      rows: pool.members.map((mb) => [mb.employeeCode, mb.fullName, mb.designation ?? '', TIER[mb.tier] ?? mb.tier, mb.units === '0' ? '' : mb.units, money(mb.amount)]),
      totals: [['', 'Total', '', '', '', money(fromPaisa(pool.members.reduce((s, mb) => s + toPaisa(mb.amount), 0n)))]],
      empty: 'Nobody in the pool yet.',
    }),
    paragraph('The Bonus Calculator: pool = FLOOR(qualifying sales × commission %); tier = pool × tier %; a share per person rounded up to whole rupees where the tier says so.'),
  ];
  return {
    subtitle: `${pool.title} · ${monthName(pool.month)} · ${pool.businessUnit.name}`,
    content,
    unitIds: [pool.businessUnit.id],
    periodFrom: `${pool.month}-01`,
    fileStem: `bonus-${pool.month}-${slug(pool.businessUnit.code)}-${slug(pool.title)}`,
  };
}

// --- Attendance & leave summary --------------------------------------------------------------------

const DAY: Record<string, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  HALF_DAY: '½',
  LEAVE_PAID: 'L',
  LEAVE_UNPAID: 'U',
  OFF: '·',
  EXTRA: 'X',
  EXTRA_HALF: 'x',
  UNMARKED: '?',
  FUTURE: '',
  NOT_EMPLOYED: '',
};

export async function attendanceSummary(ctx: BuildContext): Promise<BuiltReport> {
  const month = need(ctx.params.month, 'a month');
  const unitId = need(ctx.params.businessUnitId, 'a unit');
  const reg = await ctx.src.attendance.register(unitId, month, ctx.user);
  const bal = await ctx.src.leave.balances(ctx.user, unitId, Number(month.slice(0, 4)));
  const s = reg.employees.map((e) => e.summary);
  const sum = (f: (x: (typeof s)[number]) => number) => s.reduce((acc, x) => acc + f(x), 0);

  const content: Content[] = [
    headline(ctx, [
      { label: 'People', value: String(reg.employees.length) },
      { label: 'Days present', value: String(sum((x) => x.present)) },
      { label: 'Days absent', value: String(sum((x) => x.absent)), tone: 'danger' },
      { label: 'Days on leave', value: String(sum((x) => x.paidLeave + x.unpaidLeave)) },
      { label: 'Not marked', value: String(sum((x) => x.unmarked)) },
    ]),
    heading('Summary', `Working days exclude each person’s weekly day off and holidays; “absent for pay” is what payroll deducts.`),
    table({
      columns: [
        { header: 'Code', width: 40 },
        { header: 'Name', width: '*' },
        { header: 'Designation', width: 90 },
        { header: 'Working days', width: 46, align: 'right' },
        { header: 'Present', width: 40, align: 'right' },
        { header: 'Half days', width: 40, align: 'right' },
        { header: 'Absent', width: 40, align: 'right' },
        { header: 'Paid leave', width: 40, align: 'right' },
        { header: 'Unpaid leave', width: 44, align: 'right' },
        { header: 'Rest days worked', width: 50, align: 'right' },
        { header: 'Not marked', width: 42, align: 'right' },
        { header: 'Absent for pay', width: 48, align: 'right' },
      ],
      rows: reg.employees.map((e) => [
        e.employeeCode,
        e.fullName,
        e.designation ?? '',
        e.summary.workingDays,
        e.summary.present,
        e.summary.halfDays,
        e.summary.absent,
        e.summary.paidLeave,
        e.summary.unpaidLeave,
        e.summary.extraDays,
        e.summary.unmarked,
        e.summary.payrollAbsentDays,
      ]),
      totals: [
        [
          '',
          'Total',
          '',
          sum((x) => x.workingDays),
          sum((x) => x.present),
          sum((x) => x.halfDays),
          sum((x) => x.absent),
          sum((x) => x.paidLeave),
          sum((x) => x.unpaidLeave),
          '',
          sum((x) => x.unmarked),
          '',
        ],
      ],
      fontSize: 7.5,
      empty: 'Nobody employed here this month.',
    }),
    heading('Day by day', 'P present · A absent · ½ half day · L paid leave · U leave not covered · · rest day · X rest day worked · ? not marked'),
    table({
      columns: [
        { header: 'Name', width: 92 },
        ...reg.calendar.map((c) => ({ header: String(Number(c.date.slice(8))), width: '*', align: 'center' as const })),
      ],
      rows: reg.employees.map((e) => [
        e.fullName,
        ...e.days.map((d) => ({
          text: DAY[d.kind] ?? '',
          color: d.kind === 'ABSENT' || d.kind === 'LEAVE_UNPAID' ? '#A8433A' : d.kind === 'UNMARKED' ? '#8F6C1A' : undefined,
        })),
      ]) as Cell[][],
      fontSize: 6.3,
    }),
  ];
  // Only leave types someone here is entitled to.
  const types = bal.leaveTypes.filter((t) => bal.employees.some((e) => e.balances.some((b) => b.leaveTypeId === t.id && b.inPolicy)));
  if (types.length && bal.employees.length) {
    content.push(
      heading(`Leave balances ${bal.year}`, 'Days available now, and days taken this year.'),
      table({
        columns: [{ header: 'Name', width: '*' }, ...types.map((t) => ({ header: t.name, width: 72, align: 'right' as const }))],
        rows: bal.employees.map((e) => [
          e.fullName,
          ...types.map((t) => {
            const b = e.balances.find((x) => x.leaveTypeId === t.id);
            if (!b || !b.inPolicy) return '—';
            return `${b.available} · ${b.taken} taken`;
          }),
        ]),
        fontSize: 7.5,
      }),
    );
  }
  return {
    subtitle: `${monthName(month)} · ${reg.unit.name}`,
    content,
    unitIds: [unitId],
    periodFrom: reg.from,
    periodTo: reg.to,
    fileStem: `attendance-${month}-${slug(reg.unit.code)}`,
  };
}

// --- Headcount & payroll cost ------------------------------------------------------------------------

export async function headcount(ctx: BuildContext): Promise<BuiltReport> {
  const month = need(ctx.params.month, 'a month');
  const unitId = ctx.params.businessUnitId;
  const h = await ctx.src.financial.headcount(ctx.user, month, unitId);
  const t = h.totals;
  const notRun = h.runs.filter((r) => r.status !== 'FINALIZED' && r.status !== 'PAID');
  const content: Content[] = [
    headline(ctx, [
      { label: 'On the books at month end', value: String(t?.onBooks ?? 0) },
      { label: 'Joined', value: String(t?.joined ?? 0) },
      { label: 'Left', value: String(t?.left ?? 0) },
      { label: 'Payroll cost', value: money(t?.cost ?? '0'), tone: 'accent' },
    ]),
    table({
      columns: [
        { header: 'Unit', width: 36 },
        { header: 'Designation', width: '*' },
        { header: 'On books', width: 38, align: 'right' },
        { header: 'Joined', width: 32, align: 'right' },
        { header: 'Left', width: 28, align: 'right' },
        { header: 'Paid', width: 28, align: 'right' },
        { header: 'Gross', width: 60, align: 'right' },
        { header: 'Bonus', width: 50, align: 'right' },
        { header: 'Net', width: 60, align: 'right' },
        { header: 'Cost', width: 62, align: 'right' },
      ],
      rows: h.rows.map((r) => [r.unit.code, r.designation, r.onBooks, r.joined, r.left, r.paid, money(r.gross), money(r.bonus), money(r.net), money(r.cost)]),
      totals: t ? [['', 'Total', t.onBooks, t.joined, t.left, t.paid, money(t.gross), money(t.bonus), money(t.net), money(t.cost)]] : [],
      fontSize: 7.5,
      empty: 'Nobody employed.',
    }),
    ...(notRun.length
      ? [note(`No finalised payroll for ${notRun.map((r) => `${r.unit.code}${r.status ? ` (${r.status.toLowerCase()})` : ''}`).join(', ')} — their pay isn’t in the cost yet.`)]
      : []),
    paragraph('Headcount is by each person’s current unit and designation. Pay is from finalised payslips (cost includes the employer’s statutory contributions).'),
  ];
  return {
    subtitle: `${monthName(month)} · ${unitId ? (h.units[0]?.name ?? '') : ctx.scopeName}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: `${month}-01`,
    fileStem: `headcount-${month}${unitId ? `-${slug(h.units[0]?.code ?? '')}` : ''}`,
  };
}

// --- Disciplinary / fine register -----------------------------------------------------------------------

const DISC_STATUS: Record<string, string> = {
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export async function disciplinary(ctx: BuildContext): Promise<BuiltReport> {
  const from = need(ctx.params.from, 'a start date');
  const to = need(ctx.params.to, 'an end date');
  const unitId = ctx.params.businessUnitId;
  const status = ctx.params.status && DISC_STATUS[ctx.params.status] ? ctx.params.status : undefined;
  const all = await ctx.src.disciplinary.list(
    { businessUnitId: unitId, status: status as never },
    ctx.user,
  );
  const rows = all.filter((r) => r.incidentDate >= from && r.incidentDate <= to).sort((a, b) => a.incidentDate.localeCompare(b.incidentDate));
  const approvedFines = rows.filter((r) => r.type === 'FINE' && r.status === 'APPROVED');
  const content: Content[] = [
    headline(ctx, [
      { label: 'Records', value: String(rows.length) },
      { label: 'Fines approved', value: String(approvedFines.length) },
      { label: 'Fined (approved)', value: money(fromPaisa(approvedFines.reduce((s, r) => s + toPaisa(r.amount ?? '0'), 0n))), tone: 'accent' },
      { label: 'Warnings', value: String(rows.filter((r) => r.type === 'WARNING').length) },
    ]),
    table({
      columns: [
        { header: 'Date', width: 48 },
        { header: 'Employee', width: 110 },
        { header: 'Unit', width: 32 },
        { header: 'Type', width: 40 },
        { header: 'Reason', width: '*' },
        { header: 'Amount', width: 52, align: 'right' },
        { header: 'Status', width: 64 },
        { header: 'Raised by', width: 70 },
        { header: 'Reviewed by', width: 70 },
        { header: 'Off pay', width: 44 },
      ],
      rows: rows.map((r) => [
        date(r.incidentDate),
        `${r.employee.fullName} (${r.employee.employeeCode})`,
        r.businessUnit.code,
        r.type === 'FINE' ? 'Fine' : 'Warning',
        r.reviewNote ? `${r.reason} — ${r.reviewNote}` : r.reason,
        r.amount ? money(r.amount) : '',
        DISC_STATUS[r.status] ?? r.status,
        r.raisedByName ?? '',
        r.reviewedByName ?? '',
        r.deductedMonth ? monthName(r.deductedMonth) : '',
      ]),
      fontSize: 7.3,
      empty: 'Nothing recorded in this period.',
    }),
  ];
  return {
    subtitle: `${dateRange(from, to)} · ${unitId ? (rows[0]?.businessUnit.name ?? 'One unit') : ctx.scopeName}${status ? ` · ${DISC_STATUS[status]}` : ''}`,
    content,
    unitIds: coveredUnits(ctx, unitId),
    periodFrom: from,
    periodTo: to,
    fileStem: `disciplinary-${from}-to-${to}`,
  };
}

// --- Full & final settlement -----------------------------------------------------------------------------

export async function settlement(ctx: BuildContext): Promise<BuiltReport> {
  const s = await ctx.src.settlements.findOne(need(ctx.params.settlementId, 'a settlement'), ctx.user);
  const e = s.employee;
  const snap = s.snapshot;
  const line = (label: string, amount: string, bold = false): Cell[] => [
    bold ? { text: label, bold: true } : label,
    bold ? { text: money(amount), bold: true } : money(amount),
  ];
  const owed: Cell[][] = [
    line('Salary for days worked', snap.salaryForDays),
    ...(toPaisa(snap.poolBonus) ? [line('Commission pool', snap.poolBonus)] : []),
    ...snap.encashment.map((x) => line(`Leave encashment — ${x.name} (${x.days} days)`, x.amount)),
    ...(toPaisa(snap.additions) ? [line('Other additions', snap.additions)] : []),
  ];
  const less: Cell[][] = [
    ...snap.fines.map((f) => line(`Fine ${date(f.date)} — ${f.reason}`, f.amount)),
    ...(toPaisa(snap.deductions) ? [line('Other deductions', snap.deductions)] : []),
    ...(toPaisa(snap.statutoryEmployee) ? [line('Statutory (employee)', snap.statutoryEmployee)] : []),
    ...(toPaisa(snap.advanceRecovered) ? [line('Salary advances recovered', snap.advanceRecovered)] : []),
  ];
  const content: Content[] = [
    details([
      ['Name', e.fullName],
      ['Father’s name', e.fatherName ?? ''],
      ['Employee code', e.employeeCode],
      ['CNIC', e.cnic ?? ''],
      ['Designation', e.designation ?? ''],
      ['Unit', e.businessUnit?.name ?? ''],
      ['Joined', date(e.joinDate)],
      ['Last day', date(e.exitDate)],
      ['Reason', e.exitReason ?? ''],
      ['Status', s.status === 'PAID' ? `Paid ${s.paidOn ? date(s.paidOn) : ''}` : s.status === 'FINALIZED' ? 'Finalised — to pay' : 'Draft'],
    ]),
    heading('Owed to them'),
    table({ columns: [{ header: '', width: '*' }, { header: 'Rs', width: 90, align: 'right' }], rows: owed }),
    heading('Less'),
    table({ columns: [{ header: '', width: '*' }, { header: 'Rs', width: 90, align: 'right' }], rows: less.length ? less : [['Nothing', '']] }),
    headline(ctx, [
      { label: 'Net settlement', value: `Rs ${money(snap.net)}`, tone: 'accent' },
      ...(toPaisa(snap.stillOwed) ? [{ label: 'Advances still owed after this', value: money(snap.stillOwed), tone: 'danger' as const }] : []),
    ]),
    heading('Months settled'),
    table({
      columns: [
        { header: 'Month', width: '*' },
        { header: 'Salary', width: 64, align: 'right' },
        { header: 'Absent', width: 40, align: 'right' },
        { header: 'Earned', width: 64, align: 'right' },
        { header: 'Absence ded.', width: 60, align: 'right' },
        { header: 'For the days', width: 70, align: 'right' },
      ],
      rows: snap.months.map((mo) => [monthName(mo.month), money(mo.salary), mo.absentDays, money(mo.earned), money(mo.absenceDeduction), money(mo.salaryForDays)]),
      fontSize: 7.5,
    }),
    ...(s.warnings.length ? s.warnings.map((w) => note(w)) : []),
    { text: '\n\n\n', fontSize: 8 } as Content,
    {
      columns: [
        { text: '______________________________\nReceived by the employee', fontSize: 8, color: '#4A5750' },
        { text: '______________________________\nApproved (Accountant)', fontSize: 8, color: '#4A5750', alignment: 'right' },
      ],
    } as Content,
  ];
  return {
    subtitle: `${e.fullName} (${e.employeeCode}) · last day ${date(e.exitDate)}`,
    content,
    unitIds: e.businessUnit ? [e.businessUnit.id] : [],
    periodTo: e.exitDate,
    fileStem: `settlement-${slug(e.employeeCode)}-${e.exitDate}`,
  };
}
