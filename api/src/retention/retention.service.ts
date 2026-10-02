import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;

export interface RetentionResult { auditLogs: number; notifications: number; webhookDeliveries: number; githubDeliveries: number }

/** Nightly cleanup of records that only matter for a while. A setting of 0 days keeps that kind forever. */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async run(now = new Date()): Promise<RetentionResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY);
    const audit = this.config.get('AUDIT_RETENTION_DAYS');
    const notes = this.config.get('NOTIFICATION_RETENTION_DAYS');
    const deliveries = this.config.get('DELIVERY_RETENTION_DAYS');
    return {
      auditLogs: audit ? (await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: before(audit) } } })).count : 0,
      // Unread notifications stay; only ones already read go.
      notifications: notes ? (await this.prisma.notification.deleteMany({ where: { readAt: { not: null, lt: before(notes) } } })).count : 0,
      // Deliveries still waiting for a retry are never purged.
      webhookDeliveries: deliveries ? (await this.prisma.outboundDelivery.deleteMany({ where: { status: { not: 'PENDING' }, createdAt: { lt: before(deliveries) } } })).count : 0,
      githubDeliveries: deliveries ? (await this.prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: before(deliveries) } } })).count : 0,
    };
  }

  @Cron('17 3 * * *')
  async nightly() {
    try {
      const r = await this.run();
      this.logger.log(`Retention cleanup removed ${JSON.stringify(r)}`);
    } catch (err) {
      this.logger.error('Retention cleanup failed', err as Error);
    }
  }
}
