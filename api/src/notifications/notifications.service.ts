import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../generated/prisma/client.js';
import type { Membership, Notification, NotificationType } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import type {
  ListNotificationsQueryDto, NotificationDto, NotificationListDto, PreferencesDto, UnreadCountDto, UpdatePreferencesDto,
} from './dto/notifications.dto.js';
import { NotificationEvents, type NotificationChangedEvent } from './events.js';
import {
  formatClock, isValidTimezone, NOTIFICATION_TYPES, parseClock, resolveTypePreferences, shouldSendEmailsNow, type QuietHours,
} from './preferences.js';

export interface NotifyInput {
  workspaceId: string;
  projectId?: string | null;
  type: NotificationType;
  /** Never notified about their own actions. */
  actorId?: string | null;
  userIds: string[];
  title: string;
  body?: string | null;
  url: string;
  taskId?: string | null;
  taskKey?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  /** Same key for the same user means "already told them". */
  dedupeKey?: string;
}

const MAX_SNOOZE_MS = 30 * 24 * 3600_000;
const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

const toDto = (n: Notification): NotificationDto => ({
  id: n.id, type: n.type, workspaceId: n.workspaceId, projectId: n.projectId, actorId: n.actorId, title: n.title, body: n.body,
  taskKey: n.taskKey, channelId: n.channelId, url: n.url, read: n.readAt !== null, surfacedAt: n.surfacedAt,
});

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly mail: MailService,
    private readonly events: EventEmitter2,
  ) {}

  private changed(userId: string) {
    const e: NotificationChangedEvent = { userId };
    this.events.emit(NotificationEvents.changed, e);
  }

  // ---------------------------------------------------------------- creating

  /** The people from `userIds` who belong to the workspace and may see the project (if any). */
  private async eligible(workspaceId: string, projectId: string | null | undefined, userIds: string[]): Promise<string[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const members = await this.prisma.membership.findMany({ where: { workspaceId, userId: { in: ids } } });
    if (!projectId) return members.map((m) => m.userId);
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) return [];
    const pms = await this.prisma.projectMember.findMany({ where: { projectId, userId: { in: ids } } });
    return members.filter((m) => this.projects.canView(m, project, pms.find((p) => p.userId === m.userId) ?? null)).map((m) => m.userId);
  }

  /** Creates the notification for each recipient who may see it and wants it; returns how many were created. */
  async notify(input: NotifyInput, now = new Date()): Promise<number> {
    const recipients = (await this.eligible(input.workspaceId, input.projectId, input.userIds)).filter((id) => id !== input.actorId);
    if (recipients.length === 0) return 0;
    const [prefs, mutes] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId: { in: recipients } } }),
      input.projectId ? this.prisma.notificationMute.findMany({ where: { projectId: input.projectId, userId: { in: recipients } } }) : Promise.resolve([]),
    ]);
    const muted = new Set(mutes.map((m) => m.userId));

    let created = 0;
    for (const userId of recipients) {
      if (muted.has(userId)) continue;
      const pref = prefs.find((p) => p.userId === userId);
      const type = resolveTypePreferences(pref?.types)[input.type];
      const mode = pref?.emailMode ?? 'INSTANT';
      const wantsEmail = type.email && mode !== 'OFF';
      if (!type.inApp && !wantsEmail) continue;
      try {
        await this.prisma.notification.create({
          data: {
            userId, workspaceId: input.workspaceId, projectId: input.projectId ?? null, type: input.type, actorId: input.actorId ?? null,
            title: input.title, body: input.body ?? null, url: input.url, taskId: input.taskId ?? null, taskKey: input.taskKey ?? null,
            channelId: input.channelId ?? null, messageId: input.messageId ?? null, dedupeKey: input.dedupeKey ?? null,
            inApp: type.inApp, emailState: wantsEmail ? 'PENDING' : 'NONE', surfacedAt: now,
          },
        });
      } catch (e) {
        if (isUnique(e)) continue; // already told them
        throw e;
      }
      created++;
      this.events.emit(NotificationEvents.created, { userId } satisfies NotificationChangedEvent);
      if (wantsEmail && mode === 'INSTANT') await this.flushEmails(now, userId);
    }
    return created;
  }

  // ---------------------------------------------------------------- email

  private quietOf(p: { quietEnabled: boolean; quietStart: number; quietEnd: number; timezone: string } | undefined): QuietHours {
    return { enabled: p?.quietEnabled ?? false, start: p?.quietStart ?? 1320, end: p?.quietEnd ?? 480, timezone: p?.timezone ?? 'UTC' };
  }

  /**
   * Sends pending emails that are due. Instant users get theirs right away (together, if several
   * built up during quiet hours); digest users get at most one an hour. Anything already read in
   * the app is skipped, and failures stay queued for the next run.
   */
  async flushEmails(now = new Date(), onlyUserId?: string): Promise<number> {
    const groups = await this.prisma.notification.groupBy({
      by: ['userId'], where: { emailState: 'PENDING', ...(onlyUserId ? { userId: onlyUserId } : {}) },
    });
    let sent = 0;
    for (const { userId } of groups) {
      const [pref, user] = await Promise.all([
        this.prisma.notificationPreference.findUnique({ where: { userId } }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      ]);
      const mode = pref?.emailMode ?? 'INSTANT';
      if (!user || mode === 'OFF') {
        await this.prisma.notification.updateMany({ where: { userId, emailState: 'PENDING' }, data: { emailState: 'NONE' } });
        continue;
      }
      if (!shouldSendEmailsNow(mode, this.quietOf(pref ?? undefined), pref?.lastDigestAt ?? null, now)) continue;

      const pending = await this.prisma.notification.findMany({ where: { userId, emailState: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50 });
      const unread = pending.filter((n) => n.readAt === null);
      const seen = pending.filter((n) => n.readAt !== null);
      if (seen.length) await this.prisma.notification.updateMany({ where: { id: { in: seen.map((n) => n.id) } }, data: { emailState: 'NONE' } });
      if (unread.length === 0) continue;
      try {
        await this.mail.sendNotificationEmail(user.email, unread.map((n) => ({ title: n.title, body: n.body, url: n.url })));
      } catch (err) {
        this.logger.warn(`Email to ${user.email} failed, will retry: ${(err as Error).message}`);
        continue;
      }
      await this.prisma.notification.updateMany({ where: { id: { in: unread.map((n) => n.id) } }, data: { emailState: 'SENT' } });
      if (mode === 'DIGEST') {
        await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, lastDigestAt: now }, update: { lastDigestAt: now } });
      }
      sent++;
    }
    return sent;
  }

  // ---------------------------------------------------------------- reading

  /** Where clause for what the user may still see: their workspaces, and projects they can still view. */
  private async visibleWhere(userId: string, workspaceId?: string): Promise<Prisma.NotificationWhereInput> {
    const memberships: Membership[] = await this.prisma.membership.findMany({ where: { userId, ...(workspaceId ? { workspaceId } : {}) } });
    if (memberships.length === 0) return { id: { in: [] } };
    return {
      userId, inApp: true,
      OR: memberships.map((m) => ({
        workspaceId: m.workspaceId,
        OR: [{ projectId: null }, { project: { is: this.projects.visibleProjects(m) } }],
      })),
    };
  }

  private notSnoozed(now: Date): Prisma.NotificationWhereInput {
    return { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  }

  async list(userId: string, q: ListNotificationsQueryDto, now = new Date()): Promise<NotificationListDto> {
    const limit = q.limit ?? 30;
    const before = q.before ? new Date(q.before) : undefined;
    const rows = await this.prisma.notification.findMany({
      where: {
        AND: [
          await this.visibleWhere(userId, q.workspaceId), this.notSnoozed(now),
          q.unread ? { readAt: null } : {}, before ? { surfacedAt: { lt: before } } : {},
        ],
      },
      orderBy: [{ surfacedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    return { items: rows.slice(0, limit).map(toDto), hasMore: rows.length > limit };
  }

  async unreadCount(userId: string, workspaceId?: string, now = new Date()): Promise<UnreadCountDto> {
    const where: Prisma.NotificationWhereInput = { AND: [await this.visibleWhere(userId, workspaceId), this.notSnoozed(now), { readAt: null }] };
    const grouped = await this.prisma.notification.groupBy({ by: ['workspaceId'], where, _count: { _all: true } });
    const workspaces = grouped.map((g) => ({ workspaceId: g.workspaceId, count: g._count._all }));
    return { count: workspaces.reduce((n, w) => n + w.count, 0), workspaces };
  }

  private async own(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    return n;
  }

  async setRead(userId: string, id: string, read: boolean) {
    await this.own(userId, id);
    await this.prisma.notification.update({ where: { id }, data: { readAt: read ? new Date() : null } });
    this.changed(userId);
  }

  async readAll(userId: string, workspaceId?: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(workspaceId ? { workspaceId } : {}) }, data: { readAt: new Date() } });
    this.changed(userId);
  }

  async snooze(userId: string, id: string, until: string, now = new Date()) {
    const at = new Date(until);
    if (at.getTime() <= now.getTime()) throw new BadRequestException('Choose a time in the future');
    if (at.getTime() - now.getTime() > MAX_SNOOZE_MS) throw new BadRequestException('You can snooze for at most 30 days');
    await this.own(userId, id);
    await this.prisma.notification.update({ where: { id }, data: { snoozedUntil: at } });
    this.changed(userId);
  }

  async dismiss(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.notification.delete({ where: { id } });
    this.changed(userId);
  }

  /** Brings snoozed notifications back as unread once their time has passed. */
  async wakeSnoozed(now = new Date()): Promise<number> {
    const due = await this.prisma.notification.findMany({ where: { snoozedUntil: { lte: now } }, select: { id: true, userId: true } });
    if (due.length === 0) return 0;
    await this.prisma.notification.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { snoozedUntil: null, readAt: null, surfacedAt: now } });
    for (const userId of new Set(due.map((d) => d.userId))) this.events.emit(NotificationEvents.created, { userId } satisfies NotificationChangedEvent);
    return due.length;
  }

  // ---------------------------------------------------------------- preferences

  async preferences(userId: string): Promise<PreferencesDto> {
    const [pref, mutes] = await Promise.all([
      this.prisma.notificationPreference.findUnique({ where: { userId } }),
      this.prisma.notificationMute.findMany({ where: { userId } }),
    ]);
    const types = resolveTypePreferences(pref?.types);
    const q = this.quietOf(pref ?? undefined);
    return {
      emailMode: pref?.emailMode ?? 'INSTANT',
      quietHours: { enabled: q.enabled, start: formatClock(q.start), end: formatClock(q.end), timezone: q.timezone },
      types: NOTIFICATION_TYPES.map((type) => ({ type, ...types[type] })),
      mutedProjectIds: mutes.map((m) => m.projectId),
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<PreferencesDto> {
    const data: Prisma.NotificationPreferenceUpdateInput = {};
    if (dto.emailMode) data.emailMode = dto.emailMode;
    if (dto.quietHours) {
      const start = parseClock(dto.quietHours.start);
      const end = parseClock(dto.quietHours.end);
      if (start === null || end === null) throw new BadRequestException('Quiet hours must be written as HH:MM');
      if (!isValidTimezone(dto.quietHours.timezone)) throw new BadRequestException('Unknown time zone');
      Object.assign(data, { quietEnabled: dto.quietHours.enabled, quietStart: start, quietEnd: end, timezone: dto.quietHours.timezone });
    }
    if (dto.types) {
      const merged = resolveTypePreferences((await this.prisma.notificationPreference.findUnique({ where: { userId } }))?.types);
      for (const t of dto.types) merged[t.type] = { inApp: t.inApp, email: t.email };
      data.types = merged as unknown as Prisma.InputJsonValue;
    }
    await this.prisma.notificationPreference.upsert({
      where: { userId }, update: data,
      create: { ...(data as Prisma.NotificationPreferenceUncheckedCreateInput), userId },
    });
    if (dto.mutedProjectIds) {
      // Only projects the person can actually see can be muted.
      const memberships = await this.prisma.membership.findMany({ where: { userId } });
      const ids = [...new Set(dto.mutedProjectIds)];
      const visible = await this.prisma.project.findMany({
        where: { id: { in: ids }, OR: memberships.map((m) => ({ workspaceId: m.workspaceId, ...this.projects.visibleProjects(m) })) },
        select: { id: true },
      });
      await this.prisma.$transaction([
        this.prisma.notificationMute.deleteMany({ where: { userId } }),
        this.prisma.notificationMute.createMany({ data: visible.map((p) => ({ userId, projectId: p.id })) }),
      ]);
    }
    return this.preferences(userId);
  }
}
