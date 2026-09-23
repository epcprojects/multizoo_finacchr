import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JournalEntryKind, Permission } from '@multizoo/types';
import { JournalService } from './journal.service';
import {
  CreateJournalEntryDto,
  ListJournalEntriesQueryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import { hasPermission } from '../../../common/scope/unit-scope';
import type { AuthenticatedUser } from '../users/users.service';

/** Opening balances and free-form journals are the accountant's tools. */
const ACCOUNTANT_ONLY_KINDS = [
  JournalEntryKind.OPENING_BALANCE,
  JournalEntryKind.GENERAL,
];

@ApiTags('journal-entries')
@ApiBearerAuth('JWT-auth')
@Controller('journal-entries')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get()
  @RequirePermission({
    permissions: [Permission.LEDGER_VIEW, Permission.TRANSACTIONS_CREATE_OWN_UNIT],
  })
  list(@Query() query: ListJournalEntriesQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.journalService.list(query, user);
  }

  @Get(':id')
  @RequirePermission({
    permissions: [Permission.LEDGER_VIEW, Permission.TRANSACTIONS_CREATE_OWN_UNIT],
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.journalService.findOne(id, user);
  }

  @Post()
  @RequirePermission({ permissions: [Permission.TRANSACTIONS_CREATE_OWN_UNIT] })
  create(@Body() dto: CreateJournalEntryDto, @GetUser() user: AuthenticatedUser) {
    if (
      ACCOUNTANT_ONLY_KINDS.includes(dto.kind) &&
      !hasPermission(user, Permission.LEDGER_RECONCILE)
    ) {
      throw new ForbiddenException(
        'Opening balances and general journal entries require the ledger.reconcile permission.',
      );
    }
    return this.journalService.post(dto, user);
  }

  @Post(':id/reverse')
  @RequirePermission({ permissions: [Permission.TRANSACTIONS_REVERSE] })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.journalService.reverse(id, dto, user);
  }
}
