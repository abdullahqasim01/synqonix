import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Prisma, TaskTemplate } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import type { TaskDetailDto } from '../tasks/dto/task.dto.js';
import { TasksService } from '../tasks/tasks.service.js';
import type {
  CreateFromTemplateDto, CreateTemplateDto, TemplateChecklistDto, TemplateDto, UpdateTemplateDto,
} from './dto/templates.dto.js';

const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

const toDto = (t: TaskTemplate): TemplateDto => ({
  id: t.id, name: t.name, title: t.title, description: t.description, type: t.type, priority: t.priority,
  labelIds: t.labelIds as string[], checklists: t.checklists as unknown as TemplateChecklistDto[], estimate: t.estimate, timeEstimateMinutes: t.timeEstimateMinutes,
});

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly tasks: TasksService,
  ) {}

  async list(m: Membership, projectId: string): Promise<TemplateDto[]> {
    await this.projects.load(m, projectId);
    return (await this.prisma.taskTemplate.findMany({ where: { projectId }, orderBy: { name: 'asc' } })).map(toDto);
  }

  private async assertLabels(projectId: string, ids: string[] | undefined) {
    const unique = [...new Set(ids ?? [])];
    if (unique.length && (await this.prisma.label.count({ where: { projectId, id: { in: unique } } })) !== unique.length) {
      throw new BadRequestException('Unknown label for this project');
    }
    return unique;
  }

  async create(m: Membership, projectId: string, dto: CreateTemplateDto): Promise<TemplateDto> {
    await this.projects.load(m, projectId, { manage: true });
    const labelIds = await this.assertLabels(projectId, dto.labelIds);
    try {
      return toDto(await this.prisma.taskTemplate.create({
        data: {
          projectId, name: dto.name.trim(), title: dto.title.trim(), description: dto.description?.trim() || null, type: dto.type ?? 'TASK',
          priority: dto.priority ?? 'NONE', labelIds, checklists: (dto.checklists ?? []) as unknown as Prisma.InputJsonValue,
          estimate: dto.estimate ?? null, timeEstimateMinutes: dto.timeEstimateMinutes ?? null, createdById: m.userId,
        },
      }));
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A template with this name already exists');
      throw e;
    }
  }

  /** Saves what a task looks like now (title, description, type, priority, labels, checklists as unticked) as a template. */
  async fromTask(m: Membership, projectId: string, ref: string, name: string): Promise<TemplateDto> {
    await this.projects.load(m, projectId, { manage: true });
    const { task } = await this.taskAccess.load(m, ref);
    if (task.projectId !== projectId) throw new NotFoundException('Task not found');
    const full = await this.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { labels: true, checklists: { include: { items: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } } },
    });
    return this.create(m, projectId, {
      name, title: full.title, description: full.description ?? undefined, type: full.type === 'SUBTASK' ? 'TASK' : full.type, priority: full.priority,
      labelIds: full.labels.map((l) => l.labelId), estimate: full.estimate ?? undefined, timeEstimateMinutes: full.timeEstimateMinutes ?? undefined,
      checklists: full.checklists.map((c) => ({ title: c.title, items: c.items.map((i) => i.text) })),
    });
  }

  private async load(projectId: string, id: string) {
    const t = await this.prisma.taskTemplate.findFirst({ where: { id, projectId } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async update(m: Membership, projectId: string, id: string, dto: UpdateTemplateDto): Promise<TemplateDto> {
    await this.projects.load(m, projectId, { manage: true });
    await this.load(projectId, id);
    const labelIds = dto.labelIds ? await this.assertLabels(projectId, dto.labelIds) : undefined;
    try {
      return toDto(await this.prisma.taskTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }), ...(dto.title !== undefined && { title: dto.title.trim() }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }), ...(dto.type && { type: dto.type }),
          ...(dto.priority && { priority: dto.priority }), ...(labelIds && { labelIds }),
          ...(dto.checklists && { checklists: dto.checklists as unknown as Prisma.InputJsonValue }),
          ...(dto.estimate !== undefined && { estimate: dto.estimate }), ...(dto.timeEstimateMinutes !== undefined && { timeEstimateMinutes: dto.timeEstimateMinutes }),
        },
      }));
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A template with this name already exists');
      throw e;
    }
  }

  async remove(m: Membership, projectId: string, id: string) {
    await this.projects.load(m, projectId, { manage: true });
    await this.load(projectId, id);
    await this.prisma.taskTemplate.delete({ where: { id } });
  }

  /** A new task from the template, with the template's checklists. Anyone who may create tasks in the project can use it. */
  async createTask(m: Membership, projectId: string, id: string, dto: CreateFromTemplateDto): Promise<TaskDetailDto> {
    const template = await this.load(projectId, id);
    // Labels deleted since the template was saved are simply left out.
    const labelIds = (await this.prisma.label.findMany({ where: { projectId, id: { in: template.labelIds as string[] } }, select: { id: true } })).map((l) => l.id);
    const created = await this.tasks.create(m, projectId, {
      title: dto.title ?? template.title, description: dto.description ?? template.description ?? undefined, type: template.type === 'SUBTASK' ? 'TASK' : template.type,
      priority: template.priority, labelIds, ...(template.estimate !== null ? { estimate: template.estimate } : {}),
      ...(template.timeEstimateMinutes !== null ? { timeEstimateMinutes: template.timeEstimateMinutes } : {}),
      ...(dto.assigneeIds ? { assigneeIds: dto.assigneeIds } : {}), ...(dto.statusId ? { statusId: dto.statusId } : {}), ...(dto.dueDate ? { dueDate: dto.dueDate } : {}),
    });
    const lists = template.checklists as unknown as TemplateChecklistDto[];
    if (lists.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const [i, list] of lists.entries()) {
          await tx.checklist.create({ data: { taskId: created.id, title: list.title, position: i, items: { create: list.items.map((text, position) => ({ text, position })) } } });
        }
      });
      return this.tasks.detail(m, created.id);
    }
    return created;
  }
}
