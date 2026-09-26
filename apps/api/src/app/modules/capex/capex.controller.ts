import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { CapexService } from './capex.service';
import { CampaignsService } from './campaigns.service';
import {
  CampaignEntryDto,
  CloseCampaignDto,
  CreateCampaignDto,
  CreateCapexDto,
  ListCampaignsQueryDto,
  ListCapexQueryDto,
  RemoveCapexDto,
  RetireCapexDto,
  ReverseCampaignEntryDto,
  UpdateCampaignDto,
  UpdateCapexDto,
} from './dto/capex.dto';

const P = Permission;
/** "Capex register & campaign P&L — Partners" (Part 08); kept by the Accountant. */
const VIEW = { permissions: [P.CAPEX_MANAGE, P.PNL_VIEW_CONSOLIDATED] };
const MANAGE = { permissions: [P.CAPEX_MANAGE] };

@ApiTags('capex')
@ApiBearerAuth('JWT-auth')
@Controller('capex')
export class CapexController {
  constructor(private readonly capex: CapexService) {}

  @Get()
  @RequirePermission(VIEW)
  list(@Query() q: ListCapexQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.capex.list(q, user);
  }

  @Post()
  @RequirePermission(MANAGE)
  create(@Body() dto: CreateCapexDto, @GetUser() user: AuthenticatedUser) {
    return this.capex.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.capex.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCapexDto, @GetUser() user: AuthenticatedUser) {
    return this.capex.update(id, dto, user);
  }

  @Post(':id/retire')
  @RequirePermission(MANAGE)
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RetireCapexDto, @GetUser() user: AuthenticatedUser) {
    return this.capex.retire(id, dto, user);
  }

  @Post(':id/reinstate')
  @RequirePermission(MANAGE)
  reinstate(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.capex.reinstate(id, user);
  }

  @Delete(':id')
  @RequirePermission(MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveCapexDto, @GetUser() user: AuthenticatedUser) {
    return this.capex.remove(id, dto ?? {}, user);
  }
}

@ApiTags('campaigns')
@ApiBearerAuth('JWT-auth')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission(VIEW)
  list(@Query() q: ListCampaignsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.list(q, user);
  }

  @Post()
  @RequirePermission(MANAGE)
  create(@Body() dto: CreateCampaignDto, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.create(dto, user);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.update(id, dto, user);
  }

  @Post(':id/entries')
  @RequirePermission(MANAGE)
  addEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignEntryDto, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.addEntry(id, dto, user);
  }

  @Post(':id/entries/:entryId/reverse')
  @RequirePermission(MANAGE)
  reverseEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: ReverseCampaignEntryDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.campaigns.reverseEntry(id, entryId, dto, user);
  }

  @Post(':id/close')
  @RequirePermission(MANAGE)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseCampaignDto, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.close(id, dto, user);
  }

  @Post(':id/reopen')
  @RequirePermission(MANAGE)
  reopen(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.campaigns.reopen(id, user);
  }
}
