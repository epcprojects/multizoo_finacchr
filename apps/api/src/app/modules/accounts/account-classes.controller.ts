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
import { AccountClassesService } from './account-classes.service';
import {
  CreateAccountClassDto,
  UpdateAccountClassDto,
  UpdateChartSettingsDto,
} from './dto/account-class.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';

const READERS = [
  Permission.LEDGER_VIEW,
  Permission.TRANSACTIONS_CREATE_OWN_UNIT,
  Permission.ACCOUNTS_MANAGE,
  Permission.BUSINESS_UNITS_MANAGE,
];

@ApiTags('chart-settings')
@ApiBearerAuth('JWT-auth')
@Controller()
export class AccountClassesController {
  constructor(private readonly classesService: AccountClassesService) {}

  @Get('account-classes')
  @RequirePermission({ permissions: READERS })
  list(@Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.classesService.list(includeInactive ?? false);
  }

  @Post('account-classes')
  @RequirePermission({ permissions: [Permission.ACCOUNTS_MANAGE] })
  create(@Body() dto: CreateAccountClassDto, @GetUser() user: AuthenticatedUser) {
    return this.classesService.create(dto, user);
  }

  @Patch('account-classes/:id')
  @RequirePermission({ permissions: [Permission.ACCOUNTS_MANAGE] })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountClassDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.classesService.update(id, dto, user);
  }

  @Get('chart-settings')
  @RequirePermission({ permissions: READERS })
  settings() {
    return this.classesService.getSettings();
  }

  @Patch('chart-settings')
  @RequirePermission({ permissions: [Permission.ACCOUNTS_MANAGE] })
  updateSettings(@Body() dto: UpdateChartSettingsDto, @GetUser() user: AuthenticatedUser) {
    return this.classesService.updateSettings(dto, user);
  }
}
