import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CampaignEntryType, CampaignStatus, CapexFunding, CapexStatus } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

// --- Capex register ---------------------------------------------------------------

export class CreateCapexDto {
  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'purchaseDate must be YYYY-MM-DD' })
  purchaseDate!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nature!: string;

  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  paybackMonths?: number | null;

  @IsEnum(CapexFunding)
  funding!: CapexFunding;

  /** PAID_HERE: the asset or expense account charged. */
  @ValidateIf((o) => o.funding === CapexFunding.PAID_HERE)
  @IsUUID()
  accountId?: string;

  /** PAID_HERE: the cash, bank or wallet it was paid from. */
  @ValidateIf((o) => o.funding === CapexFunding.PAID_HERE)
  @IsUUID()
  paidFromAccountId?: string;

  /** PAID_HERE: optionally out of a reserve (Capital). */
  @IsOptional()
  @IsUUID()
  reserveAccountId?: string | null;

  /** LINKED_ENTRY: the entry already on the ledger. */
  @ValidateIf((o) => o.funding === CapexFunding.LINKED_ENTRY)
  @IsUUID()
  journalEntryId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  earningItemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateCapexDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nature?: string;

  /** Only when the register is the record (not paid here). */
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'purchaseDate must be YYYY-MM-DD' })
  purchaseDate?: string;

  /** Only when the register is the record (not paid here). */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  paybackMonths?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  earningItemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class RetireCapexDto {
  @Matches(DATE_REGEX, { message: 'retiredOn must be YYYY-MM-DD' })
  retiredOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RemoveCapexDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ListCapexQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsEnum(CapexStatus)
  status?: CapexStatus;
}

// --- Campaigns ---------------------------------------------------------------------

export class BudgetLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount!: string;
}

export class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsUUID()
  businessUnitId!: string;

  @Matches(DATE_REGEX, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  budget?: BudgetLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  budget?: BudgetLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CampaignEntryDto {
  @IsEnum(CampaignEntryType)
  type!: CampaignEntryType;

  @Matches(DATE_REGEX, { message: 'entryDate must be YYYY-MM-DD' })
  entryDate!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  description!: string;

  @Matches(AMOUNT_REGEX, { message: 'amount must be an amount with at most 2 decimals' })
  amount!: string;

  /** The host unit's cash, bank or wallet. */
  @IsUUID()
  accountId!: string;
}

export class ReverseCampaignEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CloseCampaignDto {
  /** Shortfall: an expense account to charge it to. Surplus: an income account to take it into. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: 'closedOn must be YYYY-MM-DD' })
  closedOn?: string;
}

export class ListCampaignsQueryDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
