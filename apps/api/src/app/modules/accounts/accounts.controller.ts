import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { AccountsService } from './accounts.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './dto/account.dto';
import {
  CreateReconciliationDto,
  LedgerRangeQueryDto,
} from '../ledger/dto/ledger.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';

@ApiTags('accounts')
@ApiBearerAuth('JWT-auth')
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly ledgerService: LedgerService,
  ) {}

  // Branch staff need the list too — it's how the entry form offers accounts.
  @Get()
  @RequirePermission({
    permissions: [Permission.LEDGER_VIEW, Permission.TRANSACTIONS_CREATE_OWN_UNIT],
  })
  list(@Query() query: ListAccountsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.accountsService.list(query, user);
  }

  @Get(':id')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.accountsService.findOne(id, user);
  }

  @Post()
  @RequirePermission({ permissions: [Permission.ACCOUNTS_MANAGE] })
  create(@Body() dto: CreateAccountDto, @GetUser() user: AuthenticatedUser) {
    return this.accountsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission({ permissions: [Permission.ACCOUNTS_MANAGE] })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.accountsService.update(id, dto, user);
  }

  @Get(':id/ledger')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LedgerRangeQueryDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.ledgerService.accountLedger(id, user, query.from, query.to);
  }

  @Get(':id/reconciliations')
  @RequirePermission({ permissions: [Permission.LEDGER_VIEW] })
  reconciliations(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.ledgerService.listReconciliations(id, user);
  }

  @Post(':id/reconciliations')
  @RequirePermission({ permissions: [Permission.LEDGER_RECONCILE] })
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReconciliationDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.ledgerService.createReconciliation(id, dto, user);
  }
}
