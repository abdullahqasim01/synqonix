import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RankTaskDto, TaskDto } from './dto/task.dto.js';
import { TaskEvents, type TaskEvent } from './events.js';
import { POSITION_STEP, positionBetween } from './ranking.js';
import { TaskAccessService } from './task-access.service.js';
import { summaryInclude } from './task-mapper.js';
import { taskKey } from './task-ref.js';
import { TaskSupportService } from './task-support.service.js';
import { TasksService } from './tasks.service.js';

type Tx = Prisma.TransactionClient;

interface Neighbors { beforeId?: string; afterId?: string }

/**
 * Drag-and-drop ranking. `position` is one project-wide order: boards show it per column and the
 * backlog per list, so both views agree on the relative order of any two tasks.
 */
@Injectable()
export class TaskRankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly support: TaskSupportService,
    private readonly tasks: TasksService,
    private readonly events: EventEmitter2,
  ) {}

  /** Board: drop a card into a status column, above/below another card of that column. */
  async rank(m: Membership, ref: string, dto: RankTaskDto): Promise<TaskDto> {
    if (dto.beforeId && dto.afterId) throw new BadRequestException('Use either beforeId or afterId, not both');
    const { task, project } = await this.access.load(m, ref, { write: true });
    if ((dto.beforeId ?? dto.afterId) === task.id) throw new BadRequestException('A card cannot be placed relative to itself');
    if (task.archivedAt) throw new BadRequestException('Archived tasks cannot be ranked');

    const events: TaskEvent[] = [];
    const statusId = await this.prisma.$transaction(async (tx) => {
      // One ranking at a time per project: concurrent drags apply in a defined order, so every
      // card ends up with a distinct position and clients converge on the same board.
      await this.support.lockProject(tx, project.id);

      const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      const target = await this.support.resolveStatus(tx, project.id, dto.statusId ?? current.statusId);
      const column: Prisma.TaskWhereInput = { projectId: project.id, statusId: target.id, archivedAt: null, id: { not: task.id } };
      await this.assertNeighbor(tx, column, dto);

      if (target.id !== current.statusId) {
        await this.tasks.applyUpdate(tx, m, project, task.id, { statusId: target.id }, events);
      }
      await this.place(tx, project.id, task.id, column, dto);
      return target.id;
    });

    this.publish(events, m, project, task, { statusId });
    return this.summary(task.id);
  }

  /** Backlog: drop a task into a sprint (or the backlog) above/below another task of that list. */
  async rankInBacklog(
    m: Membership, ref: string, dto: Neighbors & { sprintId: string | null },
  ): Promise<TaskDto> {
    if (dto.beforeId && dto.afterId) throw new BadRequestException('Use either beforeId or afterId, not both');
    const { task, project } = await this.access.load(m, ref, { write: true });
    if ((dto.beforeId ?? dto.afterId) === task.id) throw new BadRequestException('A task cannot be placed relative to itself');
    if (task.archivedAt) throw new BadRequestException('Archived tasks cannot be ranked');

    const events: TaskEvent[] = [];
    await this.prisma.$transaction(async (tx) => {
      await this.support.lockProject(tx, project.id);
      const list: Prisma.TaskWhereInput = { projectId: project.id, archivedAt: null, sprintId: dto.sprintId, id: { not: task.id } };
      await this.assertNeighbor(tx, list, dto);
      if (dto.sprintId !== task.sprintId) {
        await this.tasks.applyUpdate(tx, m, project, task.id, { sprintId: dto.sprintId }, events);
      }
      await this.place(tx, project.id, task.id, list, dto);
    });

    this.publish(events, m, project, task, {});
    return this.summary(task.id);
  }

  // ---------- internals ----------

  private async assertNeighbor(tx: Tx, container: Prisma.TaskWhereInput, n: Neighbors) {
    const id = n.beforeId ?? n.afterId;
    if (!id) return;
    const neighbor = await tx.task.findFirst({ where: { AND: [container, { id }] } });
    if (!neighbor) throw new BadRequestException('The reference task is not in the target list');
  }

  /** Writes the task's new position inside `container`, rebalancing the project if needed. */
  private async place(tx: Tx, projectId: string, taskId: string, container: Prisma.TaskWhereInput, n: Neighbors) {
    let position = await this.compute(tx, container, n);
    if (position === null) {
      await this.rebalance(tx, projectId);
      position = await this.compute(tx, container, n);
    }
    await tx.task.update({ where: { id: taskId }, data: { position: position ?? POSITION_STEP } });
  }

  /** Position between the neighbours, or null if they are too close together. */
  private async compute(tx: Tx, container: Prisma.TaskWhereInput, n: Neighbors): Promise<number | null> {
    if (n.beforeId) {
      const next = await tx.task.findFirstOrThrow({ where: { AND: [container, { id: n.beforeId }] } });
      const prev = await tx.task.findFirst({ where: { AND: [container, { position: { lt: next.position } }] }, orderBy: { position: 'desc' } });
      return positionBetween(prev?.position ?? null, next.position);
    }
    if (n.afterId) {
      const prev = await tx.task.findFirstOrThrow({ where: { AND: [container, { id: n.afterId }] } });
      const next = await tx.task.findFirst({ where: { AND: [container, { position: { gt: prev.position } }] }, orderBy: { position: 'asc' } });
      return positionBetween(prev.position, next?.position ?? null);
    }
    const last = await tx.task.findFirst({ where: container, orderBy: { position: 'desc' } });
    return positionBetween(last?.position ?? null, null);
  }

  /** Renumbers the whole project 1000, 2000, … keeping the current order (so every view stays consistent). */
  private rebalance(tx: Tx, projectId: string) {
    return tx.$executeRaw`
      UPDATE "Task" t SET "position" = r.rn * ${POSITION_STEP}::float8
      FROM (
        SELECT id, row_number() OVER (ORDER BY "position", id) AS rn
        FROM "Task"
        WHERE "projectId" = ${projectId}
      ) r
      WHERE t.id = r.id`;
  }

  private publish(
    events: TaskEvent[], m: Membership, project: { id: string; key: string }, task: { id: string; number: number },
    extra: { statusId?: string },
  ) {
    const base = { workspaceId: m.workspaceId, projectId: project.id, taskId: task.id, taskKey: taskKey(project.key, task.number), actorId: m.userId };
    events.push({ name: TaskEvents.ranked, payload: { ...base, statusId: extra.statusId ?? '' } });
    for (const e of events) this.events.emit(e.name, e.payload);
  }

  private async summary(taskId: string): Promise<TaskDto> {
    const row = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: summaryInclude });
    return (await this.tasks.toDtos([row]))[0];
  }
}
