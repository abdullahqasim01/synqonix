import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import type {
  BurndownDto, EpicProgressDto, FlowDto, SprintDto, SprintSummaryDto, VelocityDto,
} from './dto/agile.dto.js';
import { SprintTracker } from './sprint-tracker.service.js';
import { SprintsService } from './sprints.service.js';
import { daysBetween, idealBurndown, summarize, weeklyThroughput } from './stats.js';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly tracker: SprintTracker,
    private readonly sprints: SprintsService,
  ) {}

  /** Burndown / burnup data of a sprint: every recorded point plus the ideal line. */
  async burndown(m: Membership, projectId: string, sprintId: string): Promise<BurndownDto> {
    await this.projects.load(m, projectId);
    const sprint = await this.prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
    if (!sprint) throw new NotFoundException('Sprint not found');
    if (sprint.state === 'ACTIVE') await this.tracker.ensureDaily(sprint.id);

    const snapshots = await this.prisma.sprintSnapshot.findMany({ where: { sprintId }, orderBy: { at: 'asc' } });
    const committed = snapshots.find((s) => s.reason === 'START')?.scopePoints
      ?? (sprint.summary as SprintSummaryDto | null)?.committedPoints ?? 0;
    return {
      sprint: await this.sprints.get(m, projectId, sprintId) as SprintDto,
      points: snapshots.map((s) => ({
        at: s.at, reason: s.reason, scopePoints: s.scopePoints, donePoints: s.donePoints,
        remainingPoints: s.scopePoints - s.donePoints, scopeTasks: s.scopeTasks, doneTasks: s.doneTasks,
        remainingTasks: s.scopeTasks - s.doneTasks,
      })),
      ideal: sprint.startDate && sprint.endDate && sprint.state !== 'PLANNED' ? idealBurndown(sprint.startDate, sprint.endDate, committed) : [],
    };
  }

  /** Completed sprints, oldest first, with committed vs completed points. */
  async velocity(m: Membership, projectId: string, limit = 10): Promise<VelocityDto> {
    const { project } = await this.projects.load(m, projectId);
    const rows = await this.prisma.sprint.findMany({
      where: { projectId, state: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, take: limit,
    });
    const sprints = rows.reverse().map((s) => {
      const sum = (s.summary as SprintSummaryDto | null) ?? { committedPoints: 0, completedPoints: 0, addedPoints: 0, carriedOverPoints: 0, completedTasks: 0 } as SprintSummaryDto;
      return {
        sprintId: s.id, number: s.number, name: s.name, completedAt: s.completedAt!,
        committedPoints: sum.committedPoints, completedPoints: sum.completedPoints, addedPoints: sum.addedPoints,
        carriedOverPoints: sum.carriedOverPoints, completedTasks: sum.completedTasks,
      };
    });
    const avg = (list: { completedPoints: number }[]) =>
      list.length ? Math.round((list.reduce((a, s) => a + s.completedPoints, 0) / list.length) * 100) / 100 : 0;
    return { unit: project.estimationUnit.toLowerCase(), sprints, average: avg(sprints), recentAverage: avg(sprints.slice(-3)) };
  }

  /** Kanban metrics for work finished in the last `days` days. */
  async flow(m: Membership, projectId: string, days = 30): Promise<FlowDto> {
    const { project } = await this.projects.load(m, projectId);
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const done = await this.prisma.task.findMany({
      where: { projectId, completedAt: { gte: since }, type: { not: 'EPIC' } }, orderBy: { completedAt: 'desc' },
      select: { number: true, title: true, type: true, createdAt: true, startedAt: true, completedAt: true },
    });
    const tasks = done.map((t) => ({
      key: taskKey(project.key, t.number), title: t.title, type: t.type, completedAt: t.completedAt!,
      leadTimeDays: Math.round(daysBetween(t.createdAt, t.completedAt!) * 100) / 100,
      cycleTimeDays: t.startedAt ? Math.round(Math.max(0, daysBetween(t.startedAt, t.completedAt!)) * 100) / 100 : null,
    }));
    const lead = summarize(tasks.map((t) => t.leadTimeDays));
    const cycle = summarize(tasks.flatMap((t) => (t.cycleTimeDays === null ? [] : [t.cycleTimeDays])));
    const wip = await this.prisma.task.count({
      where: { projectId, archivedAt: null, type: { not: 'EPIC' }, status: { category: 'IN_PROGRESS' } },
    });
    return {
      days,
      stats: {
        count: tasks.length,
        avgLeadDays: lead.avg, medianLeadDays: lead.median, p85LeadDays: lead.p85,
        avgCycleDays: cycle.avg, medianCycleDays: cycle.median, p85CycleDays: cycle.p85,
      },
      throughput: weeklyThroughput(tasks.map((t) => t.completedAt), now, days),
      wip,
      tasks,
    };
  }

  /** Epics with progress rolled up from their child issues. */
  async epics(m: Membership, projectId: string): Promise<EpicProgressDto[]> {
    const { project } = await this.projects.load(m, projectId);
    const epics = await this.prisma.task.findMany({
      where: { projectId, type: 'EPIC', archivedAt: null }, include: { status: true }, orderBy: { number: 'asc' },
    });
    const children = await this.prisma.task.findMany({
      where: { parentId: { in: epics.map((e) => e.id) }, archivedAt: null },
      select: { parentId: true, estimate: true, status: { select: { category: true } } },
    });
    return epics.map((e) => {
      const mine = children.filter((c) => c.parentId === e.id);
      const done = mine.filter((c) => c.status.category === 'DONE');
      const points = mine.reduce((a, c) => a + (c.estimate ?? 0), 0);
      const donePoints = done.reduce((a, c) => a + (c.estimate ?? 0), 0);
      const ratio = points > 0 ? donePoints / points : mine.length > 0 ? done.length / mine.length : 0;
      return {
        id: e.id, key: taskKey(project.key, e.number), title: e.title, status: e.status.name,
        startDate: e.startDate, dueDate: e.dueDate, childCount: mine.length, doneCount: done.length,
        points, donePoints, progress: Math.round(ratio * 100),
      };
    });
  }
}
