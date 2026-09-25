import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceStatus,
  BonusTier,
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  EmploymentType,
  LeaveRequestStatus,
  PayBasis,
} from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAYS_REGEX = /^\d{1,3}(\.[05])?$/;
const SIGNED_DAYS_REGEX = /^-?\d{1,3}(\.[05])?$/;
const CNIC_REGEX = /^\d{5}-\d{7}-\d$/;

// --- Org structure -----------------------------------------------------------

export class CreateDepartmentDto {
  @IsUUID()
  businessUnitId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDesignationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEnum(BonusTier)
  bonusTier!: BonusTier;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateDesignationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(BonusTier)
  bonusTier?: BonusTier;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateHolidayDto {
  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** Omit for a holiday across the group. */
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}

export class HolidayQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class CreateLeaveTypeDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,19}$/, { message: 'code must be 2–20 capital letters, digits or _' })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsBoolean()
  isPaid!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- HR policy -----------------------------------------------------------------

export class PolicyLeaveRuleDto {
  @IsUUID()
  leaveTypeId!: string;

  @Matches(DAYS_REGEX, { message: 'days per year must be whole or half days' })
  daysPerYear!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  availableAfterMonths!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  maxConsecutiveDays?: number | null;

  @IsBoolean()
  carryForward!: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAYS_REGEX, { message: 'maximum balance must be whole or half days' })
  maxBalance?: string | null;

  @IsBoolean()
  encashable!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(EmploymentType, { each: true })
  employmentTypes!: EmploymentType[];
}

export class CreateHrPolicyDto {
  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(62)
  attendanceBackdateDays!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PolicyLeaveRuleDto)
  leaveRules!: PolicyLeaveRuleDto[];
}

// --- Employees -----------------------------------------------------------------

export class ListEmployeesQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}

class EmployeeProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fatherName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v !== null)
  @Matches(CNIC_REGEX, { message: 'CNIC must look like 12345-1234567-1' })
  cnic?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(BonusTier)
  bonusTier?: BonusTier | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weeklyOffDay?: number | null;

  /** Link a login (holders of users.invite only). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateEmployeeDto extends EmployeeProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsUUID()
  businessUnitId!: string;

  @IsUUID()
  designationId!: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @Matches(DATE_REGEX, { message: 'joinDate must be YYYY-MM-DD' })
  joinDate!: string;

  @Matches(AMOUNT_REGEX, { message: 'baseSalary must be an amount with at most 2 decimals' })
  baseSalary!: string;

  @IsEnum(PayBasis)
  payBasis!: PayBasis;
}

export class UpdateEmployeeDto extends EmployeeProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  /** A transfer: attendance already marked stays with the old unit. */
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  /** Only while nothing has been recorded before the new date. */
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'joinDate must be YYYY-MM-DD' })
  joinDate?: string;
}

export class SalaryRevisionDto {
  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  @Matches(AMOUNT_REGEX, { message: 'baseSalary must be an amount with at most 2 decimals' })
  baseSalary!: string;

  @IsEnum(PayBasis)
  payBasis!: PayBasis;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class RecordExitDto {
  @Matches(DATE_REGEX, { message: 'exitDate must be YYYY-MM-DD' })
  exitDate!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

// --- Attendance ------------------------------------------------------------------

export class AttendanceSheetQueryDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class AttendanceEntryDto {
  @IsUUID()
  employeeId!: string;

  /** null clears the day back to "not marked". */
  @ValidateIf((_, v) => v !== null)
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus | null;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SaveAttendanceSheetDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}

export class AttendanceRegisterQueryDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;
}

export class MonthQueryDto {
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;
}

// --- Leave ---------------------------------------------------------------------

export class LeaveRequestBodyDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @Matches(DATE_REGEX, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @Matches(DATE_REGEX, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CreateLeaveRequestDto extends LeaveRequestBodyDto {
  /** An approver entering leave they're approving anyway: approve in the same step. */
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export class ListLeaveRequestsQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;
}

export class ReviewNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class LeaveBalancesQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class YearQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class CreateLeaveAdjustmentDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  leaveYear!: number;

  @Matches(SIGNED_DAYS_REGEX, { message: 'days must be whole or half days, e.g. 3 or -1.5' })
  days!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// --- Disciplinary ----------------------------------------------------------------

export class ListDisciplinaryQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(DisciplinaryStatus)
  status?: DisciplinaryStatus;
}

export class CreateDisciplinaryDto {
  @IsUUID()
  employeeId!: string;

  @IsEnum(DisciplinaryType)
  type!: DisciplinaryType;

  @Matches(DATE_REGEX, { message: 'incidentDate must be YYYY-MM-DD' })
  incidentDate!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  /** Required for a fine; not allowed on a warning. */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount?: string;

  /** The approver recording a fine they approve anyway. */
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
