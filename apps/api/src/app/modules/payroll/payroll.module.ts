import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { HrModule } from '../hr/hr.module';
import { PayrollAdjustment, PayrollPolicy, PayrollRun, Payslip } from './entities/payroll.entity';
import { AdvanceRecovery, SalaryAdvance } from './entities/advance.entity';
import { BonusPool, BonusPoolMember } from './entities/bonus.entity';
import { FinalSettlement } from './entities/settlement.entity';
import { PayrollEngine } from './payroll-engine.service';
import { PayrollService } from './payroll.service';
import { AdvancesService } from './advances.service';
import { BonusService } from './bonus.service';
import { PayrollPoliciesService } from './policies.service';
import { SettlementsService } from './settlements.service';
import { AdvancesController, BonusPoolsController, PayrollController, SettlementsController } from './payroll.controller';

/** Module 5 — payroll (M6), the incentive engine (M7), full & final settlement (M16). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayrollPolicy,
      PayrollRun,
      PayrollAdjustment,
      Payslip,
      SalaryAdvance,
      AdvanceRecovery,
      BonusPool,
      BonusPoolMember,
      FinalSettlement,
    ]),
    JournalModule,
    HrModule,
  ],
  controllers: [PayrollController, AdvancesController, BonusPoolsController, SettlementsController],
  providers: [PayrollEngine, PayrollService, AdvancesService, BonusService, PayrollPoliciesService, SettlementsService],
})
export class PayrollModule {}
