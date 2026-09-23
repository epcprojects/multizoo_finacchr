import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BusinessUnitType } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

export class OpeningAmountDto {
  /** The class of the provisioned account the amount opens (e.g. Cash). */
  @IsUUID()
  classId!: string;

  @Matches(AMOUNT_REGEX)
  amount!: string;
}

export class OpeningBalancesDto {
  @Matches(DATE_REGEX, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpeningAmountDto)
  amounts!: OpeningAmountDto[];
}

export class CreateBusinessUnitDto {
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,11}$/, {
    message: 'code must be 2–12 letters/digits, starting with a letter (e.g. ZOO, CAFE2)',
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEnum(BusinessUnitType)
  type!: BusinessUnitType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * Which account classes to create an account for (e.g. Cash, Bank).
   * Omitted → every class marked "create for new units".
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  accountClassIds?: string[];

  /** Reserve bucket names, e.g. ["Salary", "Feed"] → "Salary Reserve", "Feed Reserve". */
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  reserveBuckets!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningBalancesDto)
  openingBalances?: OpeningBalancesDto;
}

export class AddUnitAccountsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  accountClassIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  reserveBuckets?: string[];
}

export class OpeningAccountAmountDto {
  @IsUUID()
  accountId!: string;

  /** "0" (or omitted from the list) means no opening balance for this account. */
  @Matches(AMOUNT_REGEX)
  amount!: string;
}

export class SetOpeningBalancesDto {
  @Matches(DATE_REGEX, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate!: string;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => OpeningAccountAmountDto)
  amounts!: OpeningAccountAmountDto[];

  /**
   * Required when the unit already has an opening balance: the existing
   * entry is reversed (dated as the original) and the new one posted, in
   * one transaction — history is corrected, never overwritten.
   */
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class UpdateBusinessUnitDto {
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,11}$/, {
    message: 'code must be 2–12 letters/digits, starting with a letter (e.g. ZOO, CAFE2)',
  })
  code?: string;

  /** With a code change: also swap the old code for the new one inside this unit's account codes. */
  @IsOptional()
  @IsBoolean()
  relabelAccountCodes?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(BusinessUnitType)
  type?: BusinessUnitType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
