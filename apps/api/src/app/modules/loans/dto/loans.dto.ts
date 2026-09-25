import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CounterpartyKind, LoanDirection, LoanMovementEffect, LoanMovementMethod, LoanStatus } from '@multizoo/types';
import { AMOUNT_REGEX, DATE_REGEX } from '../../journal/dto/journal-entry.dto';

// --- Counterparties ------------------------------------------------------------

export class CreateCounterpartyDto {
  @IsIn([CounterpartyKind.PERSON, CounterpartyKind.ORGANISATION, CounterpartyKind.EMPLOYEE])
  kind!: CounterpartyKind;

  /** Required for a person or organisation; an employee's comes from their record. */
  @ValidateIf((o) => o.kind !== CounterpartyKind.EMPLOYEE)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ValidateIf((o) => o.kind === CounterpartyKind.EMPLOYEE)
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCounterpartyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- Loans -----------------------------------------------------------------------

export class LoanMovementDto {
  @Matches(DATE_REGEX, { message: 'movementDate must be YYYY-MM-DD' })
  movementDate!: string;

  @IsEnum(LoanMovementEffect)
  effect!: LoanMovementEffect;

  @IsEnum(LoanMovementMethod)
  method!: LoanMovementMethod;

  @Matches(AMOUNT_REGEX, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  /** Cash / bank / wallet (CASH), or the expense, asset or income account (ON_ACCOUNT). */
  @ValidateIf((o) => o.method === LoanMovementMethod.CASH || o.method === LoanMovementMethod.ON_ACCOUNT)
  @IsUUID()
  otherAccountId?: string;

  /** Cash going out only: the reserve bucket it's paid out of. */
  @IsOptional()
  @IsUUID()
  reserveAccountId?: string;
}

export class CreateLoanDto {
  @IsUUID()
  counterpartyId!: string;

  @IsUUID()
  businessUnitId!: string;

  @IsEnum(LoanDirection)
  direction!: LoanDirection;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  purpose!: string;

  /** The ceiling a Partner approves; blank = every further advance needs approval. */
  @IsOptional()
  @Matches(AMOUNT_REGEX, { message: 'limit must be a positive amount with at most 2 decimals' })
  limit?: string;

  /** The first movement — the money lent or borrowed, or an opening balance. */
  @IsOptional()
  @ValidateNested()
  @Type(() => LoanMovementDto)
  opening?: LoanMovementDto;
}

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  purpose?: string;

  /** null removes the ceiling. Partners only. */
  @IsOptional()
  @ValidateIf((o) => o.limit !== null)
  @Matches(AMOUNT_REGEX, { message: 'limit must be a positive amount with at most 2 decimals' })
  limit?: string | null;
}

export class ListLoansQueryDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  /** 'true' = inter-unit only, 'false' = none of them. */
  @IsOptional()
  @IsIn(['true', 'false'])
  interUnit?: 'true' | 'false';
}

export class ReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// --- Inter-unit ------------------------------------------------------------------

export class InterUnitTransferDto {
  @IsUUID()
  fromUnitId!: string;

  @IsUUID()
  toUnitId!: string;

  @Matches(DATE_REGEX, { message: 'transferDate must be YYYY-MM-DD' })
  transferDate!: string;

  @Matches(AMOUNT_REGEX, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  /** The paying unit's cash, bank or wallet. */
  @IsUUID()
  fromAccountId!: string;

  /** The receiving unit's cash, bank or wallet. */
  @IsUUID()
  toAccountId!: string;

  @IsOptional()
  @IsUUID()
  reserveAccountId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;
}

// --- Staff advances --------------------------------------------------------------

export class WriteOffDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
