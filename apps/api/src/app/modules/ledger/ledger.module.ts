import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountClass } from '../accounts/entities/account-class.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalLine } from '../journal/entities/journal-line.entity';
import { User } from '../users/entities/user.entity';
import { CashReconciliation } from './entities/cash-reconciliation.entity';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([JournalLine, Account, AccountClass, BusinessUnit, CashReconciliation, User]),
  ],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
