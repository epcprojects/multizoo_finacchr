import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, SalaryAdvanceStatus } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { LoansService } from './loans.service';
import {
  CreateCounterpartyDto,
  CreateLoanDto,
  InterUnitTransferDto,
  ListLoansQueryDto,
  LoanMovementDto,
  ReviewDto,
  UpdateCounterpartyDto,
  UpdateLoanDto,
  WriteOffDto,
} from './dto/loans.dto';

const P = Permission;
/** Roles table: "Approve loans & inter-unit transfers — Partner ✓, Accountant initiate only". */
const VIEW = { permissions: [P.LOANS_INITIATE, P.LOANS_APPROVE] };
const INITIATE = { permissions: [P.LOANS_INITIATE, P.LOANS_APPROVE] };
const APPROVE = { permissions: [P.LOANS_APPROVE] };

@ApiTags('loans')
@ApiBearerAuth('JWT-auth')
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  // Fixed paths first — `:id` would swallow them otherwise.

  @Get('stats')
  @RequirePermission(VIEW)
  stats(@GetUser() user: AuthenticatedUser) {
    return this.loans.stats(user);
  }

  @Get('approvals')
  @RequirePermission(VIEW)
  approvals(@GetUser() user: AuthenticatedUser) {
    return this.loans.approvals(user);
  }

  @Get('counterparties')
  @RequirePermission(VIEW)
  counterparties(@GetUser() user: AuthenticatedUser) {
    return this.loans.listCounterparties(user);
  }

  @Post('counterparties')
  @RequirePermission(INITIATE)
  createCounterparty(@Body() dto: CreateCounterpartyDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.createCounterparty(dto, user);
  }

  @Get('counterparties/:id')
  @RequirePermission(VIEW)
  counterparty(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.counterpartyStatement(id, user);
  }

  @Patch('counterparties/:id')
  @RequirePermission(INITIATE)
  updateCounterparty(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCounterpartyDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.updateCounterparty(id, dto, user);
  }

  @Get('inter-unit')
  @RequirePermission(VIEW)
  interUnit(@GetUser() user: AuthenticatedUser) {
    return this.loans.interUnit(user);
  }

  @Post('inter-unit/transfers')
  @RequirePermission(INITIATE)
  transfer(@Body() dto: InterUnitTransferDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.transfer(dto, user);
  }

  @Get('staff-advances')
  @RequirePermission(VIEW)
  staffAdvances(@Query('status') status: SalaryAdvanceStatus | undefined, @GetUser() user: AuthenticatedUser) {
    return this.loans.staffAdvances(user, status && Object.values(SalaryAdvanceStatus).includes(status) ? status : undefined);
  }

  @Post('staff-advances/:id/write-off')
  @RequirePermission(APPROVE)
  writeOff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WriteOffDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.writeOffAdvance(id, dto, user);
  }

  @Post('staff-advances/:id/undo-write-off')
  @RequirePermission(APPROVE)
  undoWriteOff(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.undoWriteOff(id, user);
  }

  @Post('movements/:id/approve')
  @RequirePermission(APPROVE)
  approveMovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.approveMovement(id, dto, user);
  }

  @Post('movements/:id/reject')
  @RequirePermission(APPROVE)
  rejectMovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.rejectMovement(id, dto, user);
  }

  @Post('movements/:id/withdraw')
  @RequirePermission(INITIATE)
  withdrawMovement(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.withdrawMovement(id, user);
  }

  @Post('movements/:id/reverse')
  @RequirePermission(INITIATE)
  reverseMovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.reverseMovement(id, dto, user);
  }

  @Get()
  @RequirePermission(VIEW)
  list(@Query() query: ListLoansQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.list(query, user);
  }

  @Post()
  @RequirePermission(INITIATE)
  create(@Body() dto: CreateLoanDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission(INITIATE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLoanDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.update(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermission(APPROVE)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.approveLoan(id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermission(APPROVE)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.rejectLoan(id, dto, user);
  }

  @Post(':id/close')
  @RequirePermission(INITIATE)
  close(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.close(id, user);
  }

  @Post(':id/reopen')
  @RequirePermission(INITIATE)
  reopen(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.loans.reopen(id, user);
  }

  @Post(':id/movements')
  @RequirePermission(INITIATE)
  addMovement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LoanMovementDto, @GetUser() user: AuthenticatedUser) {
    return this.loans.addMovement(id, dto, user);
  }
}
