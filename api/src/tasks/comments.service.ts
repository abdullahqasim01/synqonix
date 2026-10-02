import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Comment, Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CommentDto } from './dto/details.dto.js';
import { TaskEvents, type TaskEvent } from './events.js';
import { extractMentionedUserIds } from './mentions.js';
import { TaskAccessService } from './task-access.service.js';
import { taskKey } from './task-ref.js';
import { TaskSupportService } from './task-support.service.js';

const toDto = (c: Comment): CommentDto => ({
  id: c.id, authorId: c.authorId, body: c.body, edited: c.editedAt !== null,
  createdAt: c.createdAt, editedAt: c.editedAt,
});

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly support: TaskSupportService,
    private readonly events: EventEmitter2,
  ) {}

  async list(m: Membership, ref: string): Promise<CommentDto[]> {
    const { task } = await this.access.load(m, ref);
    const rows = await this.prisma.comment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  /** Emits `task.mentioned` for users newly mentioned in `body` who can see the project. */
  private async emitMentions(
    m: Membership, task: { id: string; number: number }, project: Parameters<TaskSupportService['visibleUserIds']>[2],
    body: string, commentId: string, previouslyMentioned: string[],
  ) {
    const wanted = extractMentionedUserIds(body).filter((id) => id !== m.userId && !previouslyMentioned.includes(id));
    const ids = await this.support.visibleUserIds(this.prisma, m.workspaceId, project, wanted);
    if (ids.length === 0) return;
    const event: TaskEvent = {
      name: TaskEvents.mentioned,
      payload: {
        workspaceId: m.workspaceId, projectId: project.id, taskId: task.id,
        taskKey: taskKey(project.key, task.number), actorId: m.userId,
        mentionedUserIds: ids, source: 'comment', commentId,
      },
    };
    this.events.emit(event.name, event.payload);
  }

  async create(m: Membership, ref: string, body: string): Promise<CommentDto> {
    const { task, project } = await this.access.load(m, ref, { write: true });
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({ data: { taskId: task.id, authorId: m.userId, body: body.trim() } });
      await tx.taskWatcher.createMany({ data: [{ taskId: task.id, userId: m.userId }], skipDuplicates: true });
      await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
      return c;
    });
    this.events.emit(TaskEvents.commented, {
      workspaceId: m.workspaceId, projectId: project.id, taskId: task.id,
      taskKey: taskKey(project.key, task.number), actorId: m.userId, commentId: comment.id,
    });
    await this.emitMentions(m, task, project, comment.body, comment.id, []);
    return toDto(comment);
  }

  private async loadComment(taskId: string, commentId: string) {
    const c = await this.prisma.comment.findFirst({ where: { id: commentId, taskId } });
    if (!c) throw new NotFoundException('Comment not found');
    return c;
  }

  async update(m: Membership, ref: string, commentId: string, body: string): Promise<CommentDto> {
    const { task, project } = await this.access.load(m, ref, { write: true });
    const existing = await this.loadComment(task.id, commentId);
    if (existing.authorId !== m.userId) throw new ForbiddenException('You can only edit your own comments');
    const next = body.trim();
    if (next === existing.body) return toDto(existing);
    const updated = await this.prisma.comment.update({ where: { id: commentId }, data: { body: next, editedAt: new Date() } });
    await this.emitMentions(m, task, project, next, commentId, extractMentionedUserIds(existing.body));
    return toDto(updated);
  }

  async remove(m: Membership, ref: string, commentId: string) {
    const { task, manage } = await this.access.load(m, ref, { write: true });
    const existing = await this.loadComment(task.id, commentId);
    if (existing.authorId !== m.userId && !manage) {
      throw new ForbiddenException('Only the author or a project admin can delete this comment');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}
