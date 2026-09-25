import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { PAYROLL_VIEWERS } from './payroll-common';
import { PayrollService } from './payroll.service';
import { AdvancesService } from './advances.service';
import { BonusService } from './bonus.service';
import { PayrollPoliciesService } from './policies.service';
import { SettlementsService } from './settlements.service';
import {
  CreateAdvanceDto,
  CreateBonusPoolDto,
  CreatePayrollPolicyDto,
  CreatePayrollRunDto,
  CreateSettlementDto,
  FinalizeDto,
  ListAdvancesQueryDto,
  ListBonusPoolsQueryDto,
  ListSettlementsQueryDto,
  MonthQueryDto,
  PayDto,
  PayrollAdjustmentDto,
  ReasonDto,
  SetBonusMembersDto,
  UpdateBonusPoolDto,
  UpdateSettlementDto,
} from './dto/payroll.dto';

const P = Permission;
const RUN = { permissions: [P.PAYROLL_RUN] };
const VIEW = { permissions: PAYROLL_VIEWERS };

/** Payroll runs, payslips and the payroll policy. */
@ApiTags('payroll')
@ApiBearerAuth('JWT-auth')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly policies: PayrollPoliciesService,
  ) {}

  @Get('stats')
  @RequirePermission(VIEW)
  stats(@GetUser() user: AuthenticatedUser) {
    return this.payroll.stats(user);
  }

  @Get('overview')
  @RequirePermission(VIEW)
  overview(@Query() q: MonthQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.overview(q.month, user);
  }

  @Get('runs')
  @RequirePermission(VIEW)
  list(@Query('year') year: string | undefined, @GetUser() user: AuthenticatedUser) {
    return this.payroll.list(user, year ? Number(year) : undefined);
  }

  @Post('runs')
  @RequirePermission(RUN)
  create(@Body() dto: CreatePayrollRunDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.create(dto, user);
  }

  @Get('runs/:id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.payroll.findOne(id, user);
  }

  @Delete('runs/:id')
  @RequirePermission(RUN)
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.payroll.remove(id, user);
  }

  @Get('runs/:id/payslips/:employeeId')
  @RequirePermission(VIEW)
  payslip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.payroll.payslip(id, employeeId, user);
  }

  @Post('runs/:id/adjustments')
  @RequirePermission(RUN)
  addAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayrollAdjustmentDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.addAdjustment(id, dto, user);
  }

  @Delete('runs/:id/adjustments/:adjustmentId')
  @RequirePermission(RUN)
  removeAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.payroll.removeAdjustment(id, adjustmentId, user);
  }

  @Post('runs/:id/finalize')
  @RequirePermission(RUN)
  finalize(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FinalizeDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.finalize(id, dto, user);
  }

  @Post('runs/:id/reopen')
  @RequirePermission(RUN)
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.reopen(id, dto.reason, user);
  }

  @Post('runs/:id/pay')
  @RequirePermission(RUN)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto, @GetUser() user: AuthenticatedUser) {
    return this.payroll.pay(id, dto, user);
  }

  @Get('employees/:employeeId/payslips')
  @RequirePermission(VIEW)
  employeePayslips(@Param('employeeId', ParseUUIDPipe) employeeId: string, @GetUser() user: AuthenticatedUser) {
    return this.payroll.employeePayslips(employeeId, user);
  }

  @Get('policies')
  @RequirePermission({ permissions: [...PAYROLL_VIEWERS, P.RULES_EDIT_HR_POLICY] })
  policiesList() {
    return this.policies.list();
  }

  @Post('policies')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  createPolicy(@Body() dto: CreatePayrollPolicyDto, @GetUser() user: AuthenticatedUser) {
    return this.policies.create(dto, user);
  }
}

/** Salary advances. */
@ApiTags('payroll')
@ApiBearerAuth('JWT-auth')
@Controller('payroll/advances')
export class AdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  @Get()
  @RequirePermission(VIEW)
  list(@Query() q: ListAdvancesQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.advances.list(q, user);
  }

  @Post()
  @RequirePermission(RUN)
  create(@Body() dto: CreateAdvanceDto, @GetUser() user: AuthenticatedUser) {
    return this.advances.create(dto, user);
  }

  @Post(':id/cancel')
  @RequirePermission(RUN)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @GetUser() user: AuthenticatedUser) {
    return this.advances.cancel(id, dto.reason, user);
  }
}

/** Commission pools — the Bonus Calculator. */
@ApiTags('payroll')
@ApiBearerAuth('JWT-auth')
@Controller('payroll/bonus-pools')
export class BonusPoolsController {
  constructor(private readonly bonus: BonusService) {}

  @Get()
  @RequirePermission(VIEW)
  list(@Query() q: ListBonusPoolsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.bonus.list(q, user);
  }

  @Post()
  @RequirePermission(RUN)
  create(@Body() dto: CreateBonusPoolDto, @GetUser() user: AuthenticatedUser) {
    return this.bonus.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.bonus.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission(RUN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBonusPoolDto, @GetUser() user: AuthenticatedUser) {
    return this.bonus.update(id, dto, user);
  }

  @Put(':id/members')
  @RequirePermission(RUN)
  setMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBonusMembersDto, @GetUser() user: AuthenticatedUser) {
    return this.bonus.setMembers(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermission(RUN)
  approve(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.bonus.approve(id, user);
  }

  @Post(':id/unapprove')
  @RequirePermission(RUN)
  unapprove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.bonus.unapprove(id, user);
  }

  @Delete(':id')
  @RequirePermission(RUN)
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.bonus.remove(id, user);
  }
}

/** Full & final settlements. */
@ApiTags('payroll')
@ApiBearerAuth('JWT-auth')
@Controller('payroll/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermission(VIEW)
  list(@Query() q: ListSettlementsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.settlements.list(q, user);
  }

  @Get('awaiting')
  @RequirePermission(VIEW)
  awaiting(@GetUser() user: AuthenticatedUser) {
    return this.settlements.awaiting(user);
  }

  @Post()
  @RequirePermission(RUN)
  create(@Body() dto: CreateSettlementDto, @GetUser() user: AuthenticatedUser) {
    return this.settlements.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.settlements.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission(RUN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSettlementDto, @GetUser() user: AuthenticatedUser) {
    return this.settlements.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission(RUN)
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.settlements.remove(id, user);
  }

  @Post(':id/finalize')
  @RequirePermission(RUN)
  finalize(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.settlements.finalize(id, user);
  }

  @Post(':id/reopen')
  @RequirePermission(RUN)
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @GetUser() user: AuthenticatedUser) {
    return this.settlements.reopen(id, dto.reason, user);
  }

  @Post(':id/pay')
  @RequirePermission(RUN)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto, @GetUser() user: AuthenticatedUser) {
    return this.settlements.pay(id, dto, user);
  }
}
