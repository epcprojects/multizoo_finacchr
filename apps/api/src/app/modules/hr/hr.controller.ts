import {
  Body,
  Controller,
  Delete,
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
import { HR_VIEWERS } from './hr-common';
import { OrgService } from './org.service';
import { EmployeesService } from './employees.service';
import { AttendanceService } from './attendance.service';
import { LeaveService } from './leave.service';
import { DisciplinaryService } from './disciplinary.service';
import {
  AttendanceRegisterQueryDto,
  AttendanceSheetQueryDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateDisciplinaryDto,
  CreateEmployeeDto,
  CreateHolidayDto,
  CreateHrPolicyDto,
  CreateLeaveAdjustmentDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  HolidayQueryDto,
  LeaveBalancesQueryDto,
  LeaveRequestBodyDto,
  ListDisciplinaryQueryDto,
  ListEmployeesQueryDto,
  ListLeaveRequestsQueryDto,
  MonthQueryDto,
  RecordExitDto,
  ReviewNoteDto,
  SalaryRevisionDto,
  SaveAttendanceSheetDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateEmployeeDto,
  UpdateLeaveTypeDto,
  YearQueryDto,
} from './dto/hr.dto';

const P = Permission;

/** Org structure, holidays, leave types and the versioned leave & attendance policy. */
@ApiTags('hr')
@ApiBearerAuth('JWT-auth')
@Controller('hr')
export class HrSetupController {
  constructor(private readonly org: OrgService) {}

  @Get('departments')
  @RequirePermission({ permissions: HR_VIEWERS })
  departments(@Query('businessUnitId') businessUnitId: string | undefined, @GetUser() user: AuthenticatedUser) {
    return this.org.listDepartments(user, businessUnitId || undefined);
  }

  @Post('departments')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  createDepartment(@Body() dto: CreateDepartmentDto, @GetUser() user: AuthenticatedUser) {
    return this.org.createDepartment(dto, user);
  }

  @Patch('departments/:id')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto, @GetUser() user: AuthenticatedUser) {
    return this.org.updateDepartment(id, dto, user);
  }

  @Get('designations')
  @RequirePermission({ permissions: HR_VIEWERS })
  designations() {
    return this.org.listDesignations();
  }

  @Post('designations')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  createDesignation(@Body() dto: CreateDesignationDto, @GetUser() user: AuthenticatedUser) {
    return this.org.createDesignation(dto, user);
  }

  @Patch('designations/:id')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  updateDesignation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDesignationDto, @GetUser() user: AuthenticatedUser) {
    return this.org.updateDesignation(id, dto, user);
  }

  @Get('holidays')
  @RequirePermission({ permissions: HR_VIEWERS })
  holidays(@Query() query: HolidayQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.org.listHolidays(user, query.year);
  }

  @Post('holidays')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  createHoliday(@Body() dto: CreateHolidayDto, @GetUser() user: AuthenticatedUser) {
    return this.org.createHoliday(dto, user);
  }

  @Delete('holidays/:id')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.org.deleteHoliday(id, user);
  }

  @Get('leave-types')
  @RequirePermission({ permissions: HR_VIEWERS })
  leaveTypes() {
    return this.org.listLeaveTypes();
  }

  @Post('leave-types')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  createLeaveType(@Body() dto: CreateLeaveTypeDto, @GetUser() user: AuthenticatedUser) {
    return this.org.createLeaveType(dto, user);
  }

  @Patch('leave-types/:id')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  updateLeaveType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeaveTypeDto, @GetUser() user: AuthenticatedUser) {
    return this.org.updateLeaveType(id, dto, user);
  }

  @Get('policies')
  @RequirePermission({ permissions: HR_VIEWERS })
  policies() {
    return this.org.listPolicies();
  }

  @Post('policies')
  @RequirePermission({ permissions: [P.RULES_EDIT_HR_POLICY] })
  createPolicy(@Body() dto: CreateHrPolicyDto, @GetUser() user: AuthenticatedUser) {
    return this.org.createPolicy(dto, user);
  }
}

@ApiTags('employees')
@ApiBearerAuth('JWT-auth')
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  @Get()
  @RequirePermission({ permissions: HR_VIEWERS })
  list(@Query() query: ListEmployeesQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.employees.list(query, user);
  }

  /** Declared before :id so "stats" isn't parsed as an id. */
  @Get('stats')
  @RequirePermission({ permissions: HR_VIEWERS })
  stats(@GetUser() user: AuthenticatedUser) {
    return this.employees.stats(user);
  }

  @Get(':id')
  @RequirePermission({ permissions: HR_VIEWERS })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.employees.findOne(id, user);
  }

  @Post()
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  create(@Body() dto: CreateEmployeeDto, @GetUser() user: AuthenticatedUser) {
    return this.employees.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto, @GetUser() user: AuthenticatedUser) {
    return this.employees.update(id, dto, user);
  }

  @Get(':id/salary')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE, P.EMPLOYEE_VIEW, P.PAYROLL_RUN] })
  salary(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.employees.salaryHistory(id, user);
  }

  @Post(':id/salary')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  addSalary(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SalaryRevisionDto, @GetUser() user: AuthenticatedUser) {
    return this.employees.addSalaryRevision(id, dto, user);
  }

  @Post(':id/exit')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  exit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordExitDto, @GetUser() user: AuthenticatedUser) {
    return this.employees.recordExit(id, dto, user);
  }

  @Post(':id/reinstate')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  reinstate(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.employees.reinstate(id, user);
  }

  @Get(':id/attendance')
  @RequirePermission({ permissions: HR_VIEWERS })
  attendanceMonth(@Param('id', ParseUUIDPipe) id: string, @Query() query: MonthQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.attendance.employeeMonth(id, query.month, user);
  }

  @Get(':id/leave')
  @RequirePermission({ permissions: HR_VIEWERS })
  leaveYear(@Param('id', ParseUUIDPipe) id: string, @Query() query: YearQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.employeeLeave(id, user, query.year);
  }
}

