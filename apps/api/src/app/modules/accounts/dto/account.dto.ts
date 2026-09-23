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
import { AccountSubtype, AccountType } from '@multizoo/types';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

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

  /** The account type (asset, expense, …) is derived from this. */
  @IsEnum(AccountSubtype)
  subtype!: AccountSubtype;

  /** Required for cash/bank/wallet/reserve; forbidden for income/expense. */
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** Auto-generated when omitted. */
  @IsOptional()
  @Matches(/^[A-Z0-9-]{2,30}$/, {
    message: 'code may only contain A–Z, 0–9 and dashes (2–30 characters)',
  })
  code?: string;

  /** False creates a group heading that other accounts sit under. */
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

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
