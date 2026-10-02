import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { AutomationRule, Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { ActivityService } from '../tasks/activity.service.js';
import { CommentsService } from '../tasks/comments.service.js';
import { TaskEvents, type TaskEventBase } from '../tasks/events.js';
import { TasksService } from '../tasks/tasks.service.js';
import { automationContext } from './automation-context.js';
import type { AutomationActionDto, AutomationConditionsDto, AutomationDto, CreateAutomationDto, UpdateAutomationDto } from './dto/automation.dto.js';

const MAX_RULES_PER_PROJECT = 25;
const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const toDto = (r: AutomationRule): AutomationDto => ({
  id: r.id, name: r.name, enabled: r.enabled, trigger: r.trigger, triggerStatusId: r.triggerStatusId, conditions: r.conditions as AutomationConditionsDto,
  actions: r.actions as unknown as AutomationActionDto[], runCount: r.runCount, lastRunAt: r.lastRunAt, lastError: r.lastError,
});

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly comments: CommentsService,
    private readonly activity: ActivityService,
  ) {}

  // ---------------------------------------------------------------- management

  async list(m: Membership, projectId: string): Promise<AutomationDto[]> {
    await this.projects.load(m, projectId);
    return (await this.prisma.automationRule.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })).map(toDto);
  }

  /** Everything a rule points at must exist in this project (or workspace, for people). */
  private async validate(m: Membership, projectId: string, input: { triggerStatusId?: string | null; conditions?: AutomationConditionsDto; actions?: AutomationActionDto[] }) {
    if (input.triggerStatusId && !(await this.prisma.projectStatus.findFirst({ where: { id: input.triggerStatusId, projectId } }))) throw new BadRequestException('Unknown status for this project');
    const labelIds = [...(input.conditions?.labelIds ?? []), ...(input.actions ?? []).filter((a) => a.type === 'ADD_LABEL').map((a) => a.value)];
    if (labelIds.length && (await this.prisma.label.count({ where: { projectId, id: { in: [...new Set(labelIds)] } } })) !== new Set(labelIds).size) throw new BadRequestException('Unknown label for this project');
    for (const a of input.actions ?? []) {
      if (a.type === 'SET_PRIORITY' && !PRIORITIES.includes(a.value)) throw new BadRequestException(`"${a.value}" is not a priority`);
      if (a.type === 'MOVE_TO_STATUS' && !(await this.prisma.projectStatus.findFirst({ where: { id: a.value, projectId } }))) throw new BadRequestException('Unknown status for this project');
      if (a.type === 'ASSIGN' && !(await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: a.value } } }))) throw new BadRequestException('Everyone must be a member of this workspace');
    }
  }

  async create(m: Membership, projectId: string, dto: CreateAutomationDto): Promise<AutomationDto> {
    const { project } = await this.projects.load(m, projectId, { manage: true });
    if (project.archivedAt) throw new BadRequestException('This project is archived');
    if (dto.trigger !== 'STATUS_CHANGED' && dto.triggerStatusId) throw new BadRequestException('Only "status changed" rules can name a status');
    if ((await this.prisma.automationRule.count({ where: { projectId } })) >= MAX_RULES_PER_PROJECT) throw new BadRequestException(`A project can have at most ${MAX_RULES_PER_PROJECT} automation rules`);
    await this.validate(m, projectId, dto);
    return toDto(await this.prisma.automationRule.create({
      data: {
        projectId, name: dto.name.trim(), trigger: dto.trigger, triggerStatusId: dto.triggerStatusId ?? null, createdById: m.userId,
        conditions: (dto.conditions ?? {}) as Prisma.InputJsonValue, actions: dto.actions as unknown as Prisma.InputJsonValue,
      },
    }));
  }

  private async load(projectId: string, id: string) {
    const r = await this.prisma.automationRule.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Automation rule not found');
    return r;
  }

  async update(m: Membership, projectId: string, id: string, dto: UpdateAutomationDto): Promise<AutomationDto> {
    await this.projects.load(m, projectId, { manage: true });
    const current = await this.load(projectId, id);
    const trigger = dto.trigger ?? current.trigger;
    const triggerStatusId = dto.triggerStatusId !== undefined ? dto.triggerStatusId : current.triggerStatusId;
    if (trigger !== 'STATUS_CHANGED' && triggerStatusId) throw new BadRequestException('Only "status changed" rules can name a status');
    await this.validate(m, projectId, { triggerStatusId: dto.triggerStatusId, conditions: dto.conditions, actions: dto.actions });
    return toDto(await this.prisma.automationRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }), trigger, triggerStatusId,
        ...(dto.conditions && { conditions: dto.conditions as Prisma.InputJsonValue }), ...(dto.actions && { actions: dto.actions as unknown as Prisma.InputJsonValue }),
        // Turning a rule back on also takes it over: it runs as whoever enabled it.
        ...(dto.enabled !== undefined && { enabled: dto.enabled, ...(dto.enabled ? { lastError: null, createdById: m.userId } : {}) }),
      },
    }));
  }

  async remove(m: Membership, projectId: string, id: string) {
    await this.projects.load(m, projectId, { manage: true });
    await this.load(projectId, id);
    await this.prisma.automationRule.delete({ where: { id } });
  }

  // ---------------------------------------------------------------- running

  @OnEvent(TaskEvents.created)
  onCreated(e: TaskEventBase) { return this.run('TASK_CREATED', e); }

  @OnEvent(TaskEvents.statusChanged)
  onStatusChanged(e: TaskEventBase) { return this.run('STATUS_CHANGED', e); }

  private matches(rule: AutomationRule, task: { statusId: string; type: string; priority: string; labels: { labelId: string }[] }) {
    if (rule.trigger === 'STATUS_CHANGED' && rule.triggerStatusId && task.statusId !== rule.triggerStatusId) return false;
    const c = rule.conditions as AutomationConditionsDto;
    if (c.types?.length && !c.types.includes(task.type as never)) return false;
    if (c.priorities?.length && !c.priorities.includes(task.priority as never)) return false;
    if (c.labelIds?.length && !task.labels.some((l) => c.labelIds!.includes(l.labelId))) return false;
    return true;
  }

  /** Runs every matching rule for a task event. Rules made to run by another rule's changes are skipped. */
  async run(trigger: AutomationRule['trigger'], e: TaskEventBase): Promise<number> {
    if (automationContext.getStore()) return 0;
    const rules = await this.prisma.automationRule.findMany({ where: { projectId: e.projectId, trigger, enabled: true }, orderBy: { createdAt: 'asc' } });
    if (rules.length === 0) return 0;
    // Decide which rules apply to the task as it was when the event happened, before any of them changes it.
    const before = await this.prisma.task.findUnique({ where: { id: e.taskId }, include: { labels: true } });
    if (!before || before.archivedAt) return 0;
    let ran = 0;
    for (const rule of rules.filter((r) => this.matches(r, before))) {
      try {
        if (await this.apply(rule, e)) ran++;
      } catch (err) {
        const message = (err as Error).message.slice(0, 300);
        this.logger.warn(`Automation "${rule.name}" failed: ${message}`);
        await this.prisma.automationRule.update({ where: { id: rule.id }, data: { lastError: message } }).catch(() => undefined);
      }
    }
    return ran;
  }

  private async apply(rule: AutomationRule, e: TaskEventBase): Promise<boolean> {
    const task = await this.prisma.task.findUnique({ where: { id: e.taskId }, include: { labels: true, assignees: true } });
    if (!task || task.archivedAt) return false;
    const owner = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: e.workspaceId, userId: rule.createdById } } });
    if (!owner) {
      await this.prisma.automationRule.update({ where: { id: rule.id }, data: { enabled: false, lastError: 'The person who set this rule up left the workspace' } });
      return false;
    }
    const actions = rule.actions as unknown as AutomationActionDto[];
    const update: { priority?: never; assigneeIds?: string[]; labelIds?: string[]; statusId?: string } = {};
    let comment: string | null = null;
    for (const a of actions) {
      if (a.type === 'SET_PRIORITY' && a.value !== task.priority) update.priority = a.value as never;
      if (a.type === 'ASSIGN' && !task.assignees.some((x) => x.userId === a.value)) update.assigneeIds = [...new Set([...(update.assigneeIds ?? task.assignees.map((x) => x.userId)), a.value])];
      if (a.type === 'ADD_LABEL' && !task.labels.some((l) => l.labelId === a.value)) update.labelIds = [...new Set([...(update.labelIds ?? task.labels.map((l) => l.labelId)), a.value])];
      if (a.type === 'MOVE_TO_STATUS' && a.value !== task.statusId) update.statusId = a.value;
      if (a.type === 'COMMENT') comment = a.value;
    }
    await automationContext.run({ ruleId: rule.id }, async () => {
      if (Object.keys(update).length > 0) await this.tasks.update(owner, e.taskKey, update);
      if (comment) await this.comments.create(owner, e.taskKey, comment);
      await this.prisma.$transaction((tx) => this.activity.record(tx, e.taskId, null, [{ type: 'automation', to: rule.name }]));
    });
    await this.prisma.automationRule.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), lastError: null } });
    return true;
  }
}
