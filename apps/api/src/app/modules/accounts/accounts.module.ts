import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Account, BusinessUnit]), LedgerModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
