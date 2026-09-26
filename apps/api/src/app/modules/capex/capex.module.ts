import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalModule } from '../journal/journal.module';
import { Campaign, CampaignEntry, CapexItem } from './entities/capex.entity';
import { CapexService } from './capex.service';
import { CampaignsService } from './campaigns.service';
import { CampaignsController, CapexController } from './capex.controller';

/** Module 7 — capex register and seasonal campaigns (M11). */
@Module({
  imports: [TypeOrmModule.forFeature([CapexItem, Campaign, CampaignEntry]), JournalModule],
  controllers: [CapexController, CampaignsController],
  providers: [CapexService, CampaignsService],
})
export class CapexModule {}
