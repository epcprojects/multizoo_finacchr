import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DATE_REGEX } from '../../journal/dto/journal-entry.dto';

export class LedgerRangeQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX)
  to?: string;
}

export class AsOfQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX)
  asOf?: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}

/** Counted balance may legitimately be zero, or even negative for an overdrawn bank. */
export class CreateReconciliationDto {
  @Matches(DATE_REGEX, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate!: string;

  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/, {
    message: 'countedBalance must be an amount with at most 2 decimals',
  })
  countedBalance!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
