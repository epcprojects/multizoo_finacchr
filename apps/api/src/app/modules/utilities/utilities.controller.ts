import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { UtilitiesService } from './utilities.service';
import {
  CreateBillDto,
  CreateConnectionDto,
  ListBillsQueryDto,
  PostBillDto,
  UnpostDto,
  UpdateBillDto,
  UpdateConnectionDto,
} from './dto/utilities.dto';

const P = Permission;
/** "Utility bill allocation sheet — Accountant" (Part 08); Partners read it with the P&L. */
const VIEW = { permissions: [P.UTILITIES_MANAGE, P.PNL_VIEW_CONSOLIDATED] };
const MANAGE = { permissions: [P.UTILITIES_MANAGE] };

@ApiTags('utilities')
@ApiBearerAuth('JWT-auth')
@Controller('utilities')
export class UtilitiesController {
  constructor(private readonly utilities: UtilitiesService) {}

  @Get('connections')
  @RequirePermission(VIEW)
  connections(@GetUser() user: AuthenticatedUser) {
    return this.utilities.listConnections(user);
  }

  @Post('connections')
  @RequirePermission(MANAGE)
  createConnection(@Body() dto: CreateConnectionDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.createConnection(dto, user);
  }

  @Get('connections/:id')
  @RequirePermission(VIEW)
  connection(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.utilities.getConnection(id, user);
  }

  @Patch('connections/:id')
  @RequirePermission(MANAGE)
  updateConnection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConnectionDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.updateConnection(id, dto, user);
  }

  @Get('bills')
  @RequirePermission(VIEW)
  bills(@Query() q: ListBillsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.listBills(q, user);
  }

  @Post('bills')
  @RequirePermission(MANAGE)
  createBill(@Body() dto: CreateBillDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.createBill(dto, user);
  }

  @Get('bills/:id')
  @RequirePermission(VIEW)
  bill(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.utilities.getBill(id, user);
  }

  @Patch('bills/:id')
  @RequirePermission(MANAGE)
  updateBill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBillDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.updateBill(id, dto, user);
  }

  @Delete('bills/:id')
  @RequirePermission(MANAGE)
  deleteBill(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.utilities.deleteBill(id, user);
  }

  @Post('bills/:id/post')
  @RequirePermission(MANAGE)
  post(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostBillDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.postBill(id, dto, user);
  }

  @Post('bills/:id/unpost')
  @RequirePermission(MANAGE)
  unpost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnpostDto, @GetUser() user: AuthenticatedUser) {
    return this.utilities.unpostBill(id, dto, user);
  }
}
