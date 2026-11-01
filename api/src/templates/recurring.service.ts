import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Membership, RecurringTask } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import { TasksService } from '../tasks/tasks.service.js';
import type { CreateRecurringDto, RecurringDto, UpdateRecurringDto } from './dto/templates.dto.js';
import { nextRunAfter, renderTitle } from './recurrence.js';

const FIVE_YEARS = 5 * 365 * 86_400_000;

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  private async toDto(r: RecurringTask): Promise<RecurringDto> {
    const last = r.lastTaskId ? await this.prisma.task.findUnique({ where: { id: r.lastTaskId }, select: { number: true, project: { select: { key: true } } } }) : null;
    return {
      id: r.id, name: r.name, title: r.title, description: r.description, type: r.type, priority: r.priority, assigneeIds: r.assigneeIds as string[],
      labelIds: r.labelIds as string[], frequency: r.frequency, interval: r.interval, startsAt: r.startsAt, nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt,
      lastTaskKey: last ? taskKey(last.project.key, last.number) : null, active: r.active,
    };
  }

  async list(m: Membership, projectId: string): Promise<RecurringDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.recurringTask.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  private checkStart(startsAt: Date, now: Date) {
    if (startsAt.getTime() > now.getTime() + FIVE_YEARS) throw new BadRequestException('Start date is too far in the future');
  }

  private async validate(workspaceId: string, projectId: string, assigneeIds?: string[], labelIds?: string[]) {
    const people = [...new Set(assigneeIds ?? [])];
    if (people.length && (await this.prisma.membership.count({ where: { workspaceId, userId: { in: people } } })) !== people.length) throw new BadRequestException('Everyone must be a member of this workspace');
    const labels = [...new Set(labelIds ?? [])];
    if (labels.length && (await this.prisma.label.count({ where: { projectId, id: { in: labels } } })) !== labels.length) throw new BadRequestException('Unknown label for this project');
    return { people, labels };
  }

  async create(m: Membership, projectId: string, dto: CreateRecurringDto, now = new Date()): Promise<RecurringDto> {
    const { project } = await this.projects.load(m, projectId, { manage: true });
    if (project.archivedAt) throw new BadRequestException('This project is archived');
    const startsAt = new Date(dto.startsAt);
    this.checkStart(startsAt, now);
    const { people, labels } = await this.validate(m.workspaceId, projectId, dto.assigneeIds, dto.labelIds);
    const rule = { frequency: dto.frequency, interval: dto.interval, startsAt };
    // A start in the past means "from the next slot", not "catch up on everything".
    const nextRunAt = startsAt.getTime() > now.getTime() ? startsAt : nextRunAfter(rule, now);
    return this.toDto(await this.prisma.recurringTask.create({
      data: {
        projectId, name: dto.name.trim(), title: dto.title.trim(), description: dto.description?.trim() || null, type: dto.type ?? 'TASK', priority: dto.priority ?? 'NONE',
        assigneeIds: people, labelIds: labels, ...rule, nextRunAt, createdById: m.userId,
      },
    }));
  }

  private async load(projectId: string, id: string) {
    const r = await this.prisma.recurringTask.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Recurring task not found');
    return r;
  }

  async update(m: Membership, projectId: string, id: string, dto: UpdateRecurringDto, now = new Date()): Promise<RecurringDto> {
    await this.projects.load(m, projectId, { manage: true });
    const current = await this.load(projectId, id);
    const { people, labels } = await this.validate(m.workspaceId, projectId, dto.assigneeIds, dto.labelIds);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    this.checkStart(startsAt, now);
    const rule = { frequency: dto.frequency ?? current.frequency, interval: dto.interval ?? current.interval, startsAt };
    const schedule = dto.frequency !== undefined || dto.interval !== undefined || dto.startsAt !== undefined || dto.active === true;
    return this.toDto(await this.prisma.recurringTask.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }), ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }), ...(dto.type && { type: dto.type }), ...(dto.priority && { priority: dto.priority }),
        ...(dto.assigneeIds && { assigneeIds: people }), ...(dto.labelIds && { labelIds: labels }), ...rule,
        ...(dto.active !== undefined && { active: dto.active }),
        ...(schedule && { nextRunAt: startsAt.getTime() > now.getTime() ? startsAt : nextRunAfter(rule, now) }),
      },
    }));
  }

  async remove(m: Membership, projectId: string, id: string) {
    await this.projects.load(m, projectId, { manage: true });
    await this.load(projectId, id);
    await this.prisma.recurringTask.delete({ where: { id } });
  }

  /**
   * Creates the tasks that are due. Each rule is claimed with a compare-and-set on its next run
   * time, so two API instances (or a slow run overlapping the next) never create a task twice.
   * A rule that missed several runs creates one task, not a backlog.
   */
  async runDue(now = new Date()): Promise<number> {
    const due = await this.prisma.recurringTask.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 100, include: { project: true } });
    let created = 0;
    for (const rule of due) {
      const claimed = await this.prisma.recurringTask.updateMany({ where: { id: rule.id, nextRunAt: rule.nextRunAt }, data: { nextRunAt: nextRunAfter(rule, now), lastRunAt: now } });
      if (claimed.count === 0) continue;
      const owner = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: rule.project.workspaceId, userId: rule.createdById } } });
      if (!owner || rule.project.archivedAt) {
        await this.prisma.recurringTask.update({ where: { id: rule.id }, data: { active: false } });
        continue;
      }
      try {
        const members = await this.prisma.membership.findMany({ where: { workspaceId: owner.workspaceId, userId: { in: rule.assigneeIds as string[] } }, select: { userId: true } });
        const labels = await this.prisma.label.findMany({ where: { projectId: rule.projectId, id: { in: rule.labelIds as string[] } }, select: { id: true } });
        const task = await this.tasks.create(owner, rule.projectId, {
          title: renderTitle(rule.title, now), description: rule.description ?? undefined, type: rule.type === 'SUBTASK' ? 'TASK' : rule.type, priority: rule.priority,
          assigneeIds: members.map((x) => x.userId), labelIds: labels.map((l) => l.id),
        });
        await this.prisma.recurringTask.update({ where: { id: rule.id }, data: { lastTaskId: task.id } });
        created++;
      } catch (err) {
        this.logger.error(`Recurring task "${rule.name}" failed: ${(err as Error).message}`);
      }
    }
    return created;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    try { await this.runDue(); } catch (err) { this.logger.error('Recurring tasks failed', err as Error); }
  }
}
