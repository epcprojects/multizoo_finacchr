import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department, Designation, Holiday } from './entities/org.entity';
import { Employee, SalaryRevision } from './entities/employee.entity';
import { HrPolicy, HrPolicyLeaveRule, LeaveAdjustment, LeaveRequest, LeaveType } from './entities/leave.entity';
import { AttendanceRecord, DisciplinaryRecord } from './entities/attendance.entity';
import { OrgService } from './org.service';
import { EmployeesService } from './employees.service';
import { AttendanceService } from './attendance.service';
import { LeaveService } from './leave.service';
import { DisciplinaryService } from './disciplinary.service';
import {
  AttendanceController,
  DisciplinaryController,
  EmployeesController,
  HrSetupController,
  LeaveController,
} from './hr.controller';

/** Module 4 — employee master & org structure (M14), attendance & leave (M15). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Department,
      Designation,
      Holiday,
      Employee,
      SalaryRevision,
      LeaveType,
      HrPolicy,
      HrPolicyLeaveRule,
      LeaveRequest,
      LeaveAdjustment,
      AttendanceRecord,
      DisciplinaryRecord,
    ]),
  ],
  controllers: [HrSetupController, EmployeesController, AttendanceController, LeaveController, DisciplinaryController],
  providers: [OrgService, EmployeesService, AttendanceService, LeaveService, DisciplinaryService],
  exports: [LeaveService, AttendanceService, DisciplinaryService, EmployeesService],
})
export class HrModule {}
