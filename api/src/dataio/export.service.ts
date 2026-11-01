import { BadRequestException, Injectable } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import { timeSpentByTask } from '../tasks/time-spent.js';
import { toCsv } from './csv.js';

const MAX_ROWS = 20_000;

export const EXPORT_HEADERS = [
  'Key', 'Type', 'Title', 'Description', 'Status', 'Priority', 'Assignees', 'Reporter', 'Labels', 'Estimate', 'Time estimate minutes',
  'Time spent minutes', 'Start date', 'Due date', 'Sprint', 'Release', 'Milestone', 'Parent', 'Created', 'Updated', 'Completed',
] as const;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Everything a task export needs for a project the caller can see. */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  async rows(m: Membership, projectId: string) {
    const { project } = await this.projects.load(m, projectId);
    const tasks = await this.prisma.task.findMany({
      where: { projectId, archivedAt: null },
      include: {
        status: { select: { name: true } }, assignees: { include: { user: { select: { name: true } } } },
        labels: { include: { label: { select: { name: true } } } }, sprint: { select: { name: true } }, release: { select: { name: true } },
        milestone: { select: { name: true } }, parent: { select: { number: true } },
      },
      orderBy: { number: 'asc' }, take: MAX_ROWS + 1,
    });
    if (tasks.length > MAX_ROWS) throw new BadRequestException(`Too many tasks to export at once (limit ${MAX_ROWS})`);
    const reporters = await this.prisma.user.findMany({ where: { id: { in: [...new Set(tasks.map((t) => t.reporterId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const spent = await timeSpentByTask(this.prisma, tasks.map((t) => t.id));
    return {
      project,
      records: tasks.map((t) => ({
        key: taskKey(project.key, t.number), type: t.type, title: t.title, description: t.description, status: t.status.name, priority: t.priority,
        assignees: t.assignees.map((a) => a.user.name), reporter: reporters.find((r) => r.id === t.reporterId)?.name ?? null,
        labels: t.labels.map((l) => l.label.name), estimate: t.estimate, timeEstimateMinutes: t.timeEstimateMinutes, timeSpentMinutes: spent.get(t.id) ?? 0,
        startDate: iso(t.startDate), dueDate: iso(t.dueDate), sprint: t.sprint?.name ?? null, release: t.release?.name ?? null, milestone: t.milestone?.name ?? null,
        parent: t.parent ? taskKey(project.key, t.parent.number) : null, created: iso(t.createdAt), updated: iso(t.updatedAt), completed: iso(t.completedAt),
      })),
    };
  }

  async csv(m: Membership, projectId: string) {
    const { project, records } = await this.rows(m, projectId);
    const body = toCsv([
      [...EXPORT_HEADERS],
      ...records.map((r) => [
        r.key, r.type, r.title, r.description, r.status, r.priority, r.assignees.join('; '), r.reporter, r.labels.join('; '), r.estimate,
        r.timeEstimateMinutes, r.timeSpentMinutes, r.startDate, r.dueDate, r.sprint, r.release, r.milestone, r.parent, r.created, r.updated, r.completed,
      ]),
    ]);
    return { filename: `${project.key.toLowerCase()}-tasks.csv`, contentType: 'text/csv; charset=utf-8', body };
  }

  async json(m: Membership, projectId: string) {
    const { project, records } = await this.rows(m, projectId);
    const body = JSON.stringify({ project: { key: project.key, name: project.name }, exportedAt: new Date().toISOString(), tasks: records }, null, 2);
    return { filename: `${project.key.toLowerCase()}-tasks.json`, contentType: 'application/json; charset=utf-8', body };
  }
}