@ApiTags('attendance')
@ApiBearerAuth('JWT-auth')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('today')
  @RequirePermission({ permissions: HR_VIEWERS })
  today(@GetUser() user: AuthenticatedUser) {
    return this.attendance.today(user);
  }

  @Get('sheet')
  @RequirePermission({ permissions: HR_VIEWERS })
  sheet(@Query() query: AttendanceSheetQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.attendance.sheet(query.businessUnitId, query.date, user);
  }

  @Put('sheet')
  @RequirePermission({ permissions: [P.ATTENDANCE_MARK_OWN_UNIT, P.EMPLOYEE_MANAGE] })
  saveSheet(@Body() dto: SaveAttendanceSheetDto, @GetUser() user: AuthenticatedUser) {
    return this.attendance.saveSheet(dto, user);
  }

  @Get('register')
  @RequirePermission({ permissions: HR_VIEWERS })
  register(@Query() query: AttendanceRegisterQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.attendance.register(query.businessUnitId, query.month, user);
  }
}

@ApiTags('leave')
@ApiBearerAuth('JWT-auth')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('requests')
  @RequirePermission({ permissions: HR_VIEWERS })
  requests(@Query() query: ListLeaveRequestsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.listRequests(query, user);
  }

  @Post('requests/preview')
  @RequirePermission({ permissions: [P.LEAVE_APPROVE_OWN_UNIT, P.EMPLOYEE_MANAGE] })
  preview(@Body() dto: LeaveRequestBodyDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.preview(dto, user);
  }

  @Post('requests')
  @RequirePermission({ permissions: [P.LEAVE_APPROVE_OWN_UNIT, P.EMPLOYEE_MANAGE] })
  create(@Body() dto: CreateLeaveRequestDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.createRequest(dto, user);
  }

  @Post('requests/:id/approve')
  @RequirePermission({ permissions: [P.LEAVE_APPROVE_OWN_UNIT] })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.approve(id, dto.note, user);
  }

  @Post('requests/:id/reject')
  @RequirePermission({ permissions: [P.LEAVE_APPROVE_OWN_UNIT] })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.reject(id, dto.note, user);
  }

  @Post('requests/:id/cancel')
  @RequirePermission({ permissions: [P.LEAVE_APPROVE_OWN_UNIT, P.EMPLOYEE_MANAGE] })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.cancel(id, dto.note, user);
  }

  @Get('balances')
  @RequirePermission({ permissions: HR_VIEWERS })
  balances(@Query() query: LeaveBalancesQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.balances(user, query.businessUnitId, query.year);
  }

  @Post('adjustments')
  @RequirePermission({ permissions: [P.EMPLOYEE_MANAGE] })
  adjust(@Body() dto: CreateLeaveAdjustmentDto, @GetUser() user: AuthenticatedUser) {
    return this.leave.createAdjustment(dto, user);
  }
}

@ApiTags('disciplinary')
@ApiBearerAuth('JWT-auth')
@Controller('disciplinary')
export class DisciplinaryController {
  constructor(private readonly disciplinary: DisciplinaryService) {}

  @Get()
  @RequirePermission({ permissions: HR_VIEWERS })
  list(@Query() query: ListDisciplinaryQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.disciplinary.list(query, user);
  }

  @Post()
  @RequirePermission({ permissions: [P.DISCIPLINARY_RAISE_OWN_UNIT, P.DISCIPLINARY_APPROVE] })
  create(@Body() dto: CreateDisciplinaryDto, @GetUser() user: AuthenticatedUser) {
    return this.disciplinary.create(dto, user);
  }

  @Post(':id/approve')
  @RequirePermission({ permissions: [P.DISCIPLINARY_APPROVE] })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @GetUser() user: AuthenticatedUser) {
    return this.disciplinary.review(id, true, dto.note, user);
  }

  @Post(':id/reject')
  @RequirePermission({ permissions: [P.DISCIPLINARY_APPROVE] })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @GetUser() user: AuthenticatedUser) {
    return this.disciplinary.review(id, false, dto.note, user);
  }

  @Post(':id/withdraw')
  @RequirePermission({ permissions: [P.DISCIPLINARY_RAISE_OWN_UNIT, P.DISCIPLINARY_APPROVE] })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.disciplinary.withdraw(id, user);
  }
}
