import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
import { JournalEntryKind } from '@multizoo/types';

/** Positive decimal, at most 2 places — amounts are strings, never floats. */
export const AMOUNT_REGEX = /^\d{1,16}(\.\d{1,2})?$/;
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Kinds a person can post directly. REVERSAL only comes from /reverse. */
export const POSTABLE_KINDS = [
  JournalEntryKind.MONEY_IN,
  JournalEntryKind.MONEY_OUT,
  JournalEntryKind.TRANSFER,
  JournalEntryKind.OPENING_BALANCE,
  JournalEntryKind.GENERAL,
] as const;

export class JournalLineDto {
  @IsUUID()
  accountId!: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'debit must be a positive amount with at most 2 decimals' })
  debit?: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'credit must be a positive amount with at most 2 decimals' })
  credit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

export class CreateJournalEntryDto {
  @Matches(DATE_REGEX, { message: 'entryDate must be YYYY-MM-DD' })
  entryDate!: string;

  @IsUUID()
  businessUnitId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsIn(POSTABLE_KINDS)
  kind!: (typeof POSTABLE_KINDS)[number];

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class ReverseJournalEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'entryDate must be YYYY-MM-DD' })
  entryDate?: string;
}

export class ListJournalEntriesQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;

  @IsOptional()
  @IsIn(Object.values(JournalEntryKind))
  kind?: JournalEntryKind;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
