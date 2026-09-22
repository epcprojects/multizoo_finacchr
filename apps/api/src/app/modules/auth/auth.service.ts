import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { generateRandomToken } from '@multizoo/utils';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailService } from '../../../common/email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account inactive');
    }

    return user;
  }

  async login(user: { id: string; email: string; fullName: string; roles: string[]; permissions: string[] }) {
    await this.usersService.updateLastLogin(user.id);

    const payload = { sub: user.id, email: user.email, roles: user.roles };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles,
        permissions: user.permissions,
      },
    };
  }

  async acceptInvite(token: string, password: string) {
    const user = await this.usersService.findByInviteToken(token);

    if (!user) throw new BadRequestException('Invalid invitation token');
    if (user.isInvitationAccepted) {
      throw new BadRequestException('Invitation already accepted');
    }
    if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
      throw new BadRequestException('Invitation expired');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.usersService.activateInvitedUser(user.id, passwordHash);

    return { message: 'Account activated successfully' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException(
        'New password and confirm password do not match',
      );
    }

    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user.passwordHash) {
      throw new BadRequestException('Password is not set for this account');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePassword(userId, passwordHash);

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const genericMessage =
      'If your email exists, a password reset link has been sent';

    const user = await this.usersService.findByEmail(email);
    if (!user) return { message: genericMessage };

    const token = generateRandomToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.usersService.setPasswordResetToken(user.id, token, expiresAt);

    await this.emailService.sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      resetToken: token,
    });

    return { message: genericMessage };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException(
        'New password and confirm password do not match',
      );
    }

    const user = await this.usersService.findByPasswordResetToken(token);
    if (!user) throw new BadRequestException('Invalid reset token');

    if (
      !user.resetPasswordExpiresAt ||
      user.resetPasswordExpiresAt < new Date()
    ) {
      throw new BadRequestException('Reset token expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePassword(user.id, passwordHash);
    await this.usersService.clearPasswordResetToken(user.id);

    return { message: 'Password reset successfully' };
  }
}
