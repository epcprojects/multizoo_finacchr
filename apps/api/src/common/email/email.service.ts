import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

/**
 * Deliberately minimal for Module 1: just enough to send invite and
 * password-reset emails. The full Notifications module (in-app feed,
 * websockets, queues) belongs to a later module, not the Identity
 * foundation — see Sprint Zero to Cutover, Part 03.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('sendgrid.apiKey');
    this.fromEmail = this.configService.get<string>('sendgrid.fromEmail') || 'no-reply@multizoo.local';
    this.enabled = Boolean(apiKey);

    if (this.enabled) {
      sgMail.setApiKey(apiKey as string);
    } else {
      this.logger.warn(
        'SENDGRID_API_KEY not set — emails will be logged to the console instead of sent.',
      );
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.enabled) {
      this.logger.log(`[dev email] to=${to} subject="${subject}"\n${html}`);
      return;
    }

    await sgMail.send({ to, from: this.fromEmail, subject, html });
  }

  async sendInviteEmail(params: {
    to: string;
    fullName: string;
    invitedBy: string;
    roleName: string;
    inviteToken: string;
  }): Promise<void> {
    const appUrl = process.env.FRONTEND_APP_URL || 'http://localhost:4200';
    const link = `${appUrl}/set-password?token=${params.inviteToken}&mode=invite`;

    await this.send(
      params.to,
      `You've been invited to Multizoo Ledger`,
      `<p>Hi ${params.fullName},</p>
       <p>${params.invitedBy} invited you to Multizoo Ledger as <b>${params.roleName}</b>.</p>
       <p><a href="${link}">Accept your invitation</a> (expires in 48 hours).</p>`,
    );
  }

  async sendPasswordResetEmail(params: {
    to: string;
    fullName: string;
    resetToken: string;
  }): Promise<void> {
    const appUrl = process.env.FRONTEND_APP_URL || 'http://localhost:4200';
    const link = `${appUrl}/set-password?token=${params.resetToken}`;

    await this.send(
      params.to,
      'Reset your Multizoo Ledger password',
      `<p>Hi ${params.fullName},</p>
       <p><a href="${link}">Reset your password</a> (expires in 1 hour). If you didn't request this, ignore this email.</p>`,
    );
  }
}
