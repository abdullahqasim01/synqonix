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

/** Drag-and-drop: moves a card to a column and slot, keeping every column totally ordered. */
@Injectable()
export class TaskRankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly support: TaskSupportService,
    private readonly tasks: TasksService,
    private readonly events: EventEmitter2,
  ) {}

  async rank(m: Membership, ref: string, dto: RankTaskDto): Promise<TaskDto> {
    if (dto.beforeId && dto.afterId) throw new BadRequestException('Use either beforeId or afterId, not both');
    const { task, project } = await this.access.load(m, ref, { write: true });
    if ((dto.beforeId ?? dto.afterId) === task.id) throw new BadRequestException('A card cannot be placed relative to itself');
    if (task.archivedAt) throw new BadRequestException('Archived tasks cannot be ranked');

    const events: TaskEvent[] = [];
    const base = { workspaceId: m.workspaceId, projectId: project.id, taskId: task.id, taskKey: taskKey(project.key, task.number), actorId: m.userId };
    const statusId = await this.prisma.$transaction(async (tx) => {
      // One ranking at a time per project: concurrent drags apply in a defined order, so every
      // card ends up with a distinct position and clients converge on the same board.
      await this.support.lockProject(tx, project.id);

      const current = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      const target = await this.support.resolveStatus(tx, project.id, dto.statusId ?? current.statusId);
      const neighborId = dto.beforeId ?? dto.afterId;
      const column = { projectId: project.id, statusId: target.id, archivedAt: null, id: { not: task.id } } as const;

      if (neighborId) {
        const neighbor = await tx.task.findFirst({ where: { ...column, id: neighborId } });
        if (!neighbor) throw new BadRequestException('The reference card is not in the target column');
      }

      if (target.id !== current.statusId) {
        await this.tasks.applyUpdate(tx, m, project, task.id, { statusId: target.id }, events);
      }

      let position = await this.compute(tx, column, dto);
      if (position === null) {
        await this.rebalance(tx, project.id, target.id);
        position = await this.compute(tx, column, dto);
      }
      await tx.task.update({ where: { id: task.id }, data: { position: position ?? POSITION_STEP } });
      return target.id;
    });

    events.push({ name: TaskEvents.ranked, payload: { ...base, statusId } });
    for (const e of events) this.events.emit(e.name, e.payload);

    const row = await this.prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: summaryInclude });
    return (await this.tasks.toDtos([row]))[0];
  }

  /** Position for the dropped card, or null if the neighbours are too close together. */
  private async compute(
    tx: Tx,
    column: { projectId: string; statusId: string; archivedAt: null; id: { not: string } },
    dto: RankTaskDto,
  ): Promise<number | null> {
    if (dto.beforeId) {
      const next = await tx.task.findFirstOrThrow({ where: { ...column, id: dto.beforeId } });
      const prev = await tx.task.findFirst({ where: { ...column, position: { lt: next.position } }, orderBy: { position: 'desc' } });
      return positionBetween(prev?.position ?? null, next.position);
    }
    if (dto.afterId) {
      const prev = await tx.task.findFirstOrThrow({ where: { ...column, id: dto.afterId } });
      const next = await tx.task.findFirst({ where: { ...column, position: { gt: prev.position } }, orderBy: { position: 'asc' } });
      return positionBetween(prev.position, next?.position ?? null);
    }
    const last = await tx.task.findFirst({ where: column, orderBy: { position: 'desc' } });
    return positionBetween(last?.position ?? null, null);
  }

  /** Renumbers a column 1000, 2000, … keeping its current order. */
  private rebalance(tx: Tx, projectId: string, statusId: string) {
    return tx.$executeRaw`
      UPDATE "Task" t SET "position" = r.rn * ${POSITION_STEP}::float8
      FROM (
        SELECT id, row_number() OVER (ORDER BY "position", id) AS rn
        FROM "Task"
        WHERE "projectId" = ${projectId} AND "statusId" = ${statusId} AND "archivedAt" IS NULL
      ) r
      WHERE t.id = r.id`;
  }
}
