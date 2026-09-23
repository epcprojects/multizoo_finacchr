import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BusinessUnitType } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

export class OpeningBalancesDto {
  @Matches(DATE_REGEX, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate!: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX)
  cash?: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX)
  bank?: string;

  @IsOptional()
  @Matches(AMOUNT_REGEX)
  wallet?: string;
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

export class UpdateBusinessUnitDto {
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
