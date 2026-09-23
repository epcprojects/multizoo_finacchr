import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { AccountClass } from './entities/account-class.entity';
import { ChartSettings } from './entities/chart-settings.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { AccountClassesService } from './account-classes.service';
import { AccountClassesController } from './account-classes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, AccountClass, ChartSettings, BusinessUnit]),
    LedgerModule,
  ],
  controllers: [AccountsController, AccountClassesController],
  providers: [AccountsService, AccountClassesService],
  exports: [AccountsService, AccountClassesService],
})
export class AccountsModule {}
