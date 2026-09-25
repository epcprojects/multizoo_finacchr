import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { CostCentresService } from './cost-centres.service';
import { CostCentreReportQueryDto, CreateCostCentreDto, UpdateCostCentreDto } from './dto/cost-centre.dto';

const P = Permission;
/** Everyone who posts spending picks from the list. */
const PICK = { permissions: [P.LEDGER_VIEW, P.TRANSACTIONS_CREATE_OWN_UNIT, P.ACCOUNTS_MANAGE, P.RULES_EDIT_ALLOCATION] };
/** Set up by the Accountant (chart of accounts) or a Partner; partner routing is checked in the service. */
const MANAGE = { permissions: [P.ACCOUNTS_MANAGE, P.RULES_EDIT_ALLOCATION] };
const REPORT = { permissions: [P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED] };

@ApiTags('cost-centres')
@ApiBearerAuth('JWT-auth')
@Controller('cost-centres')
export class CostCentresController {
  constructor(private readonly centres: CostCentresService) {}

  @Get()
  @RequirePermission(PICK)
  list() {
    return this.centres.list();
  }

  @Post()
  @RequirePermission(MANAGE)
  create(@Body() dto: CreateCostCentreDto, @GetUser() user: AuthenticatedUser) {
    return this.centres.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(PICK)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.centres.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCostCentreDto, @GetUser() user: AuthenticatedUser) {
    return this.centres.update(id, dto, user);
  }

  @Get(':id/report')
  @RequirePermission(REPORT)
  report(@Param('id', ParseUUIDPipe) id: string, @Query() q: CostCentreReportQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.centres.report(id, q, user);
  }
}
