import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Membership, Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from './project-access.service.js';
import { PROJECT_TEMPLATES } from './project-templates.js';
import type {
  CreateLabelDto, CreateProjectDto, CreateStatusDto, LabelDto, ProjectDetailDto, ProjectDto,
  ProjectMemberDto, SetProjectMemberDto, StatusDto, UpdateLabelDto, UpdateProjectDto, UpdateStatusDto,
} from './dto/project.dto.js';

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccessService,
  ) {}

  private toDto(p: Project, canManage: boolean): ProjectDto {
    return {
      id: p.id, workspaceId: p.workspaceId, key: p.key, name: p.name, description: p.description,
      leadId: p.leadId, visibility: p.visibility, template: p.template,
      methodology: p.methodology, estimationUnit: p.estimationUnit,
      sprintDurationDays: p.sprintDurationDays, definitionOfDone: p.definitionOfDone,
      archived: p.archivedAt !== null, createdAt: p.createdAt, canManage,
    };
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string) {
    const ok = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!ok) throw new BadRequestException('User is not a member of this workspace');
  }

  // ---------- projects ----------

  async list(m: Membership, includeArchived = false): Promise<ProjectDto[]> {
    const visible = this.access.visibleProjects(m);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: m.workspaceId, ...visible, ...(includeArchived ? {} : { archivedAt: null }) },
      include: { members: { where: { userId: m.userId } } },
      orderBy: { name: 'asc' },
    });
    return projects.map((p) => this.toDto(p, this.access.canManage(m, p, p.members[0] ?? null)));
  }

  async get(m: Membership, projectId: string): Promise<ProjectDetailDto> {
    const { project, manage } = await this.access.load(m, projectId);
    const [statuses, labels] = await Promise.all([this.listStatuses(project.id), this.listLabels(project.id)]);
    return { ...this.toDto(project, manage), statuses, labels };
  }

  async create(m: Membership, dto: CreateProjectDto): Promise<ProjectDetailDto> {
    if (dto.leadId) await this.assertWorkspaceMember(m.workspaceId, dto.leadId);
    const leadId = dto.leadId ?? m.userId;
    const template = dto.template ?? 'BLANK';
    const seed = PROJECT_TEMPLATES[template];

    let project: Project;
    try {
      project = await this.prisma.project.create({
        data: {
          workspaceId: m.workspaceId, key: dto.key, name: dto.name.trim(),
          description: dto.description?.trim() || null,
          visibility: dto.visibility ?? 'WORKSPACE', template, leadId,
          methodology: dto.methodology ?? (template === 'SCRUM' ? 'SCRUM' : 'KANBAN'),
          estimationUnit: dto.estimationUnit ?? 'POINTS',
          statuses: { create: seed.statuses.map((s, position) => ({ ...s, position })) },
          labels: { create: seed.labels },
          members: {
            create: [
              { userId: m.userId, role: 'ADMIN' as const },
              ...(leadId !== m.userId ? [{ userId: leadId, role: 'ADMIN' as const }] : []),
            ],
          },
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`A project with key ${dto.key} already exists`);
      throw e;
    }
    await this.audit.log({
      workspaceId: m.workspaceId, actorId: m.userId, action: 'project.created',
      entityType: 'project', entityId: project.id, metadata: { key: project.key, template },
    });
    return this.get(m, project.id);
  }

  async update(m: Membership, projectId: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    const { project } = await this.access.load(m, projectId, { manage: true });
    if (dto.leadId) await this.assertWorkspaceMember(m.workspaceId, dto.leadId);
    if (dto.methodology && dto.methodology !== project.methodology) {
      const active = await this.prisma.sprint.count({ where: { projectId: project.id, state: 'ACTIVE' } });
      if (active > 0) throw new BadRequestException('Complete the active sprint before changing the methodology');
    }
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        ...(dto.leadId !== undefined && { leadId: dto.leadId }),
        ...(dto.methodology !== undefined && { methodology: dto.methodology }),
        ...(dto.estimationUnit !== undefined && { estimationUnit: dto.estimationUnit }),
        ...(dto.sprintDurationDays !== undefined && { sprintDurationDays: dto.sprintDurationDays }),
        ...(dto.definitionOfDone !== undefined && { definitionOfDone: dto.definitionOfDone?.trim() || null }),
      },
    });
    // A new lead of a private project needs to be able to see it.
    if (dto.leadId) {
      await this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: dto.leadId } },
        create: { projectId, userId: dto.leadId, role: 'ADMIN' },
        update: {},
      });
    }
    await this.audit.log({
      workspaceId: m.workspaceId, actorId: m.userId, action: 'project.updated',
      entityType: 'project', entityId: projectId,
    });
    const pm = await this.access.projectRole(updated.id, m.userId);
    return this.toDto(updated, this.access.canManage(m, updated, pm));
  }

  async setArchived(m: Membership, projectId: string, archived: boolean): Promise<ProjectDto> {
    const { project } = await this.access.load(m, projectId, { manage: true });
    const updated = await this.prisma.project.update({
      where: { id: project.id }, data: { archivedAt: archived ? new Date() : null },
    });
    await this.audit.log({
      workspaceId: m.workspaceId, actorId: m.userId, action: archived ? 'project.archived' : 'project.restored',
      entityType: 'project', entityId: projectId,
    });
    return this.toDto(updated, true);
  }

  async remove(m: Membership, projectId: string) {
    const { project } = await this.access.load(m, projectId);
    await this.prisma.project.delete({ where: { id: project.id } });
    await this.audit.log({
      workspaceId: m.workspaceId, actorId: m.userId, action: 'project.deleted',
      entityType: 'project', entityId: projectId, metadata: { key: project.key },
    });
  }

  // ---------- project members ----------

  async listMembers(m: Membership, projectId: string): Promise<ProjectMemberDto[]> {
    await this.access.load(m, projectId);
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId }, include: { user: true }, orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email, role: r.role }));
  }

  async setMember(m: Membership, projectId: string, dto: SetProjectMemberDto): Promise<ProjectMemberDto[]> {
    await this.access.load(m, projectId, { manage: true });
    await this.assertWorkspaceMember(m.workspaceId, dto.userId);
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: dto.userId } },
      create: { projectId, userId: dto.userId, role: dto.role },
      update: { role: dto.role },
    });
    return this.listMembers(m, projectId);
  }

  async removeMember(m: Membership, projectId: string, userId: string) {
    const { project } = await this.access.load(m, projectId, { manage: true });
    if (project.leadId === userId) throw new BadRequestException('Change the project lead before removing them');
    const res = await this.prisma.projectMember.deleteMany({ where: { projectId, userId } });
    if (res.count === 0) throw new NotFoundException('Project member not found');
  }

  // ---------- statuses ----------

  private listStatuses(projectId: string): Promise<StatusDto[]> {
    return this.prisma.projectStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  }

  async statuses(m: Membership, projectId: string) {
    await this.access.load(m, projectId);
    return this.listStatuses(projectId);
  }

  async createStatus(m: Membership, projectId: string, dto: CreateStatusDto): Promise<StatusDto> {
    await this.access.load(m, projectId, { manage: true });
    const last = await this.prisma.projectStatus.aggregate({ where: { projectId }, _max: { position: true } });
    try {
      return await this.prisma.projectStatus.create({
        data: {
          projectId, name: dto.name.trim(), category: dto.category,
          ...(dto.color && { color: dto.color }), ...(dto.wipLimit && { wipLimit: dto.wipLimit }), position: (last._max.position ?? -1) + 1,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A status with this name already exists');
      throw e;
    }
  }

  async updateStatus(m: Membership, projectId: string, statusId: string, dto: UpdateStatusDto): Promise<StatusDto> {
    await this.access.load(m, projectId, { manage: true });
    const status = await this.prisma.projectStatus.findFirst({ where: { id: statusId, projectId } });
    if (!status) throw new NotFoundException('Status not found');
    if (dto.category && dto.category !== status.category) {
      await this.assertKeepsCategory(projectId, status.id, status.category);
    }
    try {
      return await this.prisma.projectStatus.update({
        where: { id: statusId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.wipLimit !== undefined && { wipLimit: dto.wipLimit }),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A status with this name already exists');
      throw e;
    }
  }

  /** Every workflow needs at least one "to do" and one "done" status. */
  private async assertKeepsCategory(projectId: string, excludeId: string, category: string) {
    if (category !== 'TODO' && category !== 'DONE') return;
    const others = await this.prisma.projectStatus.count({ where: { projectId, category, id: { not: excludeId } } });
    if (others === 0) {
      throw new BadRequestException(`A project needs at least one ${category === 'TODO' ? 'to do' : 'done'} status`);
    }
  }

  /**
   * Deletes a status. Tasks in it must be moved elsewhere first: pass `moveTo` to do that atomically.
   */
  async removeStatus(m: Membership, projectId: string, statusId: string, moveToId?: string) {
    await this.access.load(m, projectId, { manage: true });
    const status = await this.prisma.projectStatus.findFirst({ where: { id: statusId, projectId } });
    if (!status) throw new NotFoundException('Status not found');
    await this.assertKeepsCategory(projectId, status.id, status.category);

    const inUse = await this.prisma.task.count({ where: { statusId } });
    if (inUse > 0 && !moveToId) {
      throw new ConflictException(`${inUse} task${inUse === 1 ? ' is' : 's are'} in this status; choose a status to move them to`);
    }
    await this.prisma.$transaction(async (tx) => {
      if (inUse > 0 && moveToId) {
        const target = await tx.projectStatus.findFirst({ where: { id: moveToId, projectId } });
        if (!target || target.id === statusId) throw new BadRequestException('Choose a different status of this project to move tasks to');
        const tasks = await tx.task.findMany({ where: { statusId }, select: { id: true, startedAt: true, completedAt: true } });
        const now = new Date();
        for (const t of tasks) {
          await tx.task.update({
            where: { id: t.id },
            data: {
              statusId: target.id,
              completedAt: target.category === 'DONE' ? (t.completedAt ?? now) : null,
              startedAt: t.startedAt ?? (target.category === 'TODO' ? null : now),
            },
          });
          await tx.activity.create({ data: { taskId: t.id, actorId: m.userId, type: 'updated', field: 'status', from: status.name, to: target.name } });
        }
      }
      await tx.projectStatus.delete({ where: { id: statusId } });
    });
  }

  async reorderStatuses(m: Membership, projectId: string, ids: string[]): Promise<StatusDto[]> {
    await this.access.load(m, projectId, { manage: true });
    const current = await this.prisma.projectStatus.findMany({ where: { projectId }, select: { id: true } });
    const same = ids.length === current.length && new Set(ids).size === ids.length &&
      current.every((s) => ids.includes(s.id));
    if (!same) throw new BadRequestException('ids must list every status of the project exactly once');
    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.projectStatus.update({ where: { id }, data: { position } })),
    );
    return this.listStatuses(projectId);
  }

  // ---------- labels ----------

  private listLabels(projectId: string): Promise<LabelDto[]> {
    return this.prisma.label.findMany({ where: { projectId }, orderBy: { name: 'asc' } });
  }

  async labels(m: Membership, projectId: string) {
    await this.access.load(m, projectId);
    return this.listLabels(projectId);
  }

  async createLabel(m: Membership, projectId: string, dto: CreateLabelDto): Promise<LabelDto> {
    await this.access.load(m, projectId, { manage: true });
    try {
      return await this.prisma.label.create({
        data: { projectId, name: dto.name.trim(), ...(dto.color && { color: dto.color }) },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A label with this name already exists');
      throw e;
    }
  }

  async updateLabel(m: Membership, projectId: string, labelId: string, dto: UpdateLabelDto): Promise<LabelDto> {
    await this.access.load(m, projectId, { manage: true });
    const label = await this.prisma.label.findFirst({ where: { id: labelId, projectId } });
    if (!label) throw new NotFoundException('Label not found');
    try {
      return await this.prisma.label.update({
        where: { id: labelId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.color !== undefined && { color: dto.color }),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A label with this name already exists');
      throw e;
    }
  }

  async removeLabel(m: Membership, projectId: string, labelId: string) {
    await this.access.load(m, projectId, { manage: true });
    const res = await this.prisma.label.deleteMany({ where: { id: labelId, projectId } });
    if (res.count === 0) throw new NotFoundException('Label not found');
  }
}
