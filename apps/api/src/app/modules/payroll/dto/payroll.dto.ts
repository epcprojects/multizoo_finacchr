import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  BonusPoolStatus,
  BonusSplitMethod,
  BonusTier,
  EmploymentType,
  PayrollAdjustmentKind,
  SalaryAdvanceStatus,
  SettlementStatus,
} from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const PCT_REGEX = /^\d{1,3}(\.\d{1,2})?$/;
const UNITS_REGEX = /^\d{1,8}(\.\d{1,2})?$/;
const POSITIVE_AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;

// --- Runs ----------------------------------------------------------------------

export class MonthQueryDto {
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;
}

export class CreatePayrollRunDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;
}

export class PayrollAdjustmentDto {
  @IsUUID()
  employeeId!: string;

  @IsEnum(PayrollAdjustmentKind)
  kind!: PayrollAdjustmentKind;

  @Matches(POSITIVE_AMOUNT, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;
}

export class FinalizeDto {
  /** The warnings (unmarked days, pending leave …) have been looked at. */
  @IsOptional()
  @IsBoolean()
  acknowledgeWarnings?: boolean;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PayDto {
  @Matches(DATE_REGEX, { message: 'paymentDate must be YYYY-MM-DD' })
  paymentDate!: string;

  /** The unit's cash, bank or wallet account it's paid from. */
  @IsUUID()
  accountId!: string;

  /** Paid out of a reserve (the Salary reserve) — the earmark is released with it. */
  @IsOptional()
  @IsUUID()
  reserveAccountId?: string;

  /** Just these people; everyone unpaid when left out. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}

// --- Advances -------------------------------------------------------------------

export class ListAdvancesQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(SalaryAdvanceStatus)
  status?: SalaryAdvanceStatus;
}

export class CreateAdvanceDto {
  @IsUUID()
  employeeId!: string;

  @Matches(DATE_REGEX, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate!: string;

  @Matches(POSITIVE_AMOUNT, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  /** Per payroll; left out = the whole amount at the next payroll. */
  @IsOptional()
  @Matches(POSITIVE_AMOUNT, { message: 'installment must be a positive amount with at most 2 decimals' })
  installment?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsUUID()
  reserveAccountId?: string;
}

// --- Bonus pools ------------------------------------------------------------------

export class ListBonusPoolsQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month?: string;

  @IsOptional()
  @IsEnum(BonusPoolStatus)
  status?: BonusPoolStatus;
}

export class CreateBonusPoolDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  basis?: string;

  @Matches(AMOUNT_REGEX, { message: 'qualifyingSales must be an amount with at most 2 decimals' })
  qualifyingSales!: string;

  /** Start with everyone in the unit who has a bonus tier. */
  @IsOptional()
  @IsBoolean()
  addEveryone?: boolean;
}

export class UpdateBonusPoolDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  basis?: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'qualifyingSales must be an amount with at most 2 decimals' })
  qualifyingSales?: string;
}

export class BonusMemberDto {
  @IsUUID()
  employeeId!: string;

  @IsIn([BonusTier.MANAGER, BonusTier.SUPERVISOR, BonusTier.TICKETER, BonusTier.WORKER])
  tier!: BonusTier;

  @Matches(UNITS_REGEX, { message: 'units must be a number with at most 2 decimals' })
  units!: string;
}

export class SetBonusMembersDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BonusMemberDto)
  members!: BonusMemberDto[];
}

// --- Policy ---------------------------------------------------------------------

export class TaxBandDto {
  @Matches(AMOUNT_REGEX, { message: 'Each tax band starts at an amount' })
  from!: string;

  @Matches(PCT_REGEX, { message: 'A tax rate is a percentage with at most 2 decimals' })
  rate!: string;
}

export class BonusTierRuleDto {
  @IsIn([BonusTier.MANAGER, BonusTier.SUPERVISOR, BonusTier.TICKETER, BonusTier.WORKER])
  tier!: BonusTier;

  @Matches(PCT_REGEX, { message: 'A tier’s share is a percentage with at most 2 decimals' })
  pct!: string;

  @IsEnum(BonusSplitMethod)
  split!: BonusSplitMethod;

  @IsBoolean()
  roundUp!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unitLabel?: string;
}

export class CreatePayrollPolicyDto {
  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @Type(() => Number)
  @IsInt()
  @Min(28)
  @Max(31)
  daysPerMonth!: number;

  @IsBoolean()
  eobiEnabled!: boolean;

  @Matches(AMOUNT_REGEX, { message: 'eobiMinimumWage must be an amount' })
  eobiMinimumWage!: string;

  @Matches(PCT_REGEX)
  eobiEmployeePct!: string;

  @Matches(PCT_REGEX)
  eobiEmployerPct!: string;

  @IsArray()
  @IsEnum(EmploymentType, { each: true })
  eobiEmploymentTypes!: EmploymentType[];

  @IsBoolean()
  taxEnabled!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaxBandDto)
  taxBands!: TaxBandDto[];

  @IsBoolean()
  pfEnabled!: boolean;

  @Matches(PCT_REGEX)
  pfEmployeePct!: string;

  @Matches(PCT_REGEX)
  pfEmployerPct!: string;

  @Matches(PCT_REGEX)
  commissionPct!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => BonusTierRuleDto)
  bonusTiers!: BonusTierRuleDto[];
}

// --- Settlements ------------------------------------------------------------------

export class ListSettlementsQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}

export class CreateSettlementDto {
  @IsUUID()
  employeeId!: string;
}

export class SettlementAdjustmentDto {
  @IsIn([PayrollAdjustmentKind.ALLOWANCE, PayrollAdjustmentKind.DEDUCTION])
  kind!: PayrollAdjustmentKind.ALLOWANCE | PayrollAdjustmentKind.DEDUCTION;

  @Matches(POSITIVE_AMOUNT, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;
}

export class UpdateSettlementDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SettlementAdjustmentDto)
  adjustments?: SettlementAdjustmentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export { MONTH_REGEX };
