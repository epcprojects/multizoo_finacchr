import type { Content } from 'pdfmake/interfaces';
import { figures } from '../pdf/pdf-kit';
import type { AuthenticatedUser } from '../../users/users.service';
import { visibleUnitIds } from '../../../../common/scope/unit-scope';
import type { LedgerService } from '../../ledger/ledger.service';
import type { PayrollService } from '../../payroll/payroll.service';
import type { BonusService } from '../../payroll/bonus.service';
import type { SettlementsService } from '../../payroll/settlements.service';
import type { AttendanceService } from '../../hr/attendance.service';
import type { LeaveService } from '../../hr/leave.service';
import type { DisciplinaryService } from '../../hr/disciplinary.service';
import type { LoansService } from '../../loans/loans.service';
import type { UtilitiesService } from '../../utilities/utilities.service';
import type { SalesService } from '../../sales/sales.service';
import type { CapexService } from '../../capex/capex.service';
import type { CampaignsService } from '../../capex/campaigns.service';
import type { CostCentresService } from '../../cost-centres/cost-centres.service';
import type { FinancialReportsService } from '../financial-reports.service';
import type { ReportDefinition, ReportParams } from '../report-catalogue';

/** The services a report reads from — the same ones behind each screen, so the PDF and the page agree. */
export interface ReportSources {
  ledger: LedgerService;
  financial: FinancialReportsService;
  payroll: PayrollService;
  bonus: BonusService;
  settlements: SettlementsService;
  attendance: AttendanceService;
  leave: LeaveService;
  disciplinary: DisciplinaryService;
  loans: LoansService;
  utilities: UtilitiesService;
  sales: SalesService;
  capex: CapexService;
  campaigns: CampaignsService;
  costCentres: CostCentresService;
}

export interface Highlight {
  label: string;
  value: string;
}

export interface BuildContext {
  def: ReportDefinition;
  params: ReportParams;
  user: AuthenticatedUser;
  src: ReportSources;
  /** "All units", or the caller's own units ("CAFE") when they can't see every unit. */
  scopeName: string;
  /** The report's headline figures, kept with the archive entry. */
  highlights: Highlight[];
}

export interface BuiltReport {
  /** Instead of the catalogue title — "Payslip" for one person. */
  title?: string;
  /** The period / record in words, under the title. */
  subtitle: string;
  content: Content[];
  /** Units the report covers; [] = the whole group. */
  unitIds: string[];
  periodFrom?: string | null;
  periodTo?: string | null;
  /** The file name without the extension: "pnl-2026-08". */
  fileStem: string;
}

export type ReportBuilder = (ctx: BuildContext) => Promise<BuiltReport>;

/** One unit if picked; otherwise every unit the caller can see ([] when that's all of them). */
export function coveredUnits(ctx: BuildContext, unitId?: string | null): string[] {
  if (unitId) return [unitId];
  return visibleUnitIds(ctx.user) ?? [];
}

/** The headline figures at the top of a report — the first set is also kept in the archive. */
export function headline(ctx: BuildContext, items: (Highlight & { tone?: 'danger' | 'accent' })[]): Content {
  if (!ctx.highlights.length) ctx.highlights.push(...items.map(({ label, value }) => ({ label, value })));
  return figures(items);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
