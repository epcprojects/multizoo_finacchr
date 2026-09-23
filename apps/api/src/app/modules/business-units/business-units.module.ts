import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessUnit } from './entities/business-unit.entity';
import { Account } from '../accounts/entities/account.entity';
import { UserBusinessUnit } from '../users/entities/user.business-unit.entity';
import { JournalModule } from '../journal/journal.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BusinessUnitsService } from './business-units.service';
import { BusinessUnitsController } from './business-units.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessUnit, Account, UserBusinessUnit]),
    JournalModule,
    LedgerModule,
  ],
  controllers: [BusinessUnitsController],
  providers: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
