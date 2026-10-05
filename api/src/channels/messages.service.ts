import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Channel, Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { safeFilename } from '../tasks/attachments.service.js';
import type { TaskRefDto } from '../tasks/dto/task.dto.js';
import { extractMentionedUserIds } from '../tasks/mentions.js';
import { SignedTokens } from '../storage/signed-token.js';
import { DownloadUrlDto, RequestUploadDto, UploadTargetDto } from '../storage/storage.dto.js';
import { StorageService } from '../storage/storage.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import { refInclude, toRefDto } from '../tasks/task-mapper.js';
import { parseTaskRef } from '../tasks/task-ref.js';
import { TasksService } from '../tasks/tasks.service.js';
import { ChannelAccessService, type ChannelAccess } from './channel-access.service.js';
import type {
  CreateTaskFromMessageDto, DiscussionDto, ListMessagesQueryDto, MessageAttachmentDto, MessageDto, MessageListDto,
  PostMessageDto, RepliesQueryDto,
} from './dto/channels.dto.js';
import {
  ChatEvents, type ChatMentionedEvent, type ChatMessageEvent, type ChatMemberEvent, type ChatReadEvent,
} from './events.js';
import { extractTaskKeys, isReactionEmoji, titleFromMessage } from './task-keys.js';

const MAX_REACTIONS_PER_MESSAGE = 20;
const PAGE = 50;

