import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user.roles.entity';
import { Role } from '../roles/entities/role.entity';
import { UserBusinessUnit } from './entities/user.business-unit.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { EmailModule } from '../../../common/email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, Role, UserBusinessUnit, BusinessUnit]),
    EmailModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
