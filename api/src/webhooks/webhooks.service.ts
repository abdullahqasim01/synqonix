import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Membership, OutboundWebhook, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptSecret, encryptSecret, newSecret, signPayload } from './crypto.js';
import type {
  CreatedWebhookDto, CreateWebhookDto, DeliveryDto, TestResultDto, UpdateWebhookDto, WebhookDto, WebhookEvent,
} from './dto/webhooks.dto.js';
import { checkWebhookUrl } from './url-guard.js';
import { WebhookSender } from './webhook-sender.js';

const MAX_WEBHOOKS = 20;
/** Delay before attempt 2, 3, ...; after the last one the delivery is given up. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Consecutive deliveries that were given up on before the webhook turns itself off. */
export const MAX_FAILURES = 10;
const TIMEOUT_MS = 10_000;

const toDto = (w: OutboundWebhook): WebhookDto => ({
  id: w.id, name: w.name, url: w.url, events: w.events, projectId: w.projectId, active: w.active, failureCount: w.failureCount,
  disabledReason: w.disabledReason, lastSuccessAt: w.lastSuccessAt, createdAt: w.createdAt,
});

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly appSecret: string;
  private readonly allowPrivate: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WebhookSender,
    config: ConfigService<Env, true>,
  ) {
    this.appSecret = config.get('JWT_REFRESH_SECRET');
    this.allowPrivate = config.get('WEBHOOKS_ALLOW_PRIVATE_TARGETS') === '1';
  }

  // ---------------------------------------------------------------- management

  private checkUrl(url: string) {
    const c = checkWebhookUrl(url, this.allowPrivate);
    if (!c.ok) throw new BadRequestException(c.reason);
  }

  private async checkProject(workspaceId: string, projectId: string | null | undefined) {
    if (projectId && !(await this.prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown project');
    }
  }

  async list(m: Membership): Promise<WebhookDto[]> {
    return (await this.prisma.outboundWebhook.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { createdAt: 'asc' } })).map(toDto);
  }

  async create(m: Membership, dto: CreateWebhookDto): Promise<CreatedWebhookDto> {
    this.checkUrl(dto.url);
    await this.checkProject(m.workspaceId, dto.projectId);
    if ((await this.prisma.outboundWebhook.count({ where: { workspaceId: m.workspaceId } })) >= MAX_WEBHOOKS) {
      throw new ConflictException(`A workspace can have at most ${MAX_WEBHOOKS} webhooks`);
    }
    const secret = newSecret();
    const row = await this.prisma.outboundWebhook.create({
      data: {
        workspaceId: m.workspaceId, projectId: dto.projectId ?? null, name: dto.name.trim(), url: dto.url, events: [...new Set(dto.events)],
        secret: encryptSecret(secret, this.appSecret), createdById: m.userId,
      },
    });
    return { ...toDto(row), secret };
  }

  private async load(m: Membership, id: string) {
    const w = await this.prisma.outboundWebhook.findFirst({ where: { id, workspaceId: m.workspaceId } });
    if (!w) throw new NotFoundException('Webhook not found');
    return w;
  }

  async update(m: Membership, id: string, dto: UpdateWebhookDto): Promise<WebhookDto> {
    await this.load(m, id);
    if (dto.url !== undefined) this.checkUrl(dto.url);
    await this.checkProject(m.workspaceId, dto.projectId);
    return toDto(await this.prisma.outboundWebhook.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }), ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events && { events: [...new Set(dto.events)] }), ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.active !== undefined && { active: dto.active, ...(dto.active ? { failureCount: 0, disabledReason: null } : {}) }),
      },
    }));
  }

  async rotateSecret(m: Membership, id: string): Promise<CreatedWebhookDto> {
    await this.load(m, id);
    const secret = newSecret();
    return { ...toDto(await this.prisma.outboundWebhook.update({ where: { id }, data: { secret: encryptSecret(secret, this.appSecret) } })), secret };
  }

  async remove(m: Membership, id: string) {
    await this.load(m, id);
    await this.prisma.outboundWebhook.delete({ where: { id } });
  }

  async deliveries(m: Membership, id: string): Promise<DeliveryDto[]> {
    await this.load(m, id);
    const rows = await this.prisma.outboundDelivery.findMany({ where: { webhookId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((d) => ({
      id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, error: d.error, createdAt: d.createdAt,
      deliveredAt: d.deliveredAt, nextAttemptAt: d.nextAttemptAt,
    }));
  }

  /** Sends the same payload again as a fresh delivery. */
  async redeliver(m: Membership, id: string, deliveryId: string) {
    await this.load(m, id);
    const d = await this.prisma.outboundDelivery.findFirst({ where: { id: deliveryId, webhookId: id } });
    if (!d) throw new NotFoundException('Delivery not found');
    const fresh = randomUUID();
    await this.prisma.outboundDelivery.create({ data: { id: fresh, webhookId: id, event: d.event, payload: { ...(d.payload as Prisma.InputJsonObject), id: fresh } } });
  }

  /** Sends a `ping` right away and reports what the endpoint answered, without queueing or retrying. */
  async test(m: Membership, id: string): Promise<TestResultDto> {
    const w = await this.load(m, id);
    const payload = { id: randomUUID(), event: 'ping', createdAt: new Date().toISOString(), workspaceId: m.workspaceId, zen: 'Keep it logically awesome.' };
    try {
      const { status } = await this.post(w, 'ping', payload.id, JSON.stringify(payload));
      return { ok: status >= 200 && status < 300, responseStatus: status, error: null };
    } catch (e) {
      return { ok: false, responseStatus: null, error: (e as Error).message };
    }
  }

  // ---------------------------------------------------------------- queueing

  /** Queues the event for every active webhook of the workspace that wants it (and, if scoped, for that project). */
  async enqueue(workspaceId: string, projectId: string | null, event: WebhookEvent, payload: Prisma.InputJsonObject): Promise<number> {
    const hooks = await this.prisma.outboundWebhook.findMany({
      where: { workspaceId, active: true, events: { has: event }, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
      select: { id: true },
    });
    if (hooks.length === 0) return 0;
    const createdAt = new Date().toISOString();
    await this.prisma.outboundDelivery.createMany({
      data: hooks.map((h) => {
        const id = randomUUID();
        return { id, webhookId: h.id, event, payload: { id, event, createdAt, workspaceId, ...payload } };
      }),
    });
    return hooks.length;
  }

  // ---------------------------------------------------------------- delivering

  private post(w: OutboundWebhook, event: string, deliveryId: string, body: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = decryptSecret(w.secret, this.appSecret);
    return this.sender.send({
      url: w.url, timeoutMs: TIMEOUT_MS, body,
      headers: {
        'Content-Type': 'application/json', 'User-Agent': 'Synqonix-Webhooks/1', 'X-Synqonix-Event': event, 'X-Synqonix-Delivery': deliveryId,
        'X-Synqonix-Timestamp': String(timestamp), 'X-Synqonix-Signature': signPayload(secret, timestamp, body),
      },
    });
  }

  /**
   * Attempts the deliveries that are due. Each is claimed by bumping `attempts` only if nobody else
   * did, so concurrent workers never send the same attempt twice. Failures back off (1m, 5m, 30m,
   * 2h, 6h) and are then given up on; a webhook whose deliveries keep failing switches itself off.
   */
  async deliverDue(now = new Date()): Promise<number> {
    const due = await this.prisma.outboundDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now }, webhook: { active: true } }, orderBy: { nextAttemptAt: 'asc' }, take: 50, include: { webhook: true },
    });
    let sent = 0;
    for (const d of due) {
      const claimed = await this.prisma.outboundDelivery.updateMany({ where: { id: d.id, status: 'PENDING', attempts: d.attempts }, data: { attempts: { increment: 1 } } });
      if (claimed.count === 0) continue;
      const attempts = d.attempts + 1;
      let status: number | null = null;
      let error: string | null = null;
      try {
        status = (await this.post(d.webhook, d.event, d.id, JSON.stringify(d.payload))).status;
        if (status < 200 || status >= 300) error = `The endpoint answered ${status}`;
      } catch (e) {
        error = (e as Error).message;
      }
      sent++;
      if (!error) {
        await this.prisma.$transaction([
          this.prisma.outboundDelivery.update({ where: { id: d.id }, data: { status: 'SUCCESS', responseStatus: status, error: null, deliveredAt: now } }),
          this.prisma.outboundWebhook.update({ where: { id: d.webhookId }, data: { failureCount: 0, lastSuccessAt: now } }),
        ]);
      } else if (attempts < MAX_ATTEMPTS) {
        await this.prisma.outboundDelivery.update({ where: { id: d.id }, data: { responseStatus: status, error, nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]) } });
      } else {
        const hook = await this.prisma.outboundWebhook.update({ where: { id: d.webhookId }, data: { failureCount: { increment: 1 } } });
        await this.prisma.outboundDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', responseStatus: status, error } });
        if (hook.failureCount >= MAX_FAILURES) {
          await this.prisma.outboundWebhook.update({ where: { id: d.webhookId }, data: { active: false, disabledReason: `Switched off after ${MAX_FAILURES} deliveries failed in a row` } });
        }
      }
    }
    return sent;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try { await this.deliverDue(); } catch (err) { this.logger.error('Webhook delivery failed', err as Error); }
  }
}
