import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthTokenService, type Authenticated } from '../auth/auth-token.service.js';
import { ChannelAccessService } from '../channels/channel-access.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import {
  ChatEvents, type ChatAccessChangedEvent, type ChatChannelsChangedEvent, type ChatMemberEvent, type ChatMessageEvent, type ChatReadEvent,
} from '../channels/events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import {
  TaskEvents, type TaskEventBase, type TaskMovedEvent, type TaskRankedEvent,
} from '../tasks/events.js';

export type RealtimeTaskEvent = {
  type: 'created' | 'updated' | 'deleted' | 'ranked' | 'moved_out' | 'commented';
  taskId: string;
  taskKey: string;
  projectId: string;
  actorId: string;
  fields?: string[];
  statusId?: string;
};

export const projectRoom = (projectId: string) => `project:${projectId}`;
export const channelRoom = (channelId: string) => `channel:${channelId}`;
export const userRoom = (userId: string) => `user:${userId}`;
export const presenceRoom = (workspaceId: string) => `presence:${workspaceId}`;

interface SocketData {
  user?: Authenticated;
  timer?: NodeJS.Timeout;
  /** Workspaces this socket reported presence in. */
  presence?: Set<string>;
  lastTyping?: Map<string, number>;
}

const TYPING_INTERVAL_MS = 1500;

