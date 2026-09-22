import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@multizoo/types';
import { UsersService, AuthenticatedUser } from './users.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMyNameDto } from './dto/update-my-name.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { GetUser } from '../../../common/decorators/get-user.decorator';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMyself(@GetUser() user: AuthenticatedUser) {
    return user;
  }

  @Patch('me/name')
  updateMyName(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyNameDto,
  ) {
    return this.usersService.updateMyName(user.id, dto.fullName);
  }

  @Get()
  @RequirePermission({ permissions: [Permission.USERS_INVITE] })
  findAll() {
    return this.usersService.findAll();
  }

  @Post('invite')
  @RequirePermission({ permissions: [Permission.USERS_INVITE] })
  invite(@Body() dto: InviteUserDto, @GetUser() user: AuthenticatedUser) {
    return this.usersService.invite(dto, user);
  }

  @Patch(':id/role')
  @RequirePermission({ permissions: [Permission.USERS_INVITE] })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.usersService.updateRole(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission({ permissions: [Permission.USERS_INVITE] })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.softDeleteUser(id);
  }
}
