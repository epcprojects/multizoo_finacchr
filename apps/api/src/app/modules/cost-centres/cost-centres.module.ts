import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CostCentre } from './entities/cost-centre.entity';
import { CostCentresService } from './cost-centres.service';
import { CostCentresController } from './cost-centres.controller';

/** Module 6 — cost-centre cross-charge (M10). The routing itself lives in JournalService. */
@Module({
  imports: [TypeOrmModule.forFeature([CostCentre])],
  controllers: [CostCentresController],
  providers: [CostCentresService],
})
export class CostCentresModule {}
