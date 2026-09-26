import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { SalesService } from './sales.service';
import {
  CreateSalesItemDto,
  ListSalesDaysQueryDto,
  ListSalesItemsQueryDto,
  OpenSalesDayDto,
  SalesCompareQueryDto,
  SalesTotalQueryDto,
  SalesYearQueryDto,
  SaveSalesDayDto,
  SaveSalesEventDto,
  UnpostSalesDayDto,
  UpdateSalesItemDto,
} from './dto/sales.dto';

const P = Permission;
/** "Enter daily sales / expenses for own unit" — Accountant, Branch Manager, Branch staff. */
const ENTER = { permissions: [P.TRANSACTIONS_CREATE_OWN_UNIT] };
/** Reading days and the price list: whoever enters them, and whoever reads the ledger. */
const VIEW = { permissions: [P.TRANSACTIONS_CREATE_OWN_UNIT, P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED, P.SALES_MANAGE] };
/** "Sales & ticketing report, incl. YoY comparison — Partners" (Part 08); a manager for their own unit. */
const REPORT = { permissions: [P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED] };
/** Qualifying sales for a commission pool. */
const TOTAL = { permissions: [P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED, P.PAYROLL_RUN] };
/** Undoing a posted day reverses a ledger entry — the Accountant's. */
const UNPOST = { permissions: [P.TRANSACTIONS_REVERSE] };
const MANAGE = { permissions: [P.SALES_MANAGE] };

@ApiTags('sales')
@ApiBearerAuth('JWT-auth')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // Price list
  @Get('items')
  @RequirePermission(VIEW)
  items(@Query() q: ListSalesItemsQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.listItems(q, user);
  }

  @Post('items')
  @RequirePermission(MANAGE)
  createItem(@Body() dto: CreateSalesItemDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.createItem(dto, user);
  }

  @Patch('items/:id')
  @RequirePermission(MANAGE)
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalesItemDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.updateItem(id, dto, user);
  }

  // Days
  @Get('stats')
  @RequirePermission(VIEW)
  stats(@GetUser() user: AuthenticatedUser) {
    return this.sales.stats(user);
  }

  @Get('days')
  @RequirePermission(VIEW)
  days(@Query() q: ListSalesDaysQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.listDays(q, user);
  }

  @Post('days')
  @RequirePermission(ENTER)
  openDay(@Body() dto: OpenSalesDayDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.openDay(dto, user);
  }

  @Get('days/:id')
  @RequirePermission(VIEW)
  day(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.sales.getDay(id, user);
  }

  @Patch('days/:id')
  @RequirePermission(ENTER)
  saveDay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSalesDayDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.saveDay(id, dto, user);
  }

  @Delete('days/:id')
  @RequirePermission(ENTER)
  deleteDay(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.sales.deleteDay(id, user);
  }

  @Post('days/:id/post')
  @RequirePermission(ENTER)
  postDay(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.sales.postDay(id, user);
  }

  @Post('days/:id/unpost')
  @RequirePermission(UNPOST)
  unpostDay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnpostSalesDayDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.unpostDay(id, dto, user);
  }

  // Reports
  @Get('reports/grid')
  @RequirePermission(REPORT)
  grid(@Query() q: SalesYearQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.grid(q, user);
  }

  @Get('reports/breakup')
  @RequirePermission(REPORT)
  breakup(@Query() q: SalesYearQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.breakup(q, user);
  }

  @Get('reports/year-over-year')
  @RequirePermission(REPORT)
  yoy(@Query() q: SalesYearQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.yearOverYear(q, user);
  }

  @Get('reports/compare')
  @RequirePermission(REPORT)
  compare(@Query() q: SalesCompareQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.compare(q, user);
  }

  @Get('reports/total')
  @RequirePermission(TOTAL)
  total(@Query() q: SalesTotalQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.total(q, user);
  }

  // Peak events
  @Get('events')
  @RequirePermission(REPORT)
  events() {
    return this.sales.listEvents();
  }

  @Post('events')
  @RequirePermission(MANAGE)
  createEvent(@Body() dto: SaveSalesEventDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.createEvent(dto, user);
  }

  @Patch('events/:id')
  @RequirePermission(MANAGE)
  updateEvent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSalesEventDto, @GetUser() user: AuthenticatedUser) {
    return this.sales.updateEvent(id, dto, user);
  }
}
