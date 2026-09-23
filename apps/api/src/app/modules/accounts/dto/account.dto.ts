import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '@multizoo/types';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

const CODE_REGEX = /^[A-Z0-9\-_./]{1,30}$/;
const CODE_MESSAGE = 'code may only contain A–Z, 0–9 and - _ . / (up to 30 characters)';

export class ListAccountsQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** The account class — its bucket, unit rule and code range come from it. */
  @IsUUID()
  classId!: string;

  /** Required or forbidden depending on the class's unit rule. */
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** Generated from the numbering settings when omitted. */
  @IsOptional()
  @Matches(CODE_REGEX, { message: CODE_MESSAGE })
  code?: string;

  /** False creates a heading that other accounts sit under. */
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /** Codes are labels — entries reference the account's id — so they can change. */
  @IsOptional()
  @Matches(CODE_REGEX, { message: CODE_MESSAGE })
  code?: string;

  /** Reclassify, e.g. Bank → Mobile wallet. Must stay in the same bucket. */
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
