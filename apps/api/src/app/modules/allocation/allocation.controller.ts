import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { AsOfQueryDto } from '../ledger/dto/ledger.dto';
import { AllocationService } from './allocation.service';
import { AllocationRulesService } from './allocation-rules.service';
import { PartnersService } from './partners.service';
import {
  AllocateDayDto,
  AllocatePendingDto,
  AllocationDaysQueryDto,
  CreateAllocationRuleDto,
  CreatePartnerDto,
  ListAllocationRulesQueryDto,
  PreviewAllocationRuleDto,
  ReviewAllocationRuleDto,
  SetOpeningReservesDto,
  UndoRunDto,
  UpdateAllocationRuleDto,
  UpdatePartnerDto,
} from './dto/allocation.dto';

const RULE_AUTHORS = [Permission.RULES_PROPOSE_ALLOCATION, Permission.RULES_EDIT_ALLOCATION];

@ApiTags('allocation')
@ApiBearerAuth('JWT-auth')
@Controller('allocation')
export class AllocationController {
  constructor(private readonly allocation: AllocationService) {}

  @Get('overview')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  overview(@GetUser() user: AuthenticatedUser) {
    return this.allocation.overview(user);
  }

  @Get('units/:id/days')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  days(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AllocationDaysQueryDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.days(id, user, query.from, query.to);
  }

  @Post('units/:id/allocate')
  @RequirePermission({ permissions: [Permission.ALLOCATION_RUN] })
  allocateDay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocateDayDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.allocateDay(id, dto.date, user);
  }

  @Post('units/:id/allocate-outstanding')
  @RequirePermission({ permissions: [Permission.ALLOCATION_RUN] })
  allocateOutstanding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocatePendingDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.allocateOutstanding(id, user, dto.upTo);
  }

  @Post('runs/:id/undo')
  @RequirePermission({ permissions: [Permission.ALLOCATION_RUN] })
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoRunDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.undoRun(id, user, dto.reason);
  }

  @Get('units/:id/reserves')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW, Permission.TRANSACTIONS_CREATE_OWN_UNIT] })
  reserves(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AsOfQueryDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.reserves(id, user, query.asOf);
  }

  @Put('units/:id/opening-reserves')
  @RequirePermission({ permissions: [Permission.LEDGER_RECONCILE] })
  setOpeningReserves(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOpeningReservesDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.allocation.setOpeningReserves(id, dto, user);
  }
}

@ApiTags('allocation-rules')
@ApiBearerAuth('JWT-auth')
@Controller('allocation-rules')
export class AllocationRulesController {
  constructor(private readonly rules: AllocationRulesService) {}

  @Get()
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW, ...RULE_AUTHORS] })
  list(@Query() query: ListAllocationRulesQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.rules.list(query, user);
  }

  /** Declared before :id so "preview" isn't parsed as an id. */
  @Post('preview')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW, ...RULE_AUTHORS] })
  preview(@Body() dto: PreviewAllocationRuleDto, @GetUser() user: AuthenticatedUser) {
    return this.rules.preview(dto, user);
  }

  @Get(':id')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW, ...RULE_AUTHORS] })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.rules.findOne(id, user);
  }

  @Post()
  @RequirePermission({ permissions: RULE_AUTHORS })
  create(@Body() dto: CreateAllocationRuleDto, @GetUser() user: AuthenticatedUser) {
    return this.rules.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: RULE_AUTHORS })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllocationRuleDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.rules.update(id, dto, user);
  }

  @Post(':id/submit')
  @RequirePermission({ permissions: RULE_AUTHORS })
  submit(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.rules.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermission({ permissions: [Permission.RULES_EDIT_ALLOCATION] })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAllocationRuleDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.rules.approve(id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermission({ permissions: [Permission.RULES_EDIT_ALLOCATION] })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAllocationRuleDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.rules.reject(id, dto, user);
  }

  @Post(':id/withdraw')
  @RequirePermission({ permissions: RULE_AUTHORS })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.rules.withdraw(id, user);
  }
}

@ApiTags('partners')
@ApiBearerAuth('JWT-auth')
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW, Permission.LEDGER_RECONCILE, ...RULE_AUTHORS] })
  list(@GetUser() user: AuthenticatedUser) {
    return this.partners.list(user);
  }

  @Post()
  @RequirePermission({ permissions: RULE_AUTHORS })
  create(@Body() dto: CreatePartnerDto, @GetUser() user: AuthenticatedUser) {
    return this.partners.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: RULE_AUTHORS })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.partners.update(id, dto, user);
  }
}
