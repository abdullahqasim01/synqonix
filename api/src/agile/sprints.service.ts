import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership, Prisma, Sprint } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { ActivityService } from '../tasks/activity.service.js';
import type { BulkResultDto, TaskDetailDto } from '../tasks/dto/task.dto.js';
import { TaskEvents } from '../tasks/events.js';
import { refInclude, summaryInclude, toRefDto } from '../tasks/task-mapper.js';
import { taskKey } from '../tasks/task-ref.js';
import { TasksService } from '../tasks/tasks.service.js';
import { SprintTracker } from './sprint-tracker.service.js';
import type {
  BacklogDto, BacklogQueryDto, CompleteSprintDto, CompleteSprintResultDto, CreateSprintDto, SprintDto,
  SprintStatsDto, SprintSummaryDto, StartSprintDto, UpdateSprintDto,
} from './dto/agile.dto.js';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly tracker: SprintTracker,
    private readonly activity: ActivityService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- helpers ----------

  private async scrumProject(m: Membership, projectId: string, opts: { manage?: boolean; write?: boolean } = {}) {
    const access = await this.projects.load(m, projectId, opts);
    return access.project;
  }

  private assertScrum(project: { methodology: string }) {
    if (project.methodology !== 'SCRUM') throw new BadRequestException('Sprints are only available in Scrum projects');
  }

  private async stats(ids: string[]): Promise<Map<string, SprintStatsDto>> {
    const out = new Map<string, SprintStatsDto>(ids.map((id) => [id, { taskCount: 0, doneCount: 0, points: 0, donePoints: 0 }]));
    if (ids.length === 0) return out;
    const rows = await this.prisma.task.findMany({
      where: { sprintId: { in: ids }, archivedAt: null },
      select: { sprintId: true, estimate: true, status: { select: { category: true } } },
    });
    for (const r of rows) {
      const s = out.get(r.sprintId!)!;
      s.taskCount++;
      s.points += r.estimate ?? 0;
      if (r.status.category === 'DONE') { s.doneCount++; s.donePoints += r.estimate ?? 0; }
    }
    return out;
  }

  private toDto(s: Sprint, stats: SprintStatsDto): SprintDto {
    return {
      id: s.id, number: s.number, name: s.name, goal: s.goal, state: s.state,
      startDate: s.startDate, endDate: s.endDate, capacity: s.capacity,
      startedAt: s.startedAt, completedAt: s.completedAt,
      summary: (s.summary as SprintSummaryDto | null) ?? null, stats, createdAt: s.createdAt,
    };
  }

  private async dtoFor(s: Sprint) {
    return this.toDto(s, (await this.stats([s.id])).get(s.id)!);
  }

  private async load(projectId: string, sprintId: string): Promise<Sprint> {
    const sprint = await this.prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  private checkDates(start: Date | null, end: Date | null) {
    if (start && end && end <= start) throw new BadRequestException('The sprint must end after it starts');
  }

  // ---------- CRUD ----------

  async list(m: Membership, projectId: string, state?: Sprint['state']): Promise<SprintDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.sprint.findMany({ where: { projectId, ...(state ? { state } : {}) } });
    const order = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 } as const;
    rows.sort((a, b) => order[a.state] - order[b.state] || (a.state === 'COMPLETED' ? b.number - a.number : a.number - b.number));
    const stats = await this.stats(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, stats.get(r.id)!));
  }

  async get(m: Membership, projectId: string, sprintId: string): Promise<SprintDto> {
    await this.projects.load(m, projectId);
    return this.dtoFor(await this.load(projectId, sprintId));
  }

  async create(m: Membership, projectId: string, dto: CreateSprintDto): Promise<SprintDto> {
    const project = await this.scrumProject(m, projectId, { manage: true });
    this.assertScrum(project);
    const start = dto.startDate ? new Date(dto.startDate) : null;
    const end = dto.endDate ? new Date(dto.endDate) : null;
    this.checkDates(start, end);
    const { nextSprintNumber } = await this.prisma.project.update({
      where: { id: projectId }, data: { nextSprintNumber: { increment: 1 } }, select: { nextSprintNumber: true },
    });
    const number = nextSprintNumber - 1;
    const sprint = await this.prisma.sprint.create({
      data: {
        projectId, number, name: dto.name?.trim() || `Sprint ${number}`, goal: dto.goal?.trim() || null,
        startDate: start, endDate: end, capacity: dto.capacity ?? null,
      },
    });
    return this.dtoFor(sprint);
  }

  async update(m: Membership, projectId: string, sprintId: string, dto: UpdateSprintDto): Promise<SprintDto> {
    await this.scrumProject(m, projectId, { manage: true });
    const sprint = await this.load(projectId, sprintId);
    if (sprint.state === 'COMPLETED' && (dto.startDate !== undefined || dto.endDate !== undefined || dto.capacity !== undefined)) {
      throw new BadRequestException('A completed sprint can only be renamed or have its goal edited');
    }
    const start = dto.startDate === undefined ? sprint.startDate : dto.startDate ? new Date(dto.startDate) : null;
    const end = dto.endDate === undefined ? sprint.endDate : dto.endDate ? new Date(dto.endDate) : null;
    this.checkDates(start, end);
    if (sprint.state === 'ACTIVE' && (!start || !end)) throw new BadRequestException('An active sprint needs a start and an end date');
    const updated = await this.prisma.sprint.update({
      where: { id: sprintId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.goal !== undefined && { goal: dto.goal?.trim() || null }),
        ...(dto.startDate !== undefined && { startDate: start }),
        ...(dto.endDate !== undefined && { endDate: end }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      },
    });
    return this.dtoFor(updated);
  }

  /** Only planned sprints can be deleted; their tasks return to the backlog. */
  async remove(m: Membership, projectId: string, sprintId: string) {
    await this.scrumProject(m, projectId, { manage: true });
    const sprint = await this.load(projectId, sprintId);
    if (sprint.state !== 'PLANNED') throw new BadRequestException('Only planned sprints can be deleted');
    await this.prisma.sprint.delete({ where: { id: sprintId } });
  }

  // ---------- lifecycle ----------

  async start(m: Membership, projectId: string, sprintId: string, dto: StartSprintDto): Promise<SprintDto> {
    const project = await this.scrumProject(m, projectId, { manage: true });
    this.assertScrum(project);
    const sprint = await this.load(projectId, sprintId);
    if (sprint.state !== 'PLANNED') throw new BadRequestException('Only a planned sprint can be started');

    const start = dto.startDate ? new Date(dto.startDate) : sprint.startDate ?? new Date();
    const end = dto.endDate ? new Date(dto.endDate) : sprint.endDate ?? new Date(start.getTime() + project.sprintDurationDays * DAY);
    this.checkDates(start, end);

    const started = await this.prisma.$transaction(async (tx) => {
      // One running sprint per project; the lock makes "check then start" race-free.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sprint:' + projectId}))`;
      const running = await tx.sprint.findFirst({ where: { projectId, state: 'ACTIVE' } });
      if (running) throw new ConflictException(`${running.name} is still active; complete it first`);
      const scope = await this.tracker.scope(sprintId);
      return tx.sprint.update({
        where: { id: sprintId },
        data: {
          state: 'ACTIVE', startedAt: new Date(), startDate: start, endDate: end,
          capacity: dto.capacity ?? sprint.capacity,
          summary: { committedPoints: scope.scopePoints, committedTasks: scope.scopeTasks } as Prisma.InputJsonValue,
        },
      });
    });
    await this.tracker.record(sprintId, 'START');
    return this.dtoFor(started);
  }

  async complete(m: Membership, projectId: string, sprintId: string, dto: CompleteSprintDto): Promise<CompleteSprintResultDto> {
    const project = await this.scrumProject(m, projectId, { manage: true });
    this.assertScrum(project);
    const sprint = await this.load(projectId, sprintId);
    if (sprint.state !== 'ACTIVE') throw new BadRequestException('Only an active sprint can be completed');

    let target: Sprint | null = null;
    if (dto.carryOver === 'SPRINT') {
      if (!dto.targetSprintId) throw new BadRequestException('Choose the sprint to carry unfinished tasks into');
      target = await this.load(projectId, dto.targetSprintId).catch(() => null);
      if (!target || target.state !== 'PLANNED') throw new BadRequestException('Unfinished tasks can only move into a planned sprint');
    }

    // Final point of the burndown, taken before anything moves.
    await this.tracker.record(sprintId, 'COMPLETE', { allowEnded: true });

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.carryOver === 'NEXT_SPRINT') {
        target = await tx.sprint.findFirst({ where: { projectId, state: 'PLANNED' }, orderBy: { number: 'asc' } });
        if (!target) {
          const { nextSprintNumber } = await tx.project.update({
            where: { id: projectId }, data: { nextSprintNumber: { increment: 1 } }, select: { nextSprintNumber: true },
          });
          target = await tx.sprint.create({
            data: { projectId, number: nextSprintNumber - 1, name: `Sprint ${nextSprintNumber - 1}` },
          });
        }
      }

      const tasks = await tx.task.findMany({
        where: { sprintId }, include: { status: { select: { category: true } } },
      });
      const entries = await tx.sprintTask.findMany({ where: { sprintId } });
      const now = new Date();
      const done = tasks.filter((t) => !t.archivedAt && t.status.category === 'DONE');
      const unfinished = tasks.filter((t) => !t.archivedAt && t.status.category !== 'DONE');
      const archived = tasks.filter((t) => t.archivedAt);
      const sum = (list: { estimate: number | null }[]) => list.reduce((a, t) => a + (t.estimate ?? 0), 0);

      await tx.sprintTask.updateMany({
        where: { sprintId, taskId: { in: done.map((t) => t.id) }, removedAt: null }, data: { outcome: 'COMPLETED' },
      });
      for (const t of unfinished) {
        await tx.sprintTask.updateMany({
          where: { sprintId, taskId: t.id, removedAt: null }, data: { outcome: 'CARRIED_OVER', removedAt: now },
        });
        if (target) await tx.sprintTask.create({ data: { sprintId: target.id, taskId: t.id, estimateAtAdd: t.estimate } });
        await tx.task.update({ where: { id: t.id }, data: { sprintId: target?.id ?? null } });
        await this.activity.record(tx, t.id, m.userId, [{ type: 'updated', field: 'sprint', from: sprint.name, to: target?.name ?? null }]);
      }
      for (const t of archived) {
        await tx.sprintTask.updateMany({ where: { sprintId, taskId: t.id, removedAt: null }, data: { outcome: 'REMOVED', removedAt: now } });
        await tx.task.update({ where: { id: t.id }, data: { sprintId: null } });
      }

      const committed = (sprint.summary as { committedPoints?: number; committedTasks?: number } | null) ?? {};
      const afterStart = entries.filter((e) => e.addedAfterStart);
      const removedDuring = entries.filter((e) => e.outcome === 'REMOVED' && e.removedAt && sprint.startedAt && e.removedAt >= sprint.startedAt);
      const summary: SprintSummaryDto = {
        committedPoints: committed.committedPoints ?? 0,
        committedTasks: committed.committedTasks ?? 0,
        addedPoints: afterStart.reduce((a, e) => a + (e.estimateAtAdd ?? 0), 0),
        removedPoints: removedDuring.reduce((a, e) => a + (e.estimateAtAdd ?? 0), 0),
        completedPoints: sum(done),
        completedTasks: done.length,
        carriedOverPoints: sum(unfinished),
        carriedOverTasks: unfinished.length,
      };
      const completed = await tx.sprint.update({
        where: { id: sprintId }, data: { state: 'COMPLETED', completedAt: now, summary: summary as unknown as Prisma.InputJsonValue },
      });
      return { completed, target, moved: unfinished };
    });

    // Boards and backlogs of other clients should notice the moves.
    const keyOf = new Map<string, number>();
    for (const t of result.moved) keyOf.set(t.id, t.number);
    for (const [id, number] of keyOf) {
      this.events.emit(TaskEvents.updated, {
        workspaceId: m.workspaceId, projectId, taskId: id, taskKey: taskKey(project.key, number),
        actorId: m.userId, fields: ['sprint'],
      });
    }
    const [done, next] = await Promise.all([this.dtoFor(result.completed), result.target ? this.dtoFor(result.target) : null]);
    return { sprint: done, nextSprint: next, carriedOverCount: result.moved.length };
  }

  // ---------- planning ----------

  /** Adds tasks to a sprint (planned or active). Moves them if they were in another sprint. */
  async addTasks(m: Membership, projectId: string, sprintId: string, taskIds: string[]): Promise<BulkResultDto> {
    await this.projects.load(m, projectId, { write: true });
    const sprint = await this.load(projectId, sprintId);
    if (sprint.state === 'COMPLETED') throw new BadRequestException('That sprint is already completed');
    return this.tasks.bulkUpdate(m, taskIds, { sprintId });
  }

  async removeTask(m: Membership, projectId: string, sprintId: string, ref: string): Promise<TaskDetailDto> {
    await this.projects.load(m, projectId, { write: true });
    await this.load(projectId, sprintId);
    const task = await this.tasks.get(m, ref);
    if (task.sprint?.id !== sprintId) throw new NotFoundException('That task is not in this sprint');
    return this.tasks.update(m, ref, { sprintId: null });
  }

  /** Backlog page data: planned and active sprints with their tasks, then the unplanned backlog. */
  async backlog(m: Membership, projectId: string, q: BacklogQueryDto): Promise<BacklogDto> {
    const { project } = await this.projects.load(m, projectId);
    const base = await this.tasks.buildWhere(m, { ...q, projectId, excludeSubtasks: true });
    const limit = Math.min(q.limit ?? 100, 200);
    const order: Prisma.TaskOrderByWithRelationInput[] = [{ position: 'asc' }, { id: 'asc' }];

    const sprints = await this.prisma.sprint.findMany({ where: { projectId, state: { in: ['ACTIVE', 'PLANNED'] } } });
    sprints.sort((a, b) => (a.state === b.state ? a.number - b.number : a.state === 'ACTIVE' ? -1 : 1));
    const stats = await this.stats(sprints.map((s) => s.id));

    const sections = await Promise.all(
      sprints.map(async (s) => {
        const rows = await this.prisma.task.findMany({
          where: { AND: [base, { sprintId: s.id }] }, include: summaryInclude, orderBy: order, take: 500,
        });
        return { sprint: this.toDto(s, stats.get(s.id)!), tasks: await this.tasks.toDtos(rows) };
      }),
    );

    const backlogWhere: Prisma.TaskWhereInput = {
      AND: [
        base, { sprintId: null }, { type: { not: 'EPIC' } },
        ...(q.includeDone ? [] : [{ status: { category: { not: 'DONE' as const } } }]),
      ],
    };
    const [rows, total, pts] = await Promise.all([
      this.prisma.task.findMany({ where: backlogWhere, include: summaryInclude, orderBy: order, take: limit }),
      this.prisma.task.count({ where: backlogWhere }),
      this.prisma.task.aggregate({ where: backlogWhere, _sum: { estimate: true } }),
    ]);
    const epics = await this.prisma.task.findMany({
      where: { projectId: project.id, type: 'EPIC', archivedAt: null }, include: refInclude, orderBy: { number: 'asc' }, take: 100,
    });
    return {
      sprints: sections,
      backlog: { tasks: await this.tasks.toDtos(rows), total, points: pts._sum.estimate ?? 0 },
      epics: epics.map(toRefDto),
    };
  }
}
