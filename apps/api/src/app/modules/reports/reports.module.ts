import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { PayrollModule } from '../payroll/payroll.module';
import { HrModule } from '../hr/hr.module';
import { LoansModule } from '../loans/loans.module';
import { UtilitiesModule } from '../utilities/utilities.module';
import { SalesModule } from '../sales/sales.module';
import { CapexModule } from '../capex/capex.module';
import { CostCentresModule } from '../cost-centres/cost-centres.module';
import { ReportArchive, ReportFile, ReportSchedule } from './entities/report.entity';
import { FinancialReportsService } from './financial-reports.service';
import { ReportsService } from './reports.service';
import { SchedulesService } from './schedules.service';
import { ReportsController } from './reports.controller';

/** Module 8 — the PDF reporting suite (M12): catalogue, archive, schedules. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ReportArchive, ReportFile, ReportSchedule]),
    LedgerModule,
    PayrollModule,
    HrModule,
    LoansModule,
    UtilitiesModule,
    SalesModule,
    CapexModule,
    CostCentresModule,
  ],
  controllers: [ReportsController],
  providers: [FinancialReportsService, ReportsService, SchedulesService],
})
export class ReportsModule {}
