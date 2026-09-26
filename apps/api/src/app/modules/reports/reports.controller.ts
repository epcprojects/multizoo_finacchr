import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@multizoo/types';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../users/users.service';
import { ReportsService } from './reports.service';
import { SchedulesService } from './schedules.service';
import { ArchiveQueryDto, CreateScheduleDto, GenerateReportDto, ReportFileQueryDto, UpdateScheduleDto } from './dto/reports.dto';

const P = Permission;
/** "Generate & download PDF reports" — every unit, or own unit only (Part 10). Each report also needs its data's permission. */
const REPORT = { permissions: [P.REPORTS_GENERATE, P.REPORTS_GENERATE_OWN_UNIT] };
/** Schedules run on the whole group. */
const SCHEDULE = { permissions: [P.REPORTS_GENERATE] };

@ApiTags('reports')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly schedules: SchedulesService,
  ) {}

  @Get('catalogue')
  @RequirePermission(REPORT)
  catalogue(@GetUser() user: AuthenticatedUser) {
    return this.reports.catalogue(user);
  }

  @Post('generate')
  @RequirePermission(REPORT)
  generate(@Body() dto: GenerateReportDto, @GetUser() user: AuthenticatedUser) {
    return this.reports.generate(dto.reportKey, dto.params, user);
  }

  @Get('archive')
  @RequirePermission(REPORT)
  archive(@Query() q: ArchiveQueryDto, @GetUser() user: AuthenticatedUser) {
    return this.reports.listArchive(q, user);
  }

  @Get('archive/:id/file')
  @RequirePermission(REPORT)
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ReportFileQueryDto,
    @GetUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { fileName, content } = await this.reports.file(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${q.download === '1' ? 'attachment' : 'inline'}; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(content);
  }

  @Get('schedules')
  @RequirePermission(SCHEDULE)
  listSchedules(@GetUser() user: AuthenticatedUser) {
    return this.schedules.list(user);
  }

  @Post('schedules')
  @RequirePermission(SCHEDULE)
  createSchedule(@Body() dto: CreateScheduleDto, @GetUser() user: AuthenticatedUser) {
    return this.schedules.create(dto, user);
  }

  @Patch('schedules/:id')
  @RequirePermission(SCHEDULE)
  updateSchedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleDto, @GetUser() user: AuthenticatedUser) {
    return this.schedules.update(id, dto, user);
  }

  @Delete('schedules/:id')
  @RequirePermission(SCHEDULE)
  removeSchedule(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.schedules.remove(id, user);
  }

  @Post('schedules/:id/run')
  @RequirePermission(SCHEDULE)
  runSchedule(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthenticatedUser) {
    return this.schedules.runNow(id, user);
  }
}
