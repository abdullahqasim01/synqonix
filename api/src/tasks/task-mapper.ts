import type { Prisma } from '../generated/prisma/client.js';
import type { TaskDto, TaskRefDto } from './dto/task.dto.js';
import { taskKey } from './task-ref.js';

/** Everything a task list row needs. */
export const summaryInclude = {
  project: { select: { key: true } },
  status: true,
  assignees: { include: { user: { select: { id: true, name: true } } } },
  labels: { include: { label: true } },
  _count: { select: { children: { where: { archivedAt: null } }, comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof summaryInclude }>;

export const statusDto = (s: TaskRow['status']) => ({ id: s.id, name: s.name, category: s.category, color: s.color });

export function toTaskDto(t: TaskRow, doneSubtasks = 0): TaskDto {
  return {
    id: t.id,
    key: taskKey(t.project.key, t.number),
    number: t.number,
    projectId: t.projectId,
    projectKey: t.project.key,
    title: t.title,
    type: t.type,
    status: statusDto(t.status),
    priority: t.priority,
    assignees: t.assignees.map((a) => ({ userId: a.userId, name: a.user.name })),
    labels: t.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    reporterId: t.reporterId,
    estimate: t.estimate,
    dueDate: t.dueDate,
    parentId: t.parentId,
    position: t.position,
    archived: t.archivedAt !== null,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    subtaskCount: t._count.children,
    subtaskDoneCount: doneSubtasks,
    commentCount: t._count.comments,
  };
}

export const refInclude = { project: { select: { key: true } }, status: true } satisfies Prisma.TaskInclude;
export type RefRow = Prisma.TaskGetPayload<{ include: typeof refInclude }>;

export const toRefDto = (t: RefRow): TaskRefDto => ({
  id: t.id,
  key: taskKey(t.project.key, t.number),
  title: t.title,
  type: t.type,
  status: statusDto(t.status),
});
