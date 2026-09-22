import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { GetRoleQueryDTO } from './dto/get-role-query.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';

@ApiTags('roles')
@ApiBearerAuth('JWT-auth')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermission({ permissions: [Permission.ROLES_MANAGE] })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  // Also readable by anyone who can invite a user — they need to pick a
  // roleId from somewhere. Editing/creating/deleting stays ROLES_MANAGE-only.
  @Get()
  @RequirePermission({
    permissions: [Permission.ROLES_MANAGE, Permission.USERS_INVITE],
  })
  findAll(@Query() query: GetRoleQueryDTO) {
    return this.rolesService.findAll(query);
  }

  @Get(':id')
  @RequirePermission({
    permissions: [Permission.ROLES_MANAGE, Permission.USERS_INVITE],
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission({ permissions: [Permission.ROLES_MANAGE] })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission({ permissions: [Permission.ROLES_MANAGE] })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.softRemove(id);
  }
}
