import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In } from 'typeorm';
import { Permission, SystemRoles } from '@multizoo/types';
import { isIsoDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { hasAllUnitAccess, hasPermission } from '../../../common/scope/unit-scope';
import { LedgerService } from '../ledger/ledger.service';
import { PayrollService } from '../payroll/payroll.service';
import { BonusService } from '../payroll/bonus.service';
import { SettlementsService } from '../payroll/settlements.service';
import { AttendanceService } from '../hr/attendance.service';
import { LeaveService } from '../hr/leave.service';
import { DisciplinaryService } from '../hr/disciplinary.service';
import { LoansService } from '../loans/loans.service';
import { UtilitiesService } from '../utilities/utilities.service';
import { SalesService } from '../sales/sales.service';
import { CapexService } from '../capex/capex.service';
import { CampaignsService } from '../capex/campaigns.service';
import { CostCentresService } from '../cost-centres/cost-centres.service';
import { FinancialReportsService } from './financial-reports.service';
import { ReportArchive, ReportFile } from './entities/report.entity';
import { isSchedulable, REPORT_BY_KEY, REPORTS, type ReportDefinition, type ReportParamName, type ReportParams } from './report-catalogue';
import { PERIODS_FOR, RELATIVE_PERIOD_LABELS } from './report-periods';
import { documentDefinition, renderPdf } from './pdf/pdf-kit';
import type { BuildContext, ReportBuilder, ReportSources } from './builders/types';
import * as finance from './builders/finance.builders';
import * as hr from './builders/hr.builders';
import * as ops from './builders/operations.builders';
import type { ArchiveQueryDto } from './dto/reports.dto';

const BUILDERS: Record<string, ReportBuilder> = {
  'cash-position': finance.cashPosition,
  expenses: finance.expenses,
  'category-rollup': finance.categoryRollup,
  pnl: finance.pnl,
  'partner-statement': finance.partnerStatement,
  loans: finance.loans,
  'cost-centre': finance.costCentre,
  'payroll-register': hr.payrollRegister,
  payslips: hr.payslips,
  'bonus-sheet': hr.bonusSheet,
  'attendance-summary': hr.attendanceSummary,
  headcount: hr.headcount,
  disciplinary: hr.disciplinary,
  settlement: hr.settlement,
  'utility-bill': ops.utilityBill,
  sales: ops.sales,
  'capex-register': ops.capexRegister,
  campaign: ops.campaign,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_PARAMS: ReportParamName[] = [
  'businessUnitId',
  'partnerId',
  'runId',
  'employeeId',
  'poolId',
  'settlementId',
  'counterpartyId',
  'billId',
  'eventId',
  'campaignId',
  'costCentreId',
];

/**
 * Who a scheduled report runs as: the whole group in view (schedules are
 * set up by people who can already report on every unit), no login.
 */
export const SCHEDULER: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'scheduler@multizoo.local',
  fullName: 'Scheduled report',
  isActive: true,
  isInvitationAccepted: true,
  lastLoginAt: null,
  roles: [SystemRoles.SUPER_ADMIN],
  permissions: [],
  businessUnitIds: [],
};

/**
 * The reporting suite (architecture plan Part 08, module M12): every report
 * in the catalogue built from the same services as its screen, rendered to
 * PDF, and archived — retained and searchable by report, period and unit.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly sources: ReportSources;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    ledger: LedgerService,
    financial: FinancialReportsService,
    payroll: PayrollService,
    bonus: BonusService,
    settlements: SettlementsService,
    attendance: AttendanceService,
    leave: LeaveService,
    disciplinary: DisciplinaryService,
    loans: LoansService,
    utilities: UtilitiesService,
    sales: SalesService,
    capex: CapexService,
    campaigns: CampaignsService,
    costCentres: CostCentresService,
  ) {
    this.sources = { ledger, financial, payroll, bonus, settlements, attendance, leave, disciplinary, loans, utilities, sales, capex, campaigns, costCentres };
  }

  /**
   * "Generate & download PDF reports" (Part 10): Partner and Accountant
   * (`reports.generate`), Branch Manager and Branch Staff for their own unit
   * (`reports.generate_own_unit`) — and in each case only reports whose data
   * they can already see on screen.
   */
  canGenerate(def: ReportDefinition, user: AuthenticatedUser): boolean {
    if (user.roles.includes(SystemRoles.SUPER_ADMIN)) return true;
    const mayReport = hasPermission(user, Permission.REPORTS_GENERATE) || hasPermission(user, Permission.REPORTS_GENERATE_OWN_UNIT);
    return mayReport && def.permissions.some((p) => user.permissions.includes(p));
  }

  /** Schedules produce group-wide reports, so they need `reports.generate` as well as the data. */
  canSchedule(def: ReportDefinition, user: AuthenticatedUser): boolean {
    return isSchedulable(def) && hasPermission(user, Permission.REPORTS_GENERATE) && this.canGenerate(def, user);
  }

  definition(key: string): ReportDefinition {
    const def = REPORT_BY_KEY.get(key);
    if (!def) throw new NotFoundException(`There's no report called "${key}".`);
    return def;
  }

  catalogue(user: AuthenticatedUser) {
    return REPORTS.filter((d) => this.canGenerate(d, user)).map((d) => ({
      key: d.key,
      title: d.title,
      group: d.group,
      description: d.description,
      cadence: d.cadence,
      audience: d.audience,
      period: d.period,
      params: d.params,
      landscape: d.landscape,
      schedulable: this.canSchedule(d, user),
      relativePeriods: PERIODS_FOR[d.period].map((p) => ({ value: p, label: RELATIVE_PERIOD_LABELS[p] })),
    }));
  }

  /** Only the params the report takes, each checked; required ones must be there. */
  validateParams(def: ReportDefinition, raw: Record<string, unknown> | undefined, { requireAll = true } = {}): ReportParams {
    const input = raw ?? {};
    const allowed = new Set(def.params.map((p) => p.name));
    for (const key of Object.keys(input)) {
      if (!allowed.has(key as ReportParamName) && input[key] !== undefined && input[key] !== null && input[key] !== '') {
        throw new BadRequestException(`${def.title} doesn't take "${key}".`);
      }
    }
    const out: ReportParams = {};
    for (const spec of def.params) {
      const value = input[spec.name];
      if (value === undefined || value === null || value === '') {
        if (spec.required && requireAll) throw new BadRequestException(`${def.title}: pick ${spec.label.toLowerCase()}.`);
        continue;
      }
      if (spec.name === 'asOf' || spec.name === 'from' || spec.name === 'to') {
        if (!isIsoDate(value)) throw new BadRequestException(`${spec.label} must be a real date (YYYY-MM-DD).`);
        out[spec.name] = value;
      } else if (spec.name === 'month') {
        if (typeof value !== 'string' || !MONTH.test(value)) throw new BadRequestException('Month must be YYYY-MM.');
        out.month = value;
      } else if (spec.name === 'year') {
        const year = Number(value);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Year must be between 2000 and 2100.');
        out.year = year;
      } else if (ID_PARAMS.includes(spec.name)) {
        if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(`${spec.label} isn't a valid id.`);
        (out as Record<string, string>)[spec.name] = value;
      } else if (spec.name === 'status') {
        if (typeof value !== 'string' || value.length > 30) throw new BadRequestException('Status is not valid.');
        out.status = value;
      }
    }
    if (out.from && out.to) {
      if (out.from > out.to) throw new BadRequestException('The start date must be on or before the end date.');
      if (Date.parse(out.to) - Date.parse(out.from) > 400 * 86_400_000) throw new BadRequestException('Pick a period of at most a year.');
    }
    return out;
  }

  /** "All units" — or, for someone limited to their own, which ones ("CAFE"). */
  private async scopeName(user: AuthenticatedUser): Promise<string> {
    if (hasAllUnitAccess(user)) return 'All units';
    if (!user.businessUnitIds.length) return 'No units';
    const rows: { code: string }[] = await this.dataSource.query(
      'SELECT code FROM business_units WHERE id = ANY($1) ORDER BY code',
      [user.businessUnitIds],
    );
    return rows.map((r) => r.code).join(', ');
  }

  /** Build, render and archive one report. */
  async generate(
    key: string,
    rawParams: Record<string, unknown> | undefined,
    user: AuthenticatedUser,
    opts: { scheduleId?: string; generatedByName?: string } = {},
  ) {
    const def = this.definition(key);
    if (!this.canGenerate(def, user)) throw new ForbiddenException(`You can't generate the ${def.title.toLowerCase()}.`);
    const params = this.validateParams(def, rawParams);
    const ctx: BuildContext = { def, params, user, src: this.sources, scopeName: await this.scopeName(user), highlights: [] };
    const built = await BUILDERS[def.key](ctx);

    const generatedAt = new Date();
    const pdf = await renderPdf(
      documentDefinition({
        title: built.title ?? def.title,
        subtitle: built.subtitle,
        landscape: def.landscape,
        content: built.content,
        generatedAt,
        generatedBy: opts.generatedByName ?? `By ${user.fullName}`,
        amounts: def.amounts ?? true,
      }),
    );
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const id = await this.dataSource.transaction(async (m) => {
      const row = await m.save(
        m.create(ReportArchive, {
          reportKey: def.key,
          title: built.title ?? def.title,
          subtitle: built.subtitle,
          params: params as Record<string, unknown>,
          unitIds: built.unitIds,
          highlights: ctx.highlights,
          periodFrom: built.periodFrom ?? null,
          periodTo: built.periodTo ?? null,
          fileName: `${built.fileStem}.pdf`,
          sizeBytes: pdf.length,
          sha256,
          generatedBy: opts.scheduleId ? null : user.id,
          scheduleId: opts.scheduleId ?? null,
        }),
      );
      await m.save(m.create(ReportFile, { archiveId: row.id, content: pdf }));
      return row.id;
    });
    this.logger.log(`Generated ${def.key} (${pdf.length} bytes) → ${id}`);
    return (await this.shape([await this.dataSource.manager.findOneOrFail(ReportArchive, { where: { id } })]))[0];
  }

  private async shape(rows: ReportArchive[]) {
    const userIds = [...new Set(rows.map((r) => r.generatedBy).filter(Boolean) as string[])];
    const users = userIds.length ? await this.dataSource.manager.find(User, { where: { id: In(userIds) }, withDeleted: true }) : [];
    const units: { id: string; code: string }[] = await this.dataSource.query(`SELECT id, code FROM business_units`);
    const code = new Map(units.map((u) => [u.id, u.code]));
    return rows.map((r) => ({
      id: r.id,
      reportKey: r.reportKey,
      title: r.title,
      subtitle: r.subtitle,
      params: r.params,
      units: r.unitIds.map((u) => code.get(u) ?? '?'),
      highlights: r.highlights,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      createdAt: r.createdAt,
      generatedByName: r.generatedBy ? (users.find((u) => u.id === r.generatedBy)?.fullName ?? null) : null,
      scheduleId: r.scheduleId,
    }));
  }

  /** The reports this caller could generate, covering only units they can see. */
  private scopedArchive(user: AuthenticatedUser) {
    const keys = REPORTS.filter((d) => this.canGenerate(d, user)).map((d) => d.key);
    const qb = this.dataSource.manager.createQueryBuilder(ReportArchive, 'r').where('r.reportKey IN (:...keys)', { keys: keys.length ? keys : ['-'] });
    if (!hasAllUnitAccess(user)) {
      qb.andWhere('cardinality(r."unitIds") > 0 AND r."unitIds" <@ CAST(:mine AS uuid[])', { mine: user.businessUnitIds });
    }
    return qb;
  }

  async listArchive(q: ArchiveQueryDto, user: AuthenticatedUser) {
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 25, 100);
    const qb = this.scopedArchive(user);
    if (q.reportKey) qb.andWhere('r.reportKey = :key', { key: q.reportKey });
    if (q.businessUnitId) qb.andWhere('(:u = ANY(r."unitIds") OR cardinality(r."unitIds") = 0)', { u: q.businessUnitId });
    // A report is in range when its period overlaps the range (or, with no period, when it was generated in it).
    if (q.from) qb.andWhere('COALESCE(r.periodTo, r.periodFrom, r."createdAt"::date) >= :from', { from: q.from });
    if (q.to) qb.andWhere('COALESCE(r.periodFrom, r.periodTo, r."createdAt"::date) <= :to', { to: q.to });
    if (q.search) qb.andWhere('(r.title ILIKE :s OR r.subtitle ILIKE :s OR r.fileName ILIKE :s)', { s: `%${q.search}%` });
    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items: await this.shape(rows), total, page, limit };
  }

  async file(id: string, user: AuthenticatedUser) {
    const row = await this.scopedArchive(user).andWhere('r.id = :id', { id }).getOne();
    if (!row) throw new NotFoundException('Report not found');
    const file = await this.dataSource.manager.findOne(ReportFile, { where: { archiveId: id } });
    if (!file) throw new NotFoundException('The PDF for this report is missing');
    return { fileName: row.fileName, content: file.content };
  }
}
