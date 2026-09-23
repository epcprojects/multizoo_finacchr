import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { BusinessUnitsService } from './business-units.service';
import {
  AddUnitAccountsDto,
  CreateBusinessUnitDto,
  SetOpeningBalancesDto,
  UpdateBusinessUnitDto,
} from './dto/business-unit.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';

@ApiTags('business-units')
@ApiBearerAuth('JWT-auth')
@Controller('business-units')
export class BusinessUnitsController {
  constructor(private readonly unitsService: BusinessUnitsService) {}

  /** Every signed-in user can list the units they have access to. */
  @Get()
  list(@GetUser() user: AuthenticatedUser) {
    return this.unitsService.list(user);
  }

  @Get('templates')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  templates() {
    return this.unitsService.templates();
  }

  @Post()
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  create(@Body() dto: CreateBusinessUnitDto, @GetUser() user: AuthenticatedUser) {
    return this.unitsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessUnitDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.update(id, dto, user);
  }

  @Post(':id/accounts')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  addAccounts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddUnitAccountsDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.addAccounts(id, dto, user);
  }

  @Get(':id/opening-balances')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE, Permission.LEDGER_VIEW] })
  openingBalances(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.unitsService.getOpeningBalances(id, user);
  }

  @Put(':id/opening-balances')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  setOpeningBalances(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOpeningBalancesDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.setOpeningBalances(id, dto, user);
  }
}
