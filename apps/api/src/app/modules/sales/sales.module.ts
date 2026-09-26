import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { SalesDay, SalesEvent, SalesItem, SalesLine } from './entities/sales.entity';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';

/** Module 7 — sales & ticketing (M9): price lists, daily sheets posted as money in, live rollups. */
@Module({
  imports: [TypeOrmModule.forFeature([SalesItem, SalesDay, SalesLine, SalesEvent]), JournalModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
