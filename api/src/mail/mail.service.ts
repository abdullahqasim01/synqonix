import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import type { Env } from '../config/env.js';
import {
  inviteTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from './mail.templates.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly webUrl: string;
  private readonly resend?: Resend;
  private readonly smtp?: Transporter;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM');
    this.webUrl = config.get('WEB_URL');
    const key = config.get('RESEND_API_KEY');
    if (key) {
      this.resend = new Resend(key);
    } else {
      this.smtp = createTransport({
        host: config.get('SMTP_HOST'),
        port: config.get('SMTP_PORT'),
        secure: false,
        ignoreTLS: true,
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({ from: this.from, ...message });
      if (error) throw new Error(`Resend error: ${error.message}`);
      return;
    }
    await this.smtp!.sendMail({ from: this.from, ...message });
  }

  /** Email delivery must never break the request that triggered it. */
  private async safeSend(message: MailMessage) {
    try {
      await this.send(message);
    } catch (err) {
      this.logger.error(`Failed to send "${message.subject}" to ${message.to}`, err as Error);
    }
  }

  sendVerificationEmail(user: { email: string; name: string }, token: string) {
    const url = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;
    return this.safeSend({ to: user.email, ...verifyEmailTemplate(user.name, url) });
  }

  sendPasswordResetEmail(user: { email: string; name: string }, token: string) {
    const url = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return this.safeSend({ to: user.email, ...resetPasswordTemplate(user.name, url) });
  }

  sendInvitationEmail(to: string, inviter: string, workspace: string, token: string) {
    const url = `${this.webUrl}/invitations/${encodeURIComponent(token)}`;
    return this.safeSend({ to, ...inviteTemplate(inviter, workspace, url) });
  }
}
