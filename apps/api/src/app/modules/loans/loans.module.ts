import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { Counterparty, Loan, LoanMovement } from './entities/loan.entity';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';

/** Module 6 — the loans & counterparty ledger (M4), staff advances included. */
@Module({
  imports: [TypeOrmModule.forFeature([Counterparty, Loan, LoanMovement]), JournalModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
