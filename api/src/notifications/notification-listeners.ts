import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SprintEvents, type SprintEvent } from '../agile/events.js';
import { ChatEvents, type ChatMentionedEvent } from '../channels/events.js';
import { GithubEvents, type GithubCiFailedEvent, type GithubPullRequestEvent } from '../github/events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TaskEvents, type TaskAssignedEvent, type TaskCommentedEvent, type TaskEventBase, type TaskMentionedEvent, type TaskStatusChangedEvent,
} from '../tasks/events.js';
import { extractMentionedUserIds } from '../tasks/mentions.js';
import { NotificationsService } from './notifications.service.js';

const snippet = (text: string | null | undefined, max = 140) => {
  const plain = (text ?? '').replace(/\[@([^\]]+)\]\(mention:[^)]+\)/g, '@$1').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

/**
 * Turns domain events from tasks, sprints, chat and GitHub into notifications. Each handler only
 * decides who should hear about it; `NotificationsService.notify` applies visibility, mutes and
 * everyone's preferences. A failure here is logged and never reaches the code that caused the event.
 */
@Injectable()
export class NotificationListeners {
  private readonly logger = new Logger(NotificationListeners.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async safely(label: string, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (err) {
      this.logger.error(`Could not create ${label} notifications: ${(err as Error).message}`);
    }
  }

  private async actorName(id: string | null | undefined) {
    if (!id) return 'Someone';
    return (await this.prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'Someone';
  }

  private async followers(taskId: string): Promise<{ title: string; ids: string[] }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { watchers: true, assignees: true } });
    if (!task) return { title: '', ids: [] };
    return { title: task.title, ids: [...new Set([...task.watchers.map((w) => w.userId), ...task.assignees.map((a) => a.userId)])] };
  }

  private base(e: TaskEventBase) {
    return { workspaceId: e.workspaceId, projectId: e.projectId, actorId: e.actorId, taskId: e.taskId, taskKey: e.taskKey, url: `/w/${e.workspaceId}/tasks/${e.taskKey}` };
  }

  // ---------------------------------------------------------------- tasks

  @OnEvent(TaskEvents.assigned)
  onAssigned(e: TaskAssignedEvent) {
    return this.safely('assignment', async () => {
      const task = await this.prisma.task.findUnique({ where: { id: e.taskId }, select: { title: true } });
      await this.notifications.notify({
        ...this.base(e), type: 'ASSIGNED', userIds: e.assigneeIds, title: `${await this.actorName(e.actorId)} assigned you ${e.taskKey}`, body: task?.title,
      });
    });
  }

  @OnEvent(TaskEvents.statusChanged)
  onStatusChanged(e: TaskStatusChangedEvent) {
    return this.safely('status', async () => {
      const { title, ids } = await this.followers(e.taskId);
      await this.notifications.notify({
        ...this.base(e), type: 'STATUS_CHANGED', userIds: ids, title: `${await this.actorName(e.actorId)} moved ${e.taskKey} to ${e.to}`, body: title,
      });
    });
  }

  @OnEvent(TaskEvents.commented)
  onCommented(e: TaskCommentedEvent) {
    return this.safely('comment', async () => {
      const [comment, { ids }] = await Promise.all([this.prisma.comment.findUnique({ where: { id: e.commentId } }), this.followers(e.taskId)]);
      if (!comment) return;
      // People mentioned in the comment get the more specific "mentioned" notification instead.
      const mentioned = new Set(extractMentionedUserIds(comment.body));
      await this.notifications.notify({
        ...this.base(e), type: 'COMMENTED', userIds: ids.filter((id) => !mentioned.has(id)),
        title: `${await this.actorName(e.actorId)} commented on ${e.taskKey}`, body: snippet(comment.body),
      });
    });
  }

  @OnEvent(TaskEvents.mentioned)
  onMentioned(e: TaskMentionedEvent) {
    return this.safely('mention', async () => {
      const body = e.commentId
        ? (await this.prisma.comment.findUnique({ where: { id: e.commentId } }))?.body
        : (await this.prisma.task.findUnique({ where: { id: e.taskId }, select: { description: true } }))?.description;
      await this.notifications.notify({
        ...this.base(e), type: 'MENTIONED', userIds: e.mentionedUserIds,
        title: `${await this.actorName(e.actorId)} mentioned you in ${e.taskKey}`, body: snippet(body),
      });
    });
  }

  // ---------------------------------------------------------------- sprints

  private sprintRecipients(sprintId: string, leadId: string | null) {
    return this.prisma.sprintTask.findMany({ where: { sprintId }, select: { task: { select: { assignees: { select: { userId: true } } } } } }).then((rows) => [
      ...new Set([...(leadId ? [leadId] : []), ...rows.flatMap((r) => r.task.assignees.map((a) => a.userId))]),
    ]);
  }

  private async sprintNotice(type: 'SPRINT_STARTED' | 'SPRINT_COMPLETED', e: SprintEvent) {
    const project = await this.prisma.project.findUnique({ where: { id: e.projectId }, select: { leadId: true, name: true } });
    if (!project) return;
    await this.notifications.notify({
      workspaceId: e.workspaceId, projectId: e.projectId, type, actorId: e.actorId, userIds: await this.sprintRecipients(e.sprintId, project.leadId),
      title: `${e.sprintName} ${type === 'SPRINT_STARTED' ? 'started' : 'completed'}`, body: project.name, url: `/w/${e.workspaceId}/projects/${e.projectId}`,
      dedupeKey: `${type.toLowerCase()}:${e.sprintId}`,
    });
  }

  @OnEvent(SprintEvents.started) onSprintStarted(e: SprintEvent) { return this.safely('sprint', () => this.sprintNotice('SPRINT_STARTED', e)); }
  @OnEvent(SprintEvents.completed) onSprintCompleted(e: SprintEvent) { return this.safely('sprint', () => this.sprintNotice('SPRINT_COMPLETED', e)); }

  // ---------------------------------------------------------------- chat

  @OnEvent(ChatEvents.mentioned)
  onChatMention(e: ChatMentionedEvent) {
    return this.safely('chat mention', async () => {
      const [channel, message] = await Promise.all([
        this.prisma.channel.findUnique({ where: { id: e.channelId } }),
        this.prisma.message.findUnique({ where: { id: e.messageId } }),
      ]);
      if (!channel || !message || message.deletedAt) return;
      const where = channel.type === 'DIRECT' ? 'a direct message' : `#${channel.name}`;
      await this.notifications.notify({
        workspaceId: e.workspaceId, projectId: channel.projectId, type: 'CHAT_MENTION', actorId: e.actorId, userIds: e.mentionedUserIds,
        title: `${await this.actorName(e.actorId)} mentioned you in ${where}`, body: snippet(message.body),
        url: `/w/${e.workspaceId}/chat?c=${channel.id}`, channelId: channel.id, messageId: message.id, dedupeKey: `chat:${message.id}`,
      });
    });
  }

  // ---------------------------------------------------------------- GitHub

  private async forEachTask(taskIds: string[], fn: (task: { id: string; number: number; projectId: string; project: { key: string } }, ids: string[]) => Promise<void>) {
    for (const taskId of taskIds) {
      const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { project: { select: { key: true } } } });
      if (task) await fn(task, (await this.followers(taskId)).ids);
    }
  }

  @OnEvent(GithubEvents.pullRequest)
  onPullRequest(e: GithubPullRequestEvent) {
    return this.safely('pull request', () => this.forEachTask(e.taskIds, async (t, ids) => {
      const key = `${t.project.key}-${t.number}`;
      await this.notifications.notify({
        workspaceId: e.workspaceId, projectId: t.projectId, type: e.action === 'opened' ? 'PR_OPENED' : 'PR_MERGED', actorId: e.actorId, userIds: ids,
        title: `Pull request #${e.number} ${e.action} for ${key}`, body: e.title, url: `/w/${e.workspaceId}/tasks/${key}`, taskId: t.id, taskKey: key,
        dedupeKey: `pr:${e.prKey}:${e.action}:${t.id}`,
      });
    }));
  }

  @OnEvent(GithubEvents.ciFailed)
  onCiFailed(e: GithubCiFailedEvent) {
    return this.safely('CI', () => this.forEachTask(e.taskIds, async (t, ids) => {
      const key = `${t.project.key}-${t.number}`;
      await this.notifications.notify({
        workspaceId: e.workspaceId, projectId: t.projectId, type: 'CI_FAILED', userIds: ids,
        title: `Checks failed on pull request #${e.number}`, body: `${e.checkName} · ${key} · ${e.title}`, url: `/w/${e.workspaceId}/tasks/${key}`, taskId: t.id, taskKey: key,
        dedupeKey: `ci:${e.prKey}:${e.headSha}:${e.checkName}:${t.id}`,
      });
    }));
  }
}
