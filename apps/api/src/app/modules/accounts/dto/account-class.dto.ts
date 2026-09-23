import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AccountClassUnitRule, AccountType } from '@multizoo/types';

export class CreateAccountClassDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  @IsEnum(AccountClassUnitRule)
  unitRule!: AccountClassUnitRule;

  @IsInt()
  @Min(1)
  @Max(999999)
  codeStart!: number;

  @IsInt()
  @Min(1)
  @Max(999999)
  codeEnd!: number;

  @IsOptional() @IsBoolean() isLiquid?: boolean;
  @IsOptional() @IsBoolean() isReserve?: boolean;
  @IsOptional() @IsBoolean() isReconcilable?: boolean;
  @IsOptional() @IsBoolean() provisionForNewUnits?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  defaultAccountName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateAccountClassDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(AccountType) type?: AccountType;
  @IsOptional() @IsEnum(AccountClassUnitRule) unitRule?: AccountClassUnitRule;
  @IsOptional() @IsInt() @Min(1) @Max(999999) codeStart?: number;
  @IsOptional() @IsInt() @Min(1) @Max(999999) codeEnd?: number;
  @IsOptional() @IsBoolean() isLiquid?: boolean;
  @IsOptional() @IsBoolean() isReserve?: boolean;
  @IsOptional() @IsBoolean() isReconcilable?: boolean;
  @IsOptional() @IsBoolean() provisionForNewUnits?: boolean;
  @IsOptional() @IsString() @MaxLength(120) defaultAccountName?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateChartSettingsDto {
  @IsOptional() @IsString() @MaxLength(24) unitCodePattern?: string;
  @IsOptional() @IsString() @MaxLength(24) groupCodePattern?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  codeStep?: number;
}