/**
 * Pushes task changes to clients watching a project, so boards update live.
 * Clients authenticate with `auth: { token }` (session JWT or API token), then send
 * `subscribe` with `{ projectId }`; they receive `task` events for that room. Events carry
 * only identifiers: clients refetch what they display, so no data leaks past the HTTP rules.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly tokens: AuthTokenService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly channels: ChannelsService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /** workspaceId -> userId -> number of sockets reporting presence. */
  private readonly online = new Map<string, Map<string, number>>();

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string' || !token) throw new Error('missing token');
        const user = await this.tokens.authenticate(token);
        const data = socket.data as SocketData;
        data.user = user;
        // Access tokens are short-lived: drop the socket when this one expires; the client
        // reconnects with a fresh token.
        if (user.expiresAt) {
          data.timer = setTimeout(() => socket.disconnect(true), Math.max(0, user.expiresAt - Date.now()));
          socket.on('disconnect', () => clearTimeout(data.timer));
        }
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { projectId?: unknown }) {
    const user = (client.data as SocketData).user;
    if (!user || typeof body?.projectId !== 'string') return { ok: false, error: 'bad_request' };
    const project = await this.prisma.project.findUnique({ where: { id: body.projectId } });
    const membership = project
      ? await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: user.id } } })
      : null;
    if (!project || !membership) return { ok: false, error: 'not_found' };
    try {
      await this.projects.check(membership, project);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    await client.join(projectRoom(project.id));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { projectId?: unknown }) {
    if (typeof body?.projectId === 'string') await client.leave(projectRoom(body.projectId));
    return { ok: true };
  }

  private publish(projectId: string, e: TaskEventBase, type: RealtimeTaskEvent['type'], extra: Partial<RealtimeTaskEvent> = {}) {
    const payload: RealtimeTaskEvent = { type, taskId: e.taskId, taskKey: e.taskKey, projectId, actorId: e.actorId, ...extra };
    this.server?.to(projectRoom(projectId)).emit('task', payload);
  }

  @OnEvent(TaskEvents.created) onCreated(e: TaskEventBase) { this.publish(e.projectId, e, 'created'); }
  @OnEvent(TaskEvents.updated) onUpdated(e: TaskEventBase & { fields: string[] }) { this.publish(e.projectId, e, 'updated', { fields: e.fields }); }
  @OnEvent(TaskEvents.deleted) onDeleted(e: TaskEventBase) { this.publish(e.projectId, e, 'deleted'); }
  @OnEvent(TaskEvents.commented) onCommented(e: TaskEventBase) { this.publish(e.projectId, e, 'commented'); }
  @OnEvent(TaskEvents.ranked) onRanked(e: TaskRankedEvent) { this.publish(e.projectId, e, 'ranked', { statusId: e.statusId }); }
  @OnEvent(TaskEvents.moved) onMoved(e: TaskMovedEvent) {
    // The destination already hears about it through `updated`; tell the old project it left.
    this.publish(e.fromProjectId, e, 'moved_out');
  }

  // ---------------------------------------------------------------- chat

  /** A connected user hears about every channel they follow and about their own read state. */
  async handleConnection(client: Socket) {
    const user = (client.data as SocketData).user;
    if (!user) return;
    await client.join(userRoom(user.id));
    const channelIds = await this.channels.memberChannelIds(user.id);
    await client.join(channelIds.map(channelRoom));
  }

  handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    for (const workspaceId of data.presence ?? []) this.leavePresence(workspaceId, data.user!.id);
    data.presence?.clear();
  }

  /** Starts receiving a channel you can see but do not follow (followed channels join automatically). */
  @SubscribeMessage('channel:subscribe')
  async subscribeChannel(@ConnectedSocket() client: Socket, @MessageBody() body: { workspaceId?: unknown; channelId?: unknown }) {
    const user = (client.data as SocketData).user;
    if (!user || typeof body?.workspaceId !== 'string' || typeof body?.channelId !== 'string') return { ok: false, error: 'bad_request' };
    const membership = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: body.workspaceId, userId: user.id } } });
    if (!membership) return { ok: false, error: 'not_found' };
    try {
      await this.channelAccess.load(membership, body.channelId);
    } catch {
      return { ok: false, error: 'not_found' };
    }
    await client.join(channelRoom(body.channelId));
    return { ok: true };
  }

  @SubscribeMessage('channel:unsubscribe')
  async unsubscribeChannel(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId?: unknown }) {
    const user = (client.data as SocketData).user;
    if (!user || typeof body?.channelId !== 'string') return { ok: true };
    // Followed channels keep delivering (unread counts depend on it).
    const followed = await this.channels.memberChannelIds(user.id);
    if (!followed.includes(body.channelId)) await client.leave(channelRoom(body.channelId));
    return { ok: true };
  }

  /** "Someone is typing": only from sockets that already passed the channel access check. */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId?: unknown }) {
    const data = client.data as SocketData;
    if (!data.user || typeof body?.channelId !== 'string') return { ok: false };
    const room = channelRoom(body.channelId);
    if (!client.rooms.has(room)) return { ok: false };
    const last = (data.lastTyping ??= new Map());
    const now = Date.now();
    if (now - (last.get(room) ?? 0) < TYPING_INTERVAL_MS) return { ok: true };
    last.set(room, now);
    client.to(room).emit('typing', { channelId: body.channelId, userId: data.user.id });
    return { ok: true };
  }

  /** Reports the caller online in a workspace and returns who else is. */
  @SubscribeMessage('presence:subscribe')
  async subscribePresence(@ConnectedSocket() client: Socket, @MessageBody() body: { workspaceId?: unknown }) {
    const data = client.data as SocketData;
    if (!data.user || typeof body?.workspaceId !== 'string') return { ok: false, error: 'bad_request' };
    const workspaceId = body.workspaceId;
    const membership = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: data.user.id } } });
    if (!membership) return { ok: false, error: 'not_found' };
    const set = (data.presence ??= new Set());
    if (!set.has(workspaceId)) {
      set.add(workspaceId);
      await client.join(presenceRoom(workspaceId));
      const users = this.online.get(workspaceId) ?? new Map<string, number>();
      this.online.set(workspaceId, users);
      const count = (users.get(data.user.id) ?? 0) + 1;
      users.set(data.user.id, count);
      if (count === 1) this.server.to(presenceRoom(workspaceId)).emit('presence', { workspaceId, userId: data.user.id, online: true });
    }
    return { ok: true, online: [...(this.online.get(workspaceId)?.keys() ?? [])] };
  }

  private leavePresence(workspaceId: string, userId: string) {
    const users = this.online.get(workspaceId);
    const count = (users?.get(userId) ?? 0) - 1;
    if (!users) return;
    if (count > 0) { users.set(userId, count); return; }
    users.delete(userId);
    if (users.size === 0) this.online.delete(workspaceId);
    this.server?.to(presenceRoom(workspaceId)).emit('presence', { workspaceId, userId, online: false });
  }

  @OnEvent(ChatEvents.message)
  onChatMessage(e: ChatMessageEvent) {
    this.server?.to(channelRoom(e.channelId)).emit('message', { type: e.type, channelId: e.channelId, message: e.message });
  }

  @OnEvent(ChatEvents.read)
  onChatRead(e: ChatReadEvent) {
    this.server?.to(userRoom(e.userId)).emit('channel:read', { channelId: e.channelId, seq: e.seq });
  }

  @OnEvent(ChatEvents.channelsChanged)
  onChannelsChanged(e: ChatChannelsChangedEvent) {
    // Everyone listening in the workspace (they report presence there), or just the people named.
    const rooms = e.userIds ? e.userIds.map(userRoom) : [presenceRoom(e.workspaceId)];
    this.server?.to(rooms).emit('channels:changed', { workspaceId: e.workspaceId });
  }

  /** Following a channel starts (or stops) its delivery to the user's open sockets. */
  @OnEvent(ChatEvents.member)
  async onChatMember(e: ChatMemberEvent) {
    const room = channelRoom(e.channelId);
    if (e.type === 'added') {
      await this.server?.in(userRoom(e.userId)).socketsJoin(room);
      return;
    }
    // Leaving a public channel still lets the user watch it if they have it open, but a removal
    // from a channel they can no longer see must stop delivery right away.
    await this.revalidate(e.channelId, e.userId);
  }

  @OnEvent(ChatEvents.accessChanged)
  async onAccessChanged(e: ChatAccessChangedEvent) {
    await this.revalidate(e.channelId);
  }

  /** Removes sockets from a channel room when their user can no longer see the channel. */
  private async revalidate(channelId: string, onlyUserId?: string) {
    if (!this.server) return;
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    const sockets = await this.server.in(channelRoom(channelId)).fetchSockets();
    for (const s of sockets) {
      const userId = (s.data as SocketData).user?.id;
      if (!userId || (onlyUserId && userId !== onlyUserId)) continue;
      const membership = channel ? await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: channel.workspaceId, userId } } }) : null;
      let allowed = false;
      if (membership) {
        try {
          await this.channelAccess.load(membership, channelId);
          allowed = true;
        } catch { /* hidden */ }
      }
      if (!allowed) s.leave(channelRoom(channelId));
    }
  }
}
