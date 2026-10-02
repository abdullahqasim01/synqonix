import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthTokenService, type Authenticated } from '../auth/auth-token.service.js';
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

interface SocketData { user?: Authenticated; timer?: NodeJS.Timeout }

/**
 * Pushes task changes to clients watching a project, so boards update live.
 * Clients authenticate with `auth: { token }` (session JWT or API token), then send
 * `subscribe` with `{ projectId }`; they receive `task` events for that room. Events carry
 * only identifiers: clients refetch what they display, so no data leaks past the HTTP rules.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly tokens: AuthTokenService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

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
}
