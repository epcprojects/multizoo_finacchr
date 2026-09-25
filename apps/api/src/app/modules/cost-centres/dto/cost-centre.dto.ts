import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CostCentreCharge } from '@multizoo/types';
import { DATE_REGEX } from '../../journal/dto/journal-entry.dto';

export class CreateCostCentreDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,19}$/, { message: 'code: up to 20 letters, digits, spaces, - or _' })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(CostCentreCharge)
  chargeTo!: CostCentreCharge;

  @ValidateIf((o) => o.chargeTo === CostCentreCharge.PARTNER)
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string | null;
}

export class UpdateCostCentreDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,19}$/, { message: 'code: up to 20 letters, digits, spaces, - or _' })
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(CostCentreCharge)
  chargeTo?: CostCentreCharge;

  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CostCentreReportQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}
