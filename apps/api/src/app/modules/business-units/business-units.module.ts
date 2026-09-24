import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessUnit } from './entities/business-unit.entity';
import { BusinessUnitType } from './entities/business-unit-type.entity';
import { Account } from '../accounts/entities/account.entity';
import { AccountClass } from '../accounts/entities/account-class.entity';
import { UserBusinessUnit } from '../users/entities/user.business-unit.entity';
import { JournalModule } from '../journal/journal.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BusinessUnitsService } from './business-units.service';
import { BusinessUnitsController } from './business-units.controller';
import { BusinessUnitTypesService } from './business-unit-types.service';
import { BusinessUnitTypesController } from './business-unit-types.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessUnit, BusinessUnitType, Account, AccountClass, UserBusinessUnit]),
    JournalModule,
    LedgerModule,
  ],
  controllers: [BusinessUnitsController, BusinessUnitTypesController],
  providers: [BusinessUnitsService, BusinessUnitTypesService],
})
export class BusinessUnitsModule {}
