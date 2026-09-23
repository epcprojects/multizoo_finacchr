import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { LedgerService } from './ledger.service';
import { AsOfQueryDto } from './dto/ledger.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';

@ApiTags('ledger')
@ApiBearerAuth('JWT-auth')
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('cash-position')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  cashPosition(@Query() query: AsOfQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.ledgerService.cashPosition(user, query.asOf);
  }

  @Get('trial-balance')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  trialBalance(@Query() query: AsOfQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.ledgerService.trialBalance(user, query.asOf, query.businessUnitId);
  }
}
