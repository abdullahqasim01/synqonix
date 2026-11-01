import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '../generated/prisma/client.js';
import type { Channel, Membership, Project } from '../generated/prisma/client.js';
import { slugify } from '../common/slug.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChannelAccessService } from './channel-access.service.js';
import type {
  ChannelDto, ChannelMemberDto, CreateChannelDto, UpdateChannelDto,
} from './dto/channels.dto.js';
import {
  ChatEvents, ProjectEvents, type ChatAccessChangedEvent, WorkspaceEvents, type ChatChannelsChangedEvent, type ChatMemberEvent,
  type ProjectCreatedEvent, type ProjectMemberChangedEvent, type ProjectUpdatedEvent, type WorkspaceMemberRemovedEvent,
} from './events.js';

const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async uniqueSlug(workspaceId: string, name: string): Promise<string> {
    const base = slugify(name);
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      if (!(await this.prisma.channel.findUnique({ where: { workspaceId_slug: { workspaceId, slug } } }))) return slug;
    }
    throw new ConflictException('Could not find a free name for this channel');
  }

  private async assertWorkspaceMembers(workspaceId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    const count = await this.prisma.membership.count({ where: { workspaceId, userId: { in: ids } } });
    if (count !== ids.length) throw new BadRequestException('Everyone must be a member of this workspace');
    return ids;
  }

  private changed(workspaceId: string, userIds?: string[]) {
    const e: ChatChannelsChangedEvent = { workspaceId, userIds };
    this.events.emit(ChatEvents.channelsChanged, e);
  }

  private memberEvent(type: ChatMemberEvent['type'], workspaceId: string, channelId: string, userId: string) {
    const e: ChatMemberEvent = { type, workspaceId, channelId, userId };
    this.events.emit(ChatEvents.member, e);
  }

  /** Ids of every channel the user follows (for joining realtime rooms). */
  async memberChannelIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.channelMember.findMany({ where: { userId }, select: { channelId: true } });
    return rows.map((r) => r.channelId);
  }

  // ---------------------------------------------------------------- listing

  /** Unread and mention counts for the channels the user follows, in one query each. */
  private async counters(userId: string, channelIds: string[]) {
    const unread = new Map<string, number>();
    const mentions = new Map<string, number>();
    if (channelIds.length === 0) return { unread, mentions };
    const unreadRows = await this.prisma.$queryRaw<{ channelId: string; n: number }[]>(Prisma.sql`
      SELECT m."channelId", COUNT(*)::int AS n
      FROM "Message" m
      JOIN "ChannelMember" cm ON cm."channelId" = m."channelId" AND cm."userId" = ${userId}
      WHERE m."channelId" = ANY(${channelIds}::text[])
        AND m."seq" > cm."lastReadSeq" AND m."parentId" IS NULL AND m."deletedAt" IS NULL
        AND m."authorId" IS DISTINCT FROM ${userId}
      GROUP BY m."channelId"`);
    const mentionRows = await this.prisma.$queryRaw<{ channelId: string; n: number }[]>(Prisma.sql`
      SELECT m."channelId", COUNT(*)::int AS n
      FROM "MessageMention" mm
      JOIN "Message" m ON m."id" = mm."messageId"
      JOIN "ChannelMember" cm ON cm."channelId" = m."channelId" AND cm."userId" = ${userId}
      WHERE mm."userId" = ${userId} AND m."channelId" = ANY(${channelIds}::text[])
        AND m."seq" > cm."lastReadSeq" AND m."deletedAt" IS NULL AND m."authorId" IS DISTINCT FROM ${userId}
      GROUP BY m."channelId"`);
    unreadRows.forEach((r) => unread.set(r.channelId, r.n));
    mentionRows.forEach((r) => mentions.set(r.channelId, r.n));
    return { unread, mentions };
  }

  private async toDtos(m: Membership, channels: (Channel & { project: Project | null })[]): Promise<ChannelDto[]> {
    const ids = channels.map((c) => c.id);
    const [members, mine] = await Promise.all([
      this.prisma.channelMember.findMany({ where: { channelId: { in: ids } }, include: { user: { select: { id: true, name: true } } } }),
      this.prisma.channelMember.findMany({ where: { userId: m.userId, channelId: { in: ids } } }),
    ]);
    const myRows = new Map(mine.map((r) => [r.channelId, r]));
    const { unread, mentions } = await this.counters(m.userId, mine.map((r) => r.channelId));
    const out: ChannelDto[] = [];
    for (const c of channels) {
      const access = await this.access.describe(m, c);
      const people = members.filter((x) => x.channelId === c.id);
      out.push({
        id: c.id, type: c.type, name: c.name, topic: c.topic, projectId: c.projectId, archived: c.archivedAt !== null,
        memberCount: people.length, isMember: myRows.has(c.id), isAdmin: access.isAdmin, canPost: access.canPost,
        unreadCount: unread.get(c.id) ?? 0, mentionCount: mentions.get(c.id) ?? 0,
        lastSeq: c.lastSeq, lastReadSeq: myRows.get(c.id)?.lastReadSeq ?? c.lastSeq, lastMessageAt: c.lastMessageAt,
        participants: c.type === 'DIRECT' ? people.map((x) => ({ userId: x.userId, name: x.user.name })) : [],
      });
    }
    return out;
  }

  async list(m: Membership, includeArchived = false): Promise<ChannelDto[]> {
    const channels = await this.prisma.channel.findMany({
      where: { AND: [this.access.visibleWhere(m), includeArchived ? {} : { archivedAt: null }] },
      include: { project: true },
    });
    const dtos = await this.toDtos(m, channels);
    const rank = { PUBLIC: 1, PRIVATE: 1, DIRECT: 2 } as const;
    return dtos.sort((a, b) => {
      if (a.type !== b.type && (a.type === 'DIRECT' || b.type === 'DIRECT')) return rank[a.type] - rank[b.type];
      if (a.type === 'DIRECT') return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  }

  async get(m: Membership, channelId: string): Promise<ChannelDto> {
    const { channel } = await this.access.load(m, channelId);
    return (await this.toDtos(m, [channel]))[0];
  }

  // ---------------------------------------------------------------- creating

  async create(m: Membership, dto: CreateChannelDto): Promise<ChannelDto> {
    if (m.role === 'VIEWER') throw new BadRequestException('Viewers cannot create channels');
    const memberIds = await this.assertWorkspaceMembers(m.workspaceId, [m.userId, ...(dto.memberIds ?? [])]);
    const slug = await this.uniqueSlug(m.workspaceId, dto.name);
    const channel = await this.prisma.channel.create({
      data: {
        workspaceId: m.workspaceId, type: dto.type, name: dto.name.trim(), slug, topic: dto.topic?.trim() || null, createdById: m.userId,
        members: { create: memberIds.map((userId) => ({ userId, role: userId === m.userId ? ('ADMIN' as const) : ('MEMBER' as const) })) },
      },
      include: { project: true },
    });
    this.changed(m.workspaceId, dto.type === 'PRIVATE' ? memberIds : undefined);
    for (const userId of memberIds) this.memberEvent('added', m.workspaceId, channel.id, userId);
    return (await this.toDtos(m, [channel]))[0];
  }

  /** Finds or creates the conversation between the caller and `userIds`. */
  async direct(m: Membership, userIds: string[]): Promise<ChannelDto> {
    const others = [...new Set(userIds)].filter((id) => id !== m.userId);
    if (others.length === 0) throw new BadRequestException('Choose at least one other person');
    const everyone = await this.assertWorkspaceMembers(m.workspaceId, [m.userId, ...others]);
    const dmKey = [...everyone].sort().join('+');
    let channel = await this.prisma.channel.findUnique({ where: { workspaceId_dmKey: { workspaceId: m.workspaceId, dmKey } }, include: { project: true } });
    if (!channel) {
      try {
        channel = await this.prisma.channel.create({
          data: {
            workspaceId: m.workspaceId, type: 'DIRECT', dmKey, createdById: m.userId,
            members: { create: everyone.map((userId) => ({ userId })) },
          },
          include: { project: true },
        });
        this.changed(m.workspaceId, everyone);
        for (const userId of everyone) this.memberEvent('added', m.workspaceId, channel.id, userId);
      } catch (e) {
        if (!isUnique(e)) throw e; // someone created it at the same moment
        channel = await this.prisma.channel.findUniqueOrThrow({ where: { workspaceId_dmKey: { workspaceId: m.workspaceId, dmKey } }, include: { project: true } });
      }
    }
    return (await this.toDtos(m, [channel]))[0];
  }

  // ---------------------------------------------------------------- updating

  async update(m: Membership, channelId: string, dto: UpdateChannelDto): Promise<ChannelDto> {
    const { channel } = await this.access.loadForAdmin(m, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Direct messages cannot be changed');
    if (channel.projectId && dto.name !== undefined) throw new BadRequestException("A project channel is named after its project");
    let slug: string | undefined;
    if (dto.name !== undefined && dto.name.trim() !== channel.name) slug = await this.uniqueSlug(m.workspaceId, dto.name);
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim(), ...(slug ? { slug } : {}) }),
        ...(dto.topic !== undefined && { topic: dto.topic?.trim() || null }),
        ...(dto.archived !== undefined && { archivedAt: dto.archived ? new Date() : null }),
      },
      include: { project: true },
    });
    this.changed(m.workspaceId, channel.type === 'PRIVATE' ? await this.memberIds(channelId) : undefined);
    return (await this.toDtos(m, [updated]))[0];
  }

  private async memberIds(channelId: string) {
    return (await this.prisma.channelMember.findMany({ where: { channelId }, select: { userId: true } })).map((r) => r.userId);
  }

  // ---------------------------------------------------------------- membership

  async members(m: Membership, channelId: string): Promise<ChannelMemberDto[]> {
    const { channel } = await this.access.load(m, channelId);
    const rows = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id }, include: { user: true }, orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email, role: r.role }));
  }

  /** Follow a channel you can see (public and project channels). */
  async join(m: Membership, channelId: string): Promise<ChannelDto> {
    const { channel, member } = await this.access.load(m, channelId);
    if (channel.type === 'DIRECT' || (channel.type === 'PRIVATE' && !channel.projectId && !member)) {
      throw new NotFoundException('Channel not found');
    }
    if (!member) {
      await this.prisma.channelMember.create({
        data: { channelId, userId: m.userId, lastReadSeq: channel.lastSeq },
      });
      this.memberEvent('added', m.workspaceId, channelId, m.userId);
      this.changed(m.workspaceId, [m.userId]);
    }
    return this.get(m, channelId);
  }

  async leave(m: Membership, channelId: string) {
    const { channel, member } = await this.access.load(m, channelId);
    if (!member) return;
    if (channel.type === 'DIRECT') throw new BadRequestException('You cannot leave a direct message');
    if (member.role === 'ADMIN' && !channel.projectId) {
      const otherAdmins = await this.prisma.channelMember.count({ where: { channelId, role: 'ADMIN', userId: { not: m.userId } } });
      if (otherAdmins === 0 && channel.type === 'PRIVATE') {
        const others = await this.prisma.channelMember.count({ where: { channelId, userId: { not: m.userId } } });
        if (others > 0) throw new BadRequestException('Make someone else an admin before leaving');
      }
    }
    await this.prisma.channelMember.delete({ where: { channelId_userId: { channelId, userId: m.userId } } });
    this.memberEvent('removed', m.workspaceId, channelId, m.userId);
    this.changed(m.workspaceId, [m.userId]);
  }

  async addMember(m: Membership, channelId: string, userId: string): Promise<ChannelMemberDto[]> {
    const { channel } = await this.access.loadForAdmin(m, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Start a new conversation to include more people');
    await this.assertWorkspaceMembers(m.workspaceId, [userId]);
    if (channel.projectId) {
      // Project channels follow the project: only people who can see it can join.
      if ((await this.access.viewerIds(channel, [userId])).length === 0) throw new BadRequestException('That person cannot access this project');
    }
    await this.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadSeq: channel.lastSeq }, update: {},
    });
    this.memberEvent('added', m.workspaceId, channelId, userId);
    this.changed(m.workspaceId, [userId]);
    return this.members(m, channelId);
  }

  async removeMember(m: Membership, channelId: string, userId: string) {
    const { channel } = await this.access.loadForAdmin(m, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('You cannot remove people from a direct message');
    const res = await this.prisma.channelMember.deleteMany({ where: { channelId, userId } });
    if (res.count === 0) throw new NotFoundException('Member not found');
    this.memberEvent('removed', m.workspaceId, channelId, userId);
    this.changed(m.workspaceId, [userId]);
  }

  // ---------------------------------------------------------------- project channels

  @OnEvent(ProjectEvents.created)
  async onProjectCreated(e: ProjectCreatedEvent) {
    const slug = await this.uniqueSlug(e.workspaceId, e.key.toLowerCase());
    const channel = await this.prisma.channel.create({
      data: {
        workspaceId: e.workspaceId, projectId: e.projectId, type: e.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        name: e.key.toLowerCase(), slug,
        members: { create: e.memberIds.map((userId) => ({ userId, role: 'ADMIN' as const })) },
      },
    });
    for (const userId of e.memberIds) this.memberEvent('added', e.workspaceId, channel.id, userId);
    this.changed(e.workspaceId, e.visibility === 'PRIVATE' ? e.memberIds : undefined);
  }

  @OnEvent(ProjectEvents.updated)
  async onProjectUpdated(e: ProjectUpdatedEvent) {
    const channel = await this.prisma.channel.findUnique({ where: { projectId: e.projectId } });
    if (!channel) return;
    const type = e.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
    if (channel.type === type) return;
    await this.prisma.channel.update({ where: { id: channel.id }, data: { type } });
    if (type === 'PRIVATE') await this.dropUnauthorizedMembers(channel.id, e.projectId, e.workspaceId);
    const access: ChatAccessChangedEvent = { channelId: channel.id };
    this.events.emit(ChatEvents.accessChanged, access);
    this.changed(e.workspaceId);
  }

  /** When a project becomes private, followers who can no longer see it stop following its channel. */
  private async dropUnauthorizedMembers(channelId: string, projectId: string, workspaceId: string) {
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { project: true } });
    const members = await this.prisma.channelMember.findMany({ where: { channelId } });
    const allowed = new Set(await this.access.viewerIds(channel, members.map((x) => x.userId)));
    for (const x of members.filter((r) => !allowed.has(r.userId))) {
      await this.prisma.channelMember.delete({ where: { channelId_userId: { channelId, userId: x.userId } } });
      this.memberEvent('removed', workspaceId, channelId, x.userId);
    }
    void projectId;
  }

  @OnEvent(ProjectEvents.memberChanged)
  async onProjectMemberChanged(e: ProjectMemberChangedEvent) {
    const channel = await this.prisma.channel.findUnique({ where: { projectId: e.projectId } });
    if (!channel) return;
    if (e.role === null) {
      // Removed from the project: stop following a channel they can no longer see.
      const stillSees = await this.access.viewerIds(channel, [e.userId]);
      if (stillSees.length === 0) {
        const res = await this.prisma.channelMember.deleteMany({ where: { channelId: channel.id, userId: e.userId } });
        if (res.count > 0) this.memberEvent('removed', e.workspaceId, channel.id, e.userId);
      }
      const access: ChatAccessChangedEvent = { channelId: channel.id };
      this.events.emit(ChatEvents.accessChanged, access);
      this.changed(e.workspaceId, [e.userId]);
      return;
    }
    await this.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: e.userId } },
      create: { channelId: channel.id, userId: e.userId, role: e.role === 'ADMIN' ? 'ADMIN' : 'MEMBER', lastReadSeq: channel.lastSeq },
      update: { role: e.role === 'ADMIN' ? 'ADMIN' : 'MEMBER' },
    });
    this.memberEvent('added', e.workspaceId, channel.id, e.userId);
    this.changed(e.workspaceId, [e.userId]);
  }

  @OnEvent(WorkspaceEvents.memberRemoved)
  async onWorkspaceMemberRemoved(e: WorkspaceMemberRemovedEvent) {
    const rows = await this.prisma.channelMember.findMany({ where: { userId: e.userId, channel: { workspaceId: e.workspaceId } } });
    await this.prisma.channelMember.deleteMany({ where: { userId: e.userId, channel: { workspaceId: e.workspaceId } } });
    for (const r of rows) this.memberEvent('removed', e.workspaceId, r.channelId, e.userId);
  }
}
