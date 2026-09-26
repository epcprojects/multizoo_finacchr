import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DATE_REGEX } from '../../journal/dto/journal-entry.dto';
import { RelativePeriod, ScheduleCadence } from '../report-periods';

export class GenerateReportDto {
  @IsString()
  @MaxLength(40)
  reportKey!: string;

  /** The report's own params — checked against its definition in the catalogue. */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class ArchiveQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reportKey?: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
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
  @Max(100)
  limit?: number;
}

export class ReportFileQueryDto {
  /** `1` = download (attachment) rather than open in the browser. */
  @IsOptional()
  @IsString()
  download?: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(40)
  reportKey!: string;

  @IsEnum(ScheduleCadence)
  cadence!: ScheduleCadence;

  @Matches(TIME, { message: 'runAt must be HH:MM (24-hour, Pakistan time)' })
  runAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number | null;

  @IsOptional()
  @IsEnum(RelativePeriod)
  period?: RelativePeriod | null;

  /** Fixed params besides the period — e.g. a unit, a partner. */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(ScheduleCadence)
  cadence?: ScheduleCadence;

  @IsOptional()
  @Matches(TIME, { message: 'runAt must be HH:MM (24-hour, Pakistan time)' })
  runAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number | null;

  @IsOptional()
  @IsEnum(RelativePeriod)
  period?: RelativePeriod | null;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
