import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { BusinessUnitsService } from './business-units.service';
import {
  CreateBusinessUnitDto,
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
}
