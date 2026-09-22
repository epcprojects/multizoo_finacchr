import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateRandomToken } from '@multizoo/utils';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user.roles.entity';
import { Role } from '../roles/entities/role.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { EmailService } from '../../../common/email/email.service';

/** Shape attached to `request.user` once the JWT strategy resolves it. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isInvitationAccepted: boolean;
  lastLoginAt: Date | null;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,

    private readonly emailService: EmailService,
  ) {}

  private async withRolesAndPermissions(
    user: User,
  ): Promise<AuthenticatedUser> {
    const userRoles = await this.userRoleRepo.find({
      where: { userId: user.id },
      relations: { role: { roleClaims: true } },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          ur.role.roleClaims
            .filter((c) => c.claimValue === 'true')
            .map((c) => c.claimType),
        ),
      ),
    ];

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      isInvitationAccepted: user.isInvitationAccepted,
      lastLoginAt: user.lastLoginAt,
      roles,
      permissions,
    };
  }

  async findByEmail(email: string): Promise<AuthenticatedUser | null> {
    const user = await this.userRepo.findOne({
      where: { normalizedEmail: email.toUpperCase() },
    });
    if (!user) return null;
    return this.withRolesAndPermissions(user);
  }

  /** Same as findByEmail, but also returns the password hash — login only. */
  async findByEmailWithPassword(
    email: string,
  ): Promise<(AuthenticatedUser & { passwordHash: string | null }) | null> {
    const user = await this.userRepo.findOne({
      where: { normalizedEmail: email.toUpperCase() },
    });
    if (!user) return null;
    const resolved = await this.withRolesAndPermissions(user);
    return { ...resolved, passwordHash: user.passwordHash };
  }

  async findById(id: string): Promise<AuthenticatedUser> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.withRolesAndPermissions(user);
  }

  async findByIdWithPassword(
    id: string,
  ): Promise<AuthenticatedUser & { passwordHash: string | null }> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const resolved = await this.withRolesAndPermissions(user);
    return { ...resolved, passwordHash: user.passwordHash };
  }

  async invite(dto: InviteUserDto, invitedBy: AuthenticatedUser) {
    const role = await this.roleRepo.findOneBy({ id: dto.roleId });
    if (!role) throw new BadRequestException('Invalid role specified');

    const existing = await this.userRepo.findOne({
      where: { normalizedEmail: dto.email.toUpperCase() },
    });

    if (existing && (existing.isInvitationAccepted || existing.isActive)) {
      throw new ConflictException('A user with that email already exists');
    }

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 48);

    const user = existing ?? this.userRepo.create({ email: dto.email });
    user.email = dto.email;
    user.fullName = dto.fullName;
    user.inviteToken = generateRandomToken();
    user.inviteExpiresAt = expiry;
    user.isInvitationAccepted = false;
    user.isActive = false;
    user.createdBy = invitedBy.id;

    const saved = await this.userRepo.save(user);

    await this.userRoleRepo.delete({ userId: saved.id });
    await this.userRoleRepo.save(
      this.userRoleRepo.create({
        userId: saved.id,
        roleId: role.id,
        assignedBy: invitedBy.id,
      }),
    );

    await this.emailService.sendInviteEmail({
      to: saved.email,
      fullName: saved.fullName,
      invitedBy: invitedBy.fullName,
      roleName: role.name,
      inviteToken: saved.inviteToken as string,
    });

    return { message: `Invitation sent to ${dto.email}` };
  }

  async findByInviteToken(token: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { inviteToken: token } });
  }

  async activateInvitedUser(userId: string, passwordHash: string) {
    await this.userRepo.update(userId, {
      passwordHash,
      isActive: true,
      isInvitationAccepted: true,
      inviteToken: null,
      inviteExpiresAt: null,
    });
  }

  async updateLastLogin(userId: string) {
    await this.userRepo.update(userId, { lastLoginAt: new Date() });
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { resetPasswordToken: token } });
  }

  async setPasswordResetToken(userId: string, token: string, expiresAt: Date) {
    await this.userRepo.update(userId, {
      resetPasswordToken: token,
      resetPasswordExpiresAt: expiresAt,
    });
  }

  async clearPasswordResetToken(userId: string) {
    await this.userRepo.update(userId, {
      resetPasswordToken: null,
      resetPasswordExpiresAt: null,
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    await this.userRepo.update(userId, { passwordHash });
  }

  async updateMyName(userId: string, fullName: string) {
    await this.userRepo.update(userId, { fullName });
    return this.findById(userId);
  }

  async updateRole(
    userId: string,
    dto: UpdateUserRoleDto,
    actor: AuthenticatedUser,
  ) {
    const role = await this.roleRepo.findOneBy({ id: dto.roleId });
    if (!role) throw new BadRequestException('Invalid role specified');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.userRoleRepo.delete({ userId });
    await this.userRoleRepo.save(
      this.userRoleRepo.create({
        userId,
        roleId: role.id,
        assignedBy: actor.id,
      }),
    );

    return this.findById(userId);
  }

  async softDeleteUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.userRepo.softDelete(userId);
    await this.userRepo.update(userId, {
      email: `deleted_${Date.now()}_${user.email}`,
      normalizedEmail: `DELETED_${Date.now()}_${user.email.toUpperCase()}`,
    });

    return { success: true };
  }

  async findAll(): Promise<AuthenticatedUser[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
    return Promise.all(users.map((u) => this.withRolesAndPermissions(u)));
  }
}
