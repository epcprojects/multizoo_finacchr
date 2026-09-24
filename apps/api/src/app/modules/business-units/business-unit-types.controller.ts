import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { BusinessUnitTypesService } from './business-unit-types.service';
import {
  CreateBusinessUnitTypeDto,
  UpdateBusinessUnitTypeDto,
} from './dto/business-unit.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';

@ApiTags('business-unit-types')
@ApiBearerAuth('JWT-auth')
@Controller('business-unit-types')
export class BusinessUnitTypesController {
  constructor(private readonly typesService: BusinessUnitTypesService) {}

  /** Any signed-in user — unit cards and filters show the type name. */
  @Get()
  list(@Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.typesService.list(includeInactive ?? false);
  }

  @Post()
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  create(@Body() dto: CreateBusinessUnitTypeDto, @GetUser() user: AuthenticatedUser) {
    return this.typesService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: [Permission.BUSINESS_UNITS_MANAGE] })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessUnitTypeDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.typesService.update(id, dto, user);
  }
}
