import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { LoansModule } from '../loans/loans.module';
import { SubMeter, UtilityBill, UtilityConnection } from './entities/utility.entity';
import { UtilitiesService } from './utilities.service';
import { UtilitiesController } from './utilities.controller';

/** Module 6 — utility sub-meter allocation (M8). Recharges go through the inter-unit accounts (M4). */
@Module({
  imports: [TypeOrmModule.forFeature([UtilityConnection, SubMeter, UtilityBill]), JournalModule, LoansModule],
  controllers: [UtilitiesController],
  providers: [UtilitiesService],
})
export class UtilitiesModule {}
