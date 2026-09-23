import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { User } from '../users/entities/user.entity';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([JournalEntry, JournalLine, Account, BusinessUnit, User]),
  ],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
