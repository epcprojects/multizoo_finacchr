import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { FootfallKind, SalesDayStatus, SalesPricing } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

// --- Price list -------------------------------------------------------------------

export class CreateSalesItemDto {
  @IsUUID()
  businessUnitId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category!: string;

  @IsUUID()
  incomeAccountId!: string;

  @IsEnum(SalesPricing)
  pricing!: SalesPricing;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'defaultRate must be an amount with at most 2 decimals' })
  defaultRate?: string | null;

  @IsOptional()
  @IsEnum(FootfallKind)
  footfall?: FootfallKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSalesItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsUUID()
  incomeAccountId?: string;

  @IsOptional()
  @IsEnum(SalesPricing)
  pricing?: SalesPricing;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'defaultRate must be an amount with at most 2 decimals' })
  defaultRate?: string | null;

  @IsOptional()
  @IsEnum(FootfallKind)
  footfall?: FootfallKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListSalesItemsQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// --- A day's sheet -----------------------------------------------------------------

export class OpenSalesDayDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'salesDate must be YYYY-MM-DD' })
  salesDate!: string;
}

export class SalesLineDto {
  @IsUUID()
  itemId!: string;

  /** Per-unit items: how many. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  quantity?: number | null;

  /** Per-unit items: the rate sold at (defaults to the price list's). */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'rate must be an amount with at most 2 decimals' })
  rate?: string | null;

  /** Amount-only items: the day's figure. */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class ReceiptDto {
  @IsUUID()
  accountId!: string;

  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount!: string;
}

export class SaveSalesDayDto {
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReceiptDto)
  receipts!: ReceiptDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UnpostSalesDayDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ListSalesDaysQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;

  @IsOptional()
  @IsEnum(SalesDayStatus)
  status?: SalesDayStatus;
}

// --- Reports -------------------------------------------------------------------------

export class SalesYearQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  /** Omit for every unit the caller can see. */
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}

export class SalesCompareQueryDto {
  @IsUUID()
  eventId!: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}

export class SalesTotalQueryDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX)
  from!: string;

  @Matches(DATE_REGEX)
  to!: string;

  /** Only this category (e.g. "School"). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

// --- Peak events ----------------------------------------------------------------------

export class EventOccurrenceDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Matches(DATE_REGEX, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;
}

export class SaveSalesEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(60)
  days!: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EventOccurrenceDto)
  occurrences!: EventOccurrenceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsIn([true, false])
  isActive?: boolean;
}