const messageInclude = {
  reactions: { orderBy: { createdAt: 'asc' } },
  attachments: true,
  taskLinks: true,
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChannelAccessService,
    private readonly projects: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly tasks: TasksService,
    private readonly storage: StorageService,
    private readonly tokens: SignedTokens,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------------------------------------------------------------- building DTOs

  /**
   * Turns rows into DTOs. With a viewer, reactions say whether they reacted and linked tasks are
   * resolved to the cards they may see; without one (realtime payloads) those parts are neutral.
   */
  async build(rows: MessageRow[], viewer: Membership | null): Promise<MessageDto[]> {
    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => !!id))];
    const users = authorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    const taskIds = [...new Set(rows.flatMap((r) => r.taskLinks.map((l) => l.taskId)))];
    const cards = new Map<string, TaskRefDto>();
    if (viewer && taskIds.length > 0) {
      const found = await this.prisma.task.findMany({
        where: { id: { in: taskIds }, project: { is: { AND: [{ workspaceId: viewer.workspaceId }, this.projects.visibleProjects(viewer)] } } },
        include: refInclude,
      });
      found.forEach((t) => cards.set(t.id, toRefDto(t)));
    }
    const taskKeysById = new Map<string, string>();
    if (taskIds.length > 0) {
      const found = await this.prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, number: true, project: { select: { key: true } } } });
      found.forEach((t) => taskKeysById.set(t.id, `${t.project.key}-${t.number}`));
    }

    return rows.map((r) => {
      const deleted = r.deletedAt !== null;
      const byEmoji = new Map<string, string[]>();
      for (const x of r.reactions) byEmoji.set(x.emoji, [...(byEmoji.get(x.emoji) ?? []), x.userId]);
      return {
        id: r.id, channelId: r.channelId, seq: r.seq, parentId: r.parentId,
        author: r.authorId ? { userId: r.authorId, name: names.get(r.authorId) ?? 'Unknown' } : null,
        body: deleted ? '' : r.body, deleted, edited: r.editedAt !== null && !deleted,
        createdAt: r.createdAt, editedAt: r.editedAt, replyCount: r.replyCount, lastReplyAt: r.lastReplyAt,
        reactions: deleted ? [] : [...byEmoji].map(([emoji, userIds]) => ({
          emoji, count: userIds.length, userIds, reacted: viewer ? userIds.includes(viewer.userId) : false,
        })),
        attachments: deleted ? [] : r.attachments.map((a): MessageAttachmentDto => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
        taskKeys: deleted ? [] : r.taskLinks.filter((l) => l.source === 'MENTION').map((l) => taskKeysById.get(l.taskId)).filter((k): k is string => !!k),
        tasks: deleted ? [] : r.taskLinks.map((l) => cards.get(l.taskId)).filter((c): c is TaskRefDto => !!c),
      };
    });
  }

  private async one(id: string, viewer: Membership | null): Promise<MessageDto> {
    const row = await this.prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
    return (await this.build([row], viewer))[0];
  }

  private async publish(type: ChatMessageEvent['type'], channel: Pick<Channel, 'id' | 'workspaceId'>, messageId: string) {
    const event: ChatMessageEvent = { type, workspaceId: channel.workspaceId, channelId: channel.id, message: await this.one(messageId, null) };
    this.events.emit(ChatEvents.message, event);
  }

  // ---------------------------------------------------------------- reading

  async list(m: Membership, channelId: string, q: ListMessagesQueryDto): Promise<MessageListDto> {
    await this.access.load(m, channelId);
    const limit = q.limit ?? PAGE;
    const base: Prisma.MessageWhereInput = { channelId, ...(q.threads ? {} : { parentId: null }) };
    let rows: MessageRow[];
    let hasMore: boolean;
    if (q.after !== undefined) {
      rows = await this.prisma.message.findMany({
        where: { ...base, seq: { gt: q.after } }, orderBy: { seq: 'asc' }, take: limit + 1, include: messageInclude,
      });
      hasMore = rows.length > limit;
      rows = rows.slice(0, limit);
    } else {
      rows = await this.prisma.message.findMany({
        where: { ...base, ...(q.before !== undefined ? { seq: { lt: q.before } } : {}) },
        orderBy: { seq: 'desc' }, take: limit + 1, include: messageInclude,
      });
      hasMore = rows.length > limit;
      rows = rows.slice(0, limit).reverse();
    }
    return { messages: await this.build(rows, m), hasMore };
  }

  private async loadMessage(access: ChannelAccess, messageId: string): Promise<MessageRow> {
    const row = await this.prisma.message.findFirst({ where: { id: messageId, channelId: access.channel.id }, include: messageInclude });
    if (!row) throw new NotFoundException('Message not found');
    return row;
  }

  async get(m: Membership, channelId: string, messageId: string): Promise<MessageDto> {
    const access = await this.access.load(m, channelId);
    return (await this.build([await this.loadMessage(access, messageId)], m))[0];
  }

  async replies(m: Membership, channelId: string, messageId: string, q: RepliesQueryDto): Promise<MessageListDto> {
    const access = await this.access.load(m, channelId);
    await this.loadMessage(access, messageId);
    const limit = q.limit ?? 100;
    const rows = await this.prisma.message.findMany({
      where: { channelId, parentId: messageId, seq: { gt: q.after ?? 0 } }, orderBy: { seq: 'asc' }, take: limit + 1, include: messageInclude,
    });
    return { messages: await this.build(rows.slice(0, limit), m), hasMore: rows.length > limit };
  }

  // ---------------------------------------------------------------- task links

  /** Tasks (by key) in this workspace that `m` can see. */
  private async resolveKeys(m: Membership, keys: string[]) {
    if (keys.length === 0) return [];
    const parsed = keys.map((k) => parseTaskRef(k)).filter((p) => p.kind === 'key');
    if (parsed.length === 0) return [];
    return this.prisma.task.findMany({
      where: {
        OR: parsed.map((p) => ({ number: p.number, project: { key: p.projectKey } })),
        project: { is: { AND: [{ workspaceId: m.workspaceId }, this.projects.visibleProjects(m)] } },
      },
      select: { id: true },
    });
  }

  async taskRefs(m: Membership, keysCsv: string): Promise<TaskRefDto[]> {
    const keys = [...new Set(keysCsv.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
    const parsed = keys.map((k) => parseTaskRef(k)).filter((p) => p.kind === 'key');
    if (parsed.length === 0) return [];
    const rows = await this.prisma.task.findMany({
      where: {
        OR: parsed.map((p) => ({ number: p.number, project: { key: p.projectKey } })),
        project: { is: { AND: [{ workspaceId: m.workspaceId }, this.projects.visibleProjects(m)] } },
      },
      include: refInclude,
    });
    return rows.map(toRefDto);
  }

  // ---------------------------------------------------------------- posting

  private mentionEvent(channel: Channel, messageId: string, actorId: string, ids: string[]) {
    if (ids.length === 0) return;
    const e: ChatMentionedEvent = { workspaceId: channel.workspaceId, channelId: channel.id, messageId, actorId, mentionedUserIds: ids };
    this.events.emit(ChatEvents.mentioned, e);
  }

  async post(m: Membership, channelId: string, dto: PostMessageDto): Promise<MessageDto> {
    const { channel } = await this.access.loadForPosting(m, channelId);
    const body = dto.body.trim();
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
    if (!body && attachmentIds.length === 0) throw new BadRequestException('Write a message or attach a file');

    if (dto.parentId) {
      const parent = await this.prisma.message.findFirst({ where: { id: dto.parentId, channelId } });
      if (!parent || parent.deletedAt) throw new NotFoundException('The message you are replying to no longer exists');
      if (parent.parentId) throw new BadRequestException('Threads are one level deep: reply to the first message');
    }

    const mentioned = (await this.access.viewerIds(channel, extractMentionedUserIds(body))).filter((id) => id !== m.userId);
    const linkedTasks = await this.resolveKeys(m, extractTaskKeys(body));

    const { id, joined } = await this.prisma.$transaction(async (tx) => {
      // Incrementing the counter takes a row lock, which serialises posts and makes `seq` gap-free.
      const { lastSeq } = await tx.channel.update({
        where: { id: channelId }, data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() }, select: { lastSeq: true },
      });
      const message = await tx.message.create({
        data: {
          channelId, seq: lastSeq, authorId: m.userId, body, parentId: dto.parentId ?? null,
          mentions: { create: mentioned.map((userId) => ({ userId })) },
          taskLinks: { create: linkedTasks.map((t) => ({ taskId: t.id, source: 'MENTION' as const })) },
        },
      });
      if (attachmentIds.length > 0) {
        const res = await tx.messageAttachment.updateMany({
          where: { id: { in: attachmentIds }, channelId, uploaderId: m.userId, messageId: null }, data: { messageId: message.id },
        });
        if (res.count !== attachmentIds.length) throw new BadRequestException('One of the attached files is missing or already used');
      }
      if (dto.parentId) {
        await tx.message.update({ where: { id: dto.parentId }, data: { replyCount: { increment: 1 }, lastReplyAt: message.createdAt } });
      }
      // Posting follows the channel and marks it read up to this message.
      const existing = await tx.channelMember.findUnique({ where: { channelId_userId: { channelId, userId: m.userId } } });
      if (existing) {
        await tx.channelMember.update({ where: { channelId_userId: { channelId, userId: m.userId } }, data: { lastReadSeq: lastSeq } });
      } else if (channel.type !== 'DIRECT') {
        await tx.channelMember.create({ data: { channelId, userId: m.userId, lastReadSeq: lastSeq } });
      }
      return { id: message.id, joined: !existing && channel.type !== 'DIRECT' };
    });

    if (joined) {
      const e: ChatMemberEvent = { type: 'added', workspaceId: m.workspaceId, channelId, userId: m.userId };
      this.events.emit(ChatEvents.member, e);
    }
    await this.publish('created', channel, id);
    if (dto.parentId) await this.publish('updated', channel, dto.parentId);
    this.mentionEvent(channel, id, m.userId, mentioned);
    return this.one(id, m);
  }

  // ---------------------------------------------------------------- editing

  async edit(m: Membership, channelId: string, messageId: string, bodyInput: string): Promise<MessageDto> {
    const access = await this.access.loadForPosting(m, channelId);
    const message = await this.loadMessage(access, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
    if (message.authorId !== m.userId) throw new ForbiddenException('You can only edit your own messages');
    const body = bodyInput.trim();
    if (!body) throw new BadRequestException('A message cannot be empty; delete it instead');
    if (body === message.body) return (await this.build([message], m))[0];

    const previous = new Set((await this.prisma.messageMention.findMany({ where: { messageId } })).map((r) => r.userId));
    const mentioned = (await this.access.viewerIds(access.channel, extractMentionedUserIds(body))).filter((id) => id !== m.userId);
    const linked = await this.resolveKeys(m, extractTaskKeys(body));

    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
      await tx.messageMention.deleteMany({ where: { messageId } });
      await tx.messageMention.createMany({ data: mentioned.map((userId) => ({ messageId, userId })) });
      // Keep links made by hand; only the ones written in the text follow the text.
      await tx.messageTaskLink.deleteMany({ where: { messageId, source: 'MENTION' } });
      await tx.messageTaskLink.createMany({
        data: linked.map((t) => ({ messageId, taskId: t.id, source: 'MENTION' as const })), skipDuplicates: true,
      });
    });
    await this.publish('updated', access.channel, messageId);
    this.mentionEvent(access.channel, messageId, m.userId, mentioned.filter((id) => !previous.has(id)));
    return this.one(messageId, m);
  }

  async remove(m: Membership, channelId: string, messageId: string) {
    const access = await this.access.load(m, channelId);
    const message = await this.loadMessage(access, messageId);
    if (message.deletedAt) return;
    if (message.authorId !== m.userId && !access.isAdmin) throw new ForbiddenException('Only the author or a channel admin can delete this message');
    if (access.channel.archivedAt) throw new ForbiddenException('This channel is archived');
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({ where: { id: messageId }, data: { body: '', deletedAt: new Date() } });
      await tx.messageMention.deleteMany({ where: { messageId } });
      await tx.reaction.deleteMany({ where: { messageId } });
      await tx.messageTaskLink.deleteMany({ where: { messageId } });
      await tx.messageAttachment.deleteMany({ where: { messageId } });
    });
    for (const a of message.attachments) await this.storage.delete(a.storageKey).catch(() => undefined);
    await this.publish('deleted', access.channel, messageId);
  }

  // ---------------------------------------------------------------- reactions

  async react(m: Membership, channelId: string, messageId: string, emoji: string): Promise<MessageDto> {
    if (!isReactionEmoji(emoji)) throw new BadRequestException('Reactions must be emoji');
    const access = await this.access.loadForPosting(m, channelId);
    const message = await this.loadMessage(access, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
    const distinct = new Set(message.reactions.map((r) => r.emoji));
    if (!distinct.has(emoji) && distinct.size >= MAX_REACTIONS_PER_MESSAGE) throw new ConflictException('This message has too many different reactions');
    await this.prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: m.userId, emoji } }, create: { messageId, userId: m.userId, emoji }, update: {},
    });
    await this.publish('reactions', access.channel, messageId);
    return this.one(messageId, m);
  }

  async unreact(m: Membership, channelId: string, messageId: string, emoji: string): Promise<MessageDto> {
    const access = await this.access.load(m, channelId);
    await this.loadMessage(access, messageId);
    const res = await this.prisma.reaction.deleteMany({ where: { messageId, userId: m.userId, emoji } });
    if (res.count > 0) await this.publish('reactions', access.channel, messageId);
    return this.one(messageId, m);
  }

  // ---------------------------------------------------------------- read state

  async markRead(m: Membership, channelId: string, seq?: number) {
    const { channel, member } = await this.access.load(m, channelId);
    if (!member) return { lastReadSeq: channel.lastSeq };
    const target = Math.min(seq ?? channel.lastSeq, channel.lastSeq);
    // Never moves backwards, so a stale tab cannot mark things unread again.
    await this.prisma.channelMember.updateMany({
      where: { channelId, userId: m.userId, lastReadSeq: { lt: target } }, data: { lastReadSeq: target },
    });
    const fresh = await this.prisma.channelMember.findUniqueOrThrow({ where: { channelId_userId: { channelId, userId: m.userId } } });
    const e: ChatReadEvent = { userId: m.userId, channelId, seq: fresh.lastReadSeq };
    this.events.emit(ChatEvents.read, e);
    return { lastReadSeq: fresh.lastReadSeq };
  }

  // ---------------------------------------------------------------- tasks

  async linkTask(m: Membership, channelId: string, messageId: string, taskRef: string): Promise<MessageDto> {
    const access = await this.access.loadForPosting(m, channelId);
    const message = await this.loadMessage(access, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
    const { task } = await this.taskAccess.load(m, taskRef);
    await this.prisma.messageTaskLink.upsert({
      where: { messageId_taskId: { messageId, taskId: task.id } },
      create: { messageId, taskId: task.id, source: 'LINKED' }, update: {},
    });
    await this.publish('updated', access.channel, messageId);
    return this.one(messageId, m);
  }

  async unlinkTask(m: Membership, channelId: string, messageId: string, taskRef: string): Promise<MessageDto> {
    const access = await this.access.loadForPosting(m, channelId);
    await this.loadMessage(access, messageId);
    const { task } = await this.taskAccess.load(m, taskRef);
    await this.prisma.messageTaskLink.deleteMany({ where: { messageId, taskId: task.id, source: { in: ['LINKED', 'CREATED'] } } });
    await this.publish('updated', access.channel, messageId);
    return this.one(messageId, m);
  }

  async createTask(m: Membership, channelId: string, messageId: string, dto: CreateTaskFromMessageDto): Promise<MessageDto> {
    const access = await this.access.load(m, channelId);
    const message = await this.loadMessage(access, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
    const title = dto.title?.trim() || titleFromMessage(message.body);
    // `tasks.create` enforces that the caller may write to the project.
    const task = await this.tasks.create(m, dto.projectId, { title, description: message.body });
    await this.prisma.messageTaskLink.upsert({
      where: { messageId_taskId: { messageId, taskId: task.id } },
      create: { messageId, taskId: task.id, source: 'CREATED' }, update: { source: 'CREATED' },
    });
    await this.publish('updated', access.channel, messageId);
    return this.one(messageId, m);
  }

  /** Conversations that mention or were linked to a task, limited to channels the caller can see. */
  async discussions(m: Membership, taskRef: string): Promise<DiscussionDto[]> {
    const { task } = await this.taskAccess.load(m, taskRef);
    const links = await this.prisma.messageTaskLink.findMany({
      where: {
        taskId: task.id, message: { deletedAt: null, channel: { is: this.access.visibleWhere(m) } },
      },
      orderBy: { message: { createdAt: 'desc' } }, take: 50,
      include: { message: { include: { ...messageInclude, channel: { select: { id: true, name: true, type: true } } } } },
    });
    const dtos = await this.build(links.map((l) => l.message), m);
    return links.map((l, i) => ({ message: dtos[i], channel: l.message.channel, source: l.source }));
  }

  // ---------------------------------------------------------------- files

  async requestUpload(m: Membership, channelId: string, dto: RequestUploadDto): Promise<UploadTargetDto> {
    await this.access.loadForPosting(m, channelId);
    const maxMb = this.config.get('MAX_UPLOAD_MB');
    if (dto.size > maxMb * 1024 * 1024) throw new PayloadTooLargeException(`Files can be at most ${maxMb} MB`);
    const filename = safeFilename(dto.filename);
    const key = `${m.workspaceId}/chat/${channelId}/${randomUUID()}`;
    const target = await this.storage.presignUpload(key, dto.size);
    const mimeType = dto.mimeType?.trim() || 'application/octet-stream';
    const uploadToken = this.tokens.sign({ kind: 'chat', key, filename, mimeType, size: dto.size, channel: channelId, user: m.userId }, 15 * 60);
    return { uploadUrl: target.url, method: target.method, headers: target.headers, expiresAt: target.expiresAt, uploadToken };
  }

  async confirmUpload(m: Membership, channelId: string, uploadToken: string): Promise<MessageAttachmentDto> {
    await this.access.loadForPosting(m, channelId);
    const c = this.tokens.verify<{ kind: string; key: string; filename: string; mimeType: string; size: number; channel: string; user: string }>(uploadToken);
    if (c.kind !== 'chat' || c.channel !== channelId || c.user !== m.userId) throw new BadRequestException('This upload does not belong to this channel');
    const toDto = (a: { id: string; filename: string; mimeType: string; size: number }): MessageAttachmentDto => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size });
    const existing = await this.prisma.messageAttachment.findFirst({ where: { storageKey: c.key } });
    if (existing) return toDto(existing);
    const stored = await this.storage.head(c.key);
    if (!stored) throw new BadRequestException('The file was not uploaded');
    if (stored.size !== c.size) {
      await this.storage.delete(c.key).catch(() => undefined);
      throw new BadRequestException('The uploaded file does not match the size that was announced');
    }
    const a = await this.prisma.messageAttachment.create({
      data: { channelId, uploaderId: m.userId, filename: c.filename, storageKey: c.key, mimeType: c.mimeType, size: c.size },
    });
    return toDto(a);
  }

  async downloadUrl(m: Membership, channelId: string, attachmentId: string): Promise<DownloadUrlDto> {
    await this.access.load(m, channelId);
    const a = await this.prisma.messageAttachment.findFirst({ where: { id: attachmentId, channelId } });
    // A file that has not been sent yet is only visible to the person who uploaded it.
    if (!a || (!a.messageId && a.uploaderId !== m.userId)) throw new NotFoundException('Attachment not found');
    return this.storage.presignDownload(a.storageKey, a.filename);
  }

  /** Files uploaded but never sent are removed after a day. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgePendingUploads() {
    const stale = await this.prisma.messageAttachment.findMany({
      where: { messageId: null, createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } }, take: 500,
    });
    for (const a of stale) {
      await this.storage.delete(a.storageKey).catch(() => undefined);
      await this.prisma.messageAttachment.delete({ where: { id: a.id } }).catch(() => undefined);
    }
    if (stale.length > 0) this.logger.log(`Removed ${stale.length} unsent chat uploads`);
  }
}
