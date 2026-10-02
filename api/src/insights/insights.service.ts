import { Injectable } from '@nestjs/common';
import type { Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import type {
  CreatedResolvedDto, CumulativeFlowDto, OverdueTaskDto, TimeReportDto, WorkloadRowDto, WorkspaceOverviewDto,
} from './dto/insights.dto.js';
import { bucketOf, bucketStarts, isoDay, lastDays, statusAt, type StatusChange } from './series.js';

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Numbers behind the dashboards. All of them are derived from raw task, activity and time rows. */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  // ---------------------------------------------------------------- created vs resolved

  async createdResolved(m: Membership, projectId: string, days = 30, bucket: 'day' | 'week' = 'day', now = new Date()): Promise<CreatedResolvedDto> {
    await this.projects.load(m, projectId);
    const starts = bucketStarts(now, days, bucket);
    const since = new Date(starts[0]);
    const [created, resolved, openNow] = await Promise.all([
      this.prisma.task.findMany({ where: { projectId, createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.task.findMany({ where: { projectId, completedAt: { gte: since } }, select: { completedAt: true } }),
      this.prisma.task.count({ where: { projectId, archivedAt: null, status: { category: { not: 'DONE' } } } }),
    ]);
    const points = new Map(starts.map((s) => [s, { date: isoDay(s), created: 0, resolved: 0 }]));
    for (const t of created) points.get(bucketOf(t.createdAt.getTime(), bucket))!.created++;
    for (const t of resolved) points.get(bucketOf(t.completedAt!.getTime(), bucket))!.resolved++;
    const list = [...points.values()];
    return { bucket, points: list, totalCreated: list.reduce((n, p) => n + p.created, 0), totalResolved: list.reduce((n, p) => n + p.resolved, 0), openNow };
  }

  // ---------------------------------------------------------------- cumulative flow

  /**
   * How many tasks sat in each status at the end of each day, rebuilt from the status changes
   * recorded in task history. Tasks archived by then are left out; deleted tasks are gone.
   */
  async cumulativeFlow(m: Membership, projectId: string, days = 30, now = new Date()): Promise<CumulativeFlowDto> {
    await this.projects.load(m, projectId);
    const statuses = await this.prisma.projectStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
    const category = new Map(statuses.map((s) => [s.name, s.category]));
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: { id: true, createdAt: true, archivedAt: true, status: { select: { name: true } } },
    });
    const history = await this.prisma.activity.findMany({
      where: { task: { projectId }, type: 'updated', field: 'status' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { taskId: true, createdAt: true, from: true, to: true },
    });
    const changes = new Map<string, StatusChange[]>();
    for (const h of history) {
      if (typeof h.to !== 'string') continue;
      const list = changes.get(h.taskId) ?? [];
      list.push({ at: h.createdAt, from: typeof h.from === 'string' ? h.from : null, to: h.to });
      changes.set(h.taskId, list);
    }

    const names = statuses.map((s) => s.name);
    const points = lastDays(now, days).map((start) => {
      const endOfDay = new Date(start + DAY - 1);
      const by = new Map<string, number>();
      const cat = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
      let total = 0;
      for (const t of tasks) {
        if (t.archivedAt && t.archivedAt.getTime() <= endOfDay.getTime()) continue;
        const name = statusAt({ createdAt: t.createdAt, currentStatus: t.status.name }, changes.get(t.id) ?? [], endOfDay);
        if (name === null) continue;
        by.set(name, (by.get(name) ?? 0) + 1);
        cat[category.get(name) ?? 'TODO']++; // a status that was since deleted counts as not started
        total++;
      }
      const known = names.map((name) => ({ name, count: by.get(name) ?? 0 }));
      const gone = [...by].filter(([n]) => !names.includes(n)).map(([name, count]) => ({ name, count }));
      return { date: isoDay(start), total, todo: cat.TODO, inProgress: cat.IN_PROGRESS, done: cat.DONE, byStatus: [...known, ...gone] };
    });
    return { statuses: names, points };
  }

  // ---------------------------------------------------------------- workload

  private async workloadFor(where: Prisma.TaskWhereInput, now: Date): Promise<WorkloadRowDto[]> {
    const [open, done] = await Promise.all([
      this.prisma.task.findMany({
        where: { AND: [where, { archivedAt: null, status: { category: { not: 'DONE' } }, type: { not: 'EPIC' } }] },
        select: { estimate: true, dueDate: true, assignees: { select: { userId: true } } },
      }),
      this.prisma.taskAssignee.groupBy({
        by: ['userId'], _count: { _all: true },
        where: { task: { AND: [where, { completedAt: { gte: new Date(now.getTime() - 30 * DAY) } }] } },
      }),
    ]);
    const rows = new Map<string | null, WorkloadRowDto>();
    const row = (userId: string | null) => {
      if (!rows.has(userId)) rows.set(userId, { userId, name: userId ? '' : 'Unassigned', openTasks: 0, openPoints: 0, overdueTasks: 0, doneLast30Days: 0 });
      return rows.get(userId)!;
    };
    for (const t of open) {
      const owners = t.assignees.length ? t.assignees.map((a) => a.userId) : [null];
      for (const id of owners) {
        const r = row(id);
        r.openTasks++;
        r.openPoints = round1(r.openPoints + (t.estimate ?? 0));
        if (t.dueDate && t.dueDate.getTime() < now.getTime()) r.overdueTasks++;
      }
    }
    for (const d of done) row(d.userId).doneLast30Days = d._count._all;
    const ids = [...rows.keys()].filter((k): k is string => k !== null);
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    for (const u of users) rows.get(u.id)!.name = u.name;
    return [...rows.values()].sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name));
  }

  async workload(m: Membership, projectId: string, now = new Date()): Promise<WorkloadRowDto[]> {
    await this.projects.load(m, projectId);
    return this.workloadFor({ projectId }, now);
  }

  // ---------------------------------------------------------------- overdue

  async overdue(m: Membership, projectId: string, now = new Date()): Promise<OverdueTaskDto[]> {
    const { project } = await this.projects.load(m, projectId);
    const rows = await this.prisma.task.findMany({
      where: { projectId, archivedAt: null, dueDate: { lt: now }, status: { category: { not: 'DONE' } } },
      include: { status: { select: { name: true } }, assignees: { select: { user: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' }, take: 100,
    });
    return rows.map((t) => ({
      id: t.id, key: taskKey(project.key, t.number), title: t.title, dueDate: t.dueDate!, daysOverdue: Math.max(1, Math.floor((now.getTime() - t.dueDate!.getTime()) / DAY)),
      assignees: t.assignees.map((a) => a.user.name), statusName: t.status.name,
    }));
  }

  // ---------------------------------------------------------------- time

  async timeReport(m: Membership, projectId: string, from?: string, to?: string, now = new Date()): Promise<TimeReportDto> {
    const { project } = await this.projects.load(m, projectId);
    const start = from ? new Date(from) : new Date(now.getTime() - 30 * DAY);
    const end = to ? new Date(to) : now;
    const entries = await this.prisma.timeEntry.findMany({
      where: { task: { projectId }, endedAt: { not: null }, startedAt: { gte: start, lte: end } },
      select: { userId: true, minutes: true, task: { select: { id: true, number: true, title: true, timeEstimateMinutes: true } } },
    });
    const users = new Map<string, number>();
    const tasks = new Map<string, { key: string; title: string; estimateMinutes: number | null; spentMinutes: number }>();
    for (const e of entries) {
      users.set(e.userId, (users.get(e.userId) ?? 0) + e.minutes);
      const t = tasks.get(e.task.id) ?? { key: taskKey(project.key, e.task.number), title: e.task.title, estimateMinutes: e.task.timeEstimateMinutes, spentMinutes: 0 };
      t.spentMinutes += e.minutes;
      tasks.set(e.task.id, t);
    }
    const names = users.size ? await this.prisma.user.findMany({ where: { id: { in: [...users.keys()] } }, select: { id: true, name: true } }) : [];

    // Estimates against everything ever logged on tasks that have one.
    const estimated = await this.prisma.task.findMany({ where: { projectId, timeEstimateMinutes: { gt: 0 } }, select: { id: true, timeEstimateMinutes: true } });
    const logged = estimated.length
      ? await this.prisma.timeEntry.groupBy({ by: ['taskId'], where: { taskId: { in: estimated.map((t) => t.id) }, endedAt: { not: null } }, _sum: { minutes: true } })
      : [];

    return {
      from: start, to: end, totalMinutes: [...users.values()].reduce((a, b) => a + b, 0),
      byUser: [...users].map(([userId, minutes]) => ({ userId, name: names.find((n) => n.id === userId)?.name ?? 'Unknown', minutes })).sort((a, b) => b.minutes - a.minutes),
      byTask: [...tasks.values()].sort((a, b) => b.spentMinutes - a.spentMinutes).slice(0, 20),
      estimatedMinutes: estimated.reduce((a, t) => a + (t.timeEstimateMinutes ?? 0), 0),
      actualMinutesOnEstimated: logged.reduce((a, l) => a + (l._sum.minutes ?? 0), 0),
    };
  }

  // ---------------------------------------------------------------- workspace overview

  async overview(m: Membership, now = new Date()): Promise<WorkspaceOverviewDto> {
    const visible: Prisma.ProjectWhereInput = { AND: [{ workspaceId: m.workspaceId }, this.projects.visibleProjects(m), { archivedAt: null }] };
    const projects = await this.prisma.project.findMany({ where: visible, select: { id: true, key: true, name: true }, orderBy: { name: 'asc' } });
    const ids = projects.map((p) => p.id);
    const since = new Date(now.getTime() - 14 * DAY);
    const base = { projectId: { in: ids }, archivedAt: null };
    const [open, done, overdue, created, resolved] = await Promise.all([
      this.prisma.task.groupBy({ by: ['projectId'], where: { ...base, status: { category: { not: 'DONE' } } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['projectId'], where: { ...base, status: { category: 'DONE' } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['projectId'], where: { ...base, dueDate: { lt: now }, status: { category: { not: 'DONE' } } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, completedAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const count = (list: { projectId: string; _count: { _all: number } }[], id: string) => list.find((x) => x.projectId === id)?._count._all ?? 0;
    const rows = projects.map((p) => ({
      projectId: p.id, key: p.key, name: p.name, open: count(open, p.id), done: count(done, p.id), overdue: count(overdue, p.id),
      createdLast14Days: count(created, p.id), resolvedLast14Days: count(resolved, p.id),
    }));
    return {
      projects: rows, workload: await this.workloadFor({ projectId: { in: ids } }, now),
      totalOpen: rows.reduce((n, p) => n + p.open, 0), totalOverdue: rows.reduce((n, p) => n + p.overdue, 0),
    };
  }
}
