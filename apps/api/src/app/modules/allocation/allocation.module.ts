import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Partner } from './entities/partner.entity';
import {
  AllocationLine,
  AllocationRule,
  AllocationTranche,
} from './entities/allocation-rule.entity';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationService } from './allocation.service';
import { AllocationRulesService } from './allocation-rules.service';
import { PartnersService } from './partners.service';
import {
  AllocationController,
  AllocationRulesController,
  PartnersController,
} from './allocation.controller';

/** Module 3 — the income allocation waterfall, its versioned rules, and partners. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Partner, AllocationRule, AllocationTranche, AllocationLine, AllocationRun]),
    JournalModule,
    LedgerModule,
  ],
  controllers: [AllocationController, AllocationRulesController, PartnersController],
  providers: [AllocationService, AllocationRulesService, PartnersService],
})
export class AllocationModule {}
