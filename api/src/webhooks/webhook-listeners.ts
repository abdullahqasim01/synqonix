import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskEvents, type TaskCommentedEvent, type TaskEventBase, type TaskStatusChangedEvent } from '../tasks/events.js';
import type { WebhookEvent } from './dto/webhooks.dto.js';
import { WebhooksService } from './webhooks.service.js';

/** Turns task events into queued webhook deliveries. Never lets a failure reach the code that caused the event. */
@Injectable()
export class WebhookListeners {
  private readonly logger = new Logger(WebhookListeners.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  private async snapshot(e: TaskEventBase): Promise<Prisma.InputJsonObject> {
    const [task, project, actor] = await Promise.all([
      this.prisma.task.findUnique({
        where: { id: e.taskId },
        include: { status: true, assignees: { include: { user: { select: { id: true, name: true } } } }, labels: { include: { label: true } } },
      }),
      this.prisma.project.findUnique({ where: { id: e.projectId }, select: { id: true, key: true, name: true } }),
      this.prisma.user.findUnique({ where: { id: e.actorId }, select: { id: true, name: true } }),
    ]);
    return {
      project: project ? { id: project.id, key: project.key, name: project.name } : { id: e.projectId },
      actor: actor ? { id: actor.id, name: actor.name } : null,
      task: task
        ? {
          id: task.id, key: e.taskKey, title: task.title, type: task.type, priority: task.priority, status: { name: task.status.name, category: task.status.category },
          assignees: task.assignees.map((a) => ({ id: a.user.id, name: a.user.name })), labels: task.labels.map((l) => l.label.name),
          dueDate: task.dueDate?.toISOString() ?? null, estimate: task.estimate, url: null,
        }
        : { id: e.taskId, key: e.taskKey },
    };
  }

  private async emit(event: WebhookEvent, e: TaskEventBase, extra: Prisma.InputJsonObject = {}) {
    try {
      const hooks = await this.prisma.outboundWebhook.count({ where: { workspaceId: e.workspaceId, active: true, events: { has: event } } });
      if (hooks === 0) return; // the common case: nobody listens, so skip building a payload
      await this.webhooks.enqueue(e.workspaceId, e.projectId, event, { ...(await this.snapshot(e)), ...extra });
    } catch (err) {
      this.logger.error(`Could not queue ${event}: ${(err as Error).message}`);
    }
  }

  @OnEvent(TaskEvents.created) onCreated(e: TaskEventBase) { return this.emit('task.created', e); }
  @OnEvent(TaskEvents.updated) onUpdated(e: TaskEventBase & { fields: string[] }) { return this.emit('task.updated', e, { changedFields: e.fields }); }
  @OnEvent(TaskEvents.deleted) onDeleted(e: TaskEventBase) { return this.emit('task.deleted', e); }
  @OnEvent(TaskEvents.statusChanged) onStatus(e: TaskStatusChangedEvent) { return this.emit('task.status_changed', e, { from: e.from, to: e.to }); }

  @OnEvent(TaskEvents.commented)
  async onCommented(e: TaskCommentedEvent) {
    const comment = await this.prisma.comment.findUnique({ where: { id: e.commentId } });
    return this.emit('task.commented', e, { comment: { id: e.commentId, body: comment?.body ?? '' } });
  }
}
