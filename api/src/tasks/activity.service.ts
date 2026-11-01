import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ActivityDto } from './dto/task.dto.js';

export interface ActivityEntry {
  type: string;
  field?: string;
  from?: Prisma.InputJsonValue | null;
  to?: Prisma.InputJsonValue | null;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records entries as part of the caller's transaction so history never drifts from data. */
  async record(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorId: string | null,
    entries: ActivityEntry[],
  ) {
    if (entries.length === 0) return;
    await tx.activity.createMany({
      data: entries.map((e) => ({
        taskId,
        actorId,
        type: e.type,
        field: e.field ?? null,
        from: e.from === undefined || e.from === null ? undefined : e.from,
        to: e.to === undefined || e.to === null ? undefined : e.to,
      })),
    });
  }

  async list(taskId: string, limit = 50, before?: string): Promise<ActivityDto[]> {
    const beforeDate = before ? new Date(before) : undefined;
    const rows = await this.prisma.activity.findMany({
      where: { taskId, ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id, actorId: r.actorId, type: r.type, field: r.field, from: r.from, to: r.to, createdAt: r.createdAt,
    }));
  }
}
