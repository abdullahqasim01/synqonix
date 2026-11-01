import { Injectable } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import type { TaskListDto } from './dto/task.dto.js';
import { TaskAccessService } from './task-access.service.js';
import { summaryInclude } from './task-mapper.js';
import { TasksService } from './tasks.service.js';

const KEEP = 50;

@Injectable()
export class RecentTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly projects: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  /** Remembers that the caller opened a task; keeps only the latest `KEEP` per user. */
  async markViewed(m: Membership, ref: string) {
    const { task } = await this.access.load(m, ref);
    await this.prisma.recentTask.upsert({
      where: { userId_taskId: { userId: m.userId, taskId: task.id } },
      create: { userId: m.userId, taskId: task.id },
      update: { viewedAt: new Date() },
    });
    const cutoff = await this.prisma.recentTask.findFirst({
      where: { userId: m.userId }, orderBy: { viewedAt: 'desc' }, skip: KEEP, select: { viewedAt: true },
    });
    if (cutoff) await this.prisma.recentTask.deleteMany({ where: { userId: m.userId, viewedAt: { lte: cutoff.viewedAt } } });
  }

  async list(m: Membership, limit = 20): Promise<TaskListDto> {
    const where = {
      userId: m.userId,
      task: { project: { workspaceId: m.workspaceId, ...this.projects.visibleProjects(m) } },
    };
    const [rows, total] = await Promise.all([
      this.prisma.recentTask.findMany({
        where, orderBy: { viewedAt: 'desc' }, take: limit, include: { task: { include: summaryInclude } },
      }),
      this.prisma.recentTask.count({ where }),
    ]);
    return { items: await this.tasks.toDtos(rows.map((r) => r.task)), total };
  }
}
