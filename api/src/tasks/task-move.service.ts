import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { ActivityService } from './activity.service.js';
import type { TaskDetailDto } from './dto/task.dto.js';
import { TaskEvents } from './events.js';
import { TaskAccessService } from './task-access.service.js';
import { taskKey } from './task-ref.js';
import { TaskSupportService } from './task-support.service.js';
import { TasksService } from './tasks.service.js';

const POSITION_STEP = 1000;

@Injectable()
export class TaskMoveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly access: TaskAccessService,
    private readonly support: TaskSupportService,
    private readonly activity: ActivityService,
    private readonly tasks: TasksService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Moves a task and everything beneath it to another project. Tasks get new keys; statuses,
   * labels and custom fields are mapped by name (statuses fall back to their category).
   */
  async move(m: Membership, ref: string, targetProjectId: string): Promise<TaskDetailDto> {
    const { task: root, project: source } = await this.access.load(m, ref, { write: true });
    if (root.type === 'SUBTASK') throw new BadRequestException('Move the parent task instead of a sub-task');
    if (source.id === targetProjectId) throw new BadRequestException('The task is already in this project');
    const { project: target } = await this.projects.load(m, targetProjectId, { write: true });
    if (target.archivedAt) throw new BadRequestException('The destination project is archived');

    const keysBefore = new Map<string, string>();
    const moved = await this.prisma.$transaction(async (tx) => {
      // The subtree, parents before children.
      const subtree = [root];
      for (let frontier = [root.id]; frontier.length; ) {
        const kids = await tx.task.findMany({ where: { parentId: { in: frontier } }, orderBy: { number: 'asc' } });
        subtree.push(...kids);
        frontier = kids.map((k) => k.id);
      }

      const targetStatuses = await tx.projectStatus.findMany({ where: { projectId: target.id }, orderBy: { position: 'asc' } });
      const sourceStatuses = new Map((await tx.projectStatus.findMany({ where: { projectId: source.id } })).map((s) => [s.id, s]));
      const mapStatus = (id: string) => {
        const src = sourceStatuses.get(id)!;
        return (
          targetStatuses.find((s) => s.name.toLowerCase() === src.name.toLowerCase()) ??
          targetStatuses.find((s) => s.category === src.category) ??
          targetStatuses[0]
        );
      };
      const targetLabels = new Map((await tx.label.findMany({ where: { projectId: target.id } })).map((l) => [l.name.toLowerCase(), l.id]));
      const targetFields = await tx.customField.findMany({ where: { projectId: target.id } });

      const last = await tx.task.aggregate({ where: { projectId: target.id }, _max: { position: true } });
      let position = last._max.position ?? 0;

      for (const t of subtree) {
        keysBefore.set(t.id, taskKey(source.key, t.number));
        const { nextTaskNumber } = await tx.project.update({
          where: { id: target.id }, data: { nextTaskNumber: { increment: 1 } }, select: { nextTaskNumber: true },
        });
        const status = mapStatus(t.statusId);
        position += POSITION_STEP;
        await tx.task.update({
          where: { id: t.id },
          data: {
            projectId: target.id,
            number: nextTaskNumber - 1,
            statusId: status.id,
            position,
            ...(t.id === root.id ? { parentId: null } : {}),
            ...this.support.lifecycle(status.category, t),
          },
        });

        // labels by name
        const labels = await tx.taskLabel.findMany({ where: { taskId: t.id }, include: { label: true } });
        await tx.taskLabel.deleteMany({ where: { taskId: t.id } });
        const kept = labels.map((l) => targetLabels.get(l.label.name.toLowerCase())).filter((id): id is string => !!id);
        await tx.taskLabel.createMany({ data: [...new Set(kept)].map((labelId) => ({ taskId: t.id, labelId })) });

        // custom values by field name + type
        const values = await tx.taskCustomValue.findMany({ where: { taskId: t.id }, include: { field: true } });
        await tx.taskCustomValue.deleteMany({ where: { taskId: t.id } });
        for (const v of values) {
          const match = targetFields.find((f) => f.name === v.field.name && f.type === v.field.type);
          if (match) await tx.taskCustomValue.create({ data: { taskId: t.id, fieldId: match.id, value: v.value as Prisma.InputJsonValue } });
        }

        // assignees/watchers who cannot see the destination are dropped
        for (const table of ['taskAssignee', 'taskWatcher'] as const) {
          const rows = await (tx[table] as typeof tx.taskAssignee).findMany({ where: { taskId: t.id } });
          const ok = new Set(await this.support.visibleUserIds(tx, m.workspaceId, target, rows.map((r) => r.userId)));
          const drop = rows.filter((r) => !ok.has(r.userId)).map((r) => r.userId);
          if (drop.length) await (tx[table] as typeof tx.taskAssignee).deleteMany({ where: { taskId: t.id, userId: { in: drop } } });
        }

        await this.activity.record(tx, t.id, m.userId, [
          { type: 'moved', from: keysBefore.get(t.id), to: taskKey(target.key, nextTaskNumber - 1) },
        ]);
      }
      return subtree;
    });

    for (const t of moved) {
      const row = await this.prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { number: true } });
      this.events.emit(TaskEvents.updated, {
        workspaceId: m.workspaceId, projectId: target.id, taskId: t.id,
        taskKey: taskKey(target.key, row.number), actorId: m.userId, fields: ['project'],
      });
    }
    return this.tasks.detail(m, root.id);
  }

  /** Copies a task (without comments, attachments or relations) into the same project. */
  async duplicate(m: Membership, ref: string): Promise<TaskDetailDto> {
    const { task, project } = await this.access.load(m, ref, { write: true });
    if (project.archivedAt) throw new BadRequestException('This project is archived');

    const source = await this.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { assignees: true, labels: true, customValues: true, checklists: { include: { items: true } } },
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const status = await this.support.resolveStatus(tx, project.id);
      const { nextTaskNumber } = await tx.project.update({
        where: { id: project.id }, data: { nextTaskNumber: { increment: 1 } }, select: { nextTaskNumber: true },
      });
      const last = await tx.task.aggregate({ where: { projectId: project.id }, _max: { position: true } });
      const copy = await tx.task.create({
        data: {
          projectId: project.id,
          number: nextTaskNumber - 1,
          type: source.type,
          title: source.title,
          description: source.description,
          statusId: status.id,
          priority: source.priority,
          reporterId: m.userId,
          estimate: source.estimate,
          dueDate: source.dueDate,
          parentId: source.parentId,
          position: (last._max.position ?? 0) + POSITION_STEP,
          ...this.support.lifecycle(status.category, { startedAt: null, completedAt: null }),
          assignees: { create: source.assignees.map((a) => ({ userId: a.userId })) },
          labels: { create: source.labels.map((l) => ({ labelId: l.labelId })) },
          watchers: { create: [...new Set([m.userId, ...source.assignees.map((a) => a.userId)])].map((userId) => ({ userId })) },
          customValues: { create: source.customValues.map((v) => ({ fieldId: v.fieldId, value: v.value as Prisma.InputJsonValue })) },
          checklists: {
            create: source.checklists.map((c) => ({
              title: c.title, position: c.position,
              items: { create: c.items.map((i) => ({ text: i.text, position: i.position })) },
            })),
          },
        },
      });
      await this.activity.record(tx, copy.id, m.userId, [
        { type: 'created' },
        { type: 'duplicated_from', to: taskKey(project.key, task.number) },
      ]);
      return copy;
    });
    this.events.emit(TaskEvents.created, {
      workspaceId: m.workspaceId, projectId: project.id, taskId: created.id,
      taskKey: taskKey(project.key, created.number), actorId: m.userId,
    });
    return this.tasks.detail(m, created.id);
  }
}
