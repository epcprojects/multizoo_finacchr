import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
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
import { UtilityAllocationMethod } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

const READING = /^\d{1,12}(\.\d{1,2})?$/;
const PCT = /^\d{1,3}(\.\d{1,4})?$/;

export class SubMeterDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsUUID()
  businessUnitId!: string;

  @IsOptional()
  @ValidateIf((o) => o.installedOn !== null)
  @Matches(DATE_REGEX)
  installedOn?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RemainderSplitDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(PCT, { message: 'pct: a percentage with at most 4 decimals' })
  pct!: string;
}

export class ShareDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  /** businessUnitId → weight ("0.5", "1"). */
  @IsObject()
  weights!: Record<string, string>;
}

export class CreateConnectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  utility?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsUUID()
  businessUnitId!: string;

  @IsEnum(UtilityAllocationMethod)
  method!: UtilityAllocationMethod;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(62)
  standardDays?: number;

  @IsUUID()
  expenseAccountId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SubMeterDto)
  subMeters?: SubMeterDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RemainderSplitDto)
  remainderSplit?: RemainderSplitDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares?: ShareDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  utility?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  provider?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(62)
  standardDays?: number;

  @IsOptional()
  @IsUUID()
  expenseAccountId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SubMeterDto)
  subMeters?: SubMeterDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RemainderSplitDto)
  remainderSplit?: RemainderSplitDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares?: ShareDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBillDto {
  @IsUUID()
  connectionId!: string;

  @Matches(DATE_REGEX, { message: 'periodFrom must be YYYY-MM-DD' })
  periodFrom!: string;

  @Matches(DATE_REGEX, { message: 'periodTo must be YYYY-MM-DD' })
  periodTo!: string;

  @Matches(AMOUNT_REGEX, { message: 'billAmount must be a positive amount with at most 2 decimals' })
  billAmount!: string;

  @IsOptional()
  @Matches(READING, { message: 'totalUnits: a number with at most 2 decimals' })
  totalUnits?: string;
}

export class ReadingDto {
  @IsUUID()
  subMeterId!: string;

  @Matches(READING, { message: 'start: a reading with at most 2 decimals' })
  start!: string;

  @IsOptional()
  @ValidateIf((o) => o.end !== null)
  @Matches(READING, { message: 'end: a reading with at most 2 decimals' })
  end?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.daysCovered !== null)
  @IsInt()
  @Min(1)
  @Max(62)
  daysCovered?: number | null;
}

export class UpdateBillDto {
  @IsOptional()
  @Matches(DATE_REGEX)
  periodFrom?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  periodTo?: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'billAmount must be a positive amount with at most 2 decimals' })
  billAmount?: string;

  @IsOptional()
  @ValidateIf((o) => o.totalUnits !== null)
  @Matches(READING, { message: 'totalUnits: a number with at most 2 decimals' })
  totalUnits?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReadingDto)
  readings?: ReadingDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RemainderSplitDto)
  remainderSplit?: RemainderSplitDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares?: ShareDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class PostBillDto {
  /** Also record paying the bill, from this cash / bank / wallet of the paying unit. */
  @IsOptional()
  @IsUUID()
  paidFromAccountId?: string;

  @ValidateIf((o) => Boolean(o.paidFromAccountId))
  @Matches(DATE_REGEX, { message: 'paidOn must be YYYY-MM-DD' })
  paidOn?: string;

  @IsOptional()
  @IsUUID()
  reserveAccountId?: string;
}

export class ListBillsQueryDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}

export class UnpostDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
