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
  ValidateNested,
} from 'class-validator';
import {
  AllocationMethod,
  AllocationRuleStatus,
  AllocationTargetType,
} from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const PARTS = /^\d{1,6}(\.\d{1,4})?$/;
const SIGNED_AMOUNT = /^-?\d{1,16}(\.\d{1,2})?$/;

export class RuleLineDto {
  @IsEnum(AllocationTargetType)
  targetType!: AllocationTargetType;

  /** The reserve account, for RESERVE lines. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** The partner, for PARTNER lines. */
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  /** % of the tranche, or a number of parts. */
  @Matches(PARTS, { message: 'each line must be a number with at most 4 decimal places' })
  weight!: string;
}

export class RuleTrancheDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** % of the day's gross income. */
  @Matches(PERCENT, { message: 'a tranche share must be a percentage with at most 4 decimal places' })
  share!: string;

  @IsEnum(AllocationMethod)
  method!: AllocationMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RuleLineDto)
  lines!: RuleLineDto[];
}

export class RuleBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RuleTrancheDto)
  tranches!: RuleTrancheDto[];
}

export class CreateAllocationRuleDto extends RuleBodyDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  /** Why the change — shown in the version history and to the approver. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Send straight for approval instead of saving a draft. */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  /** A Partner's own change: approve it in the same step. */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateAllocationRuleDto {
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RuleTrancheDto)
  tranches?: RuleTrancheDto[];
}

export class ReviewAllocationRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListAllocationRulesQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsEnum(AllocationRuleStatus)
  status?: AllocationRuleStatus;
}

export class PreviewAllocationRuleDto extends RuleBodyDto {
  @IsUUID()
  businessUnitId!: string;

  /** Split this amount as an example ("what happens to Rs 100,000"). */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'sampleAmount must be an amount with at most 2 decimals' })
  sampleAmount?: string;

  /** Replay the last N days of actual income under both rules. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(92)
  days?: number;
}

export class AllocationDaysQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;
}

export class AllocateDayDto {
  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class AllocatePendingDto {
  /** Allocate pending days up to and including this date (default: yesterday). */
  @IsOptional()
  @Matches(DATE_REGEX)
  upTo?: string;
}

export class UndoRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class OpeningReserveAmountDto {
  @IsUUID()
  accountId!: string;

  /** May be negative: a reserve the workbook shows overspent. */
  @Matches(SIGNED_AMOUNT, { message: 'amount must have at most 2 decimals' })
  amount!: string;
}

export class SetOpeningReservesDto {
  @Matches(DATE_REGEX, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpeningReserveAmountDto)
  amounts!: OpeningReserveAmountDto[];

  /** Reverse the existing opening reserves and post these instead. */
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CreatePartnerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  shortName!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  shortName?: string;

  /** null unlinks the login (IsOptional lets null through). */
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
