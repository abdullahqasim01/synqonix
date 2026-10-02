import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, View } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isWorkspaceAdmin } from '../permissions/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import type { ListTasksQueryDto } from '../tasks/dto/task.dto.js';
import type { CreateViewDto, UpdateViewDto, ViewDto, ViewQueryDto } from './dto/view.dto.js';
import { mergeViewQuery } from './view-query.js';

@Injectable()
export class ViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  private async canEdit(m: Membership, view: View): Promise<boolean> {
    if (view.ownerId === m.userId) return true;
    if (view.scope !== 'SHARED') return false;
    if (isWorkspaceAdmin(m.role)) return true;
    if (!view.projectId) return false;
    const project = await this.prisma.project.findUnique({ where: { id: view.projectId } });
    if (!project) return false;
    const pm = await this.projects.projectRole(project.id, m.userId);
    return this.projects.canManage(m, project, pm);
  }

  private async toDto(m: Membership, v: View): Promise<ViewDto> {
    return {
      id: v.id, name: v.name, scope: v.scope, layout: v.layout, projectId: v.projectId, ownerId: v.ownerId,
      query: v.query as ViewQueryDto, canEdit: await this.canEdit(m, v), createdAt: v.createdAt, updatedAt: v.updatedAt,
    };
  }

  /** Loads a view the caller may see: their own, or a shared one in a project they can access. */
  private async load(m: Membership, id: string): Promise<View> {
    const view = await this.prisma.view.findFirst({ where: { id, workspaceId: m.workspaceId } });
    if (!view || (view.scope === 'PERSONAL' && view.ownerId !== m.userId)) throw new NotFoundException('View not found');
    if (view.projectId) await this.projects.load(m, view.projectId); // 404 if the project is hidden
    return view;
  }

  async list(m: Membership, projectId?: string): Promise<ViewDto[]> {
    if (projectId) await this.projects.load(m, projectId);
    const where: Prisma.ViewWhereInput = {
      workspaceId: m.workspaceId,
      projectId: projectId ?? null,
      OR: [{ scope: 'SHARED' }, { ownerId: m.userId }],
    };
    const rows = await this.prisma.view.findMany({ where, orderBy: [{ scope: 'desc' }, { name: 'asc' }] });
    return Promise.all(rows.map((r) => this.toDto(m, r)));
  }

  async get(m: Membership, id: string) {
    return this.toDto(m, await this.load(m, id));
  }

  async create(m: Membership, dto: CreateViewDto): Promise<ViewDto> {
    if (dto.projectId) await this.projects.load(m, dto.projectId);
    if (dto.scope === 'SHARED' && m.role === 'VIEWER') throw new ForbiddenException('Viewers cannot share views');
    const view = await this.prisma.view.create({
      data: {
        workspaceId: m.workspaceId, projectId: dto.projectId ?? null, ownerId: m.userId,
        name: dto.name.trim(), scope: dto.scope ?? 'PERSONAL', layout: dto.layout ?? 'LIST',
        query: JSON.parse(JSON.stringify(dto.query)) as Prisma.InputJsonValue,
      },
    });
    return this.toDto(m, view);
  }

  async update(m: Membership, id: string, dto: UpdateViewDto): Promise<ViewDto> {
    const view = await this.load(m, id);
    if (!(await this.canEdit(m, view))) throw new ForbiddenException("You don't have permission to change this view");
    if (dto.scope === 'SHARED' && m.role === 'VIEWER') throw new ForbiddenException('Viewers cannot share views');
    const updated = await this.prisma.view.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.layout !== undefined && { layout: dto.layout }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
        ...(dto.query !== undefined && { query: JSON.parse(JSON.stringify(dto.query)) as Prisma.InputJsonValue }),
      },
    });
    return this.toDto(m, updated);
  }

  async remove(m: Membership, id: string) {
    const view = await this.load(m, id);
    if (!(await this.canEdit(m, view))) throw new ForbiddenException("You don't have permission to delete this view");
    await this.prisma.view.delete({ where: { id } });
  }

  /** Expands `?view=<id>` into the filters/sort it stores; explicit parameters still win. */
  async resolveQuery(m: Membership, q: ListTasksQueryDto): Promise<ListTasksQueryDto> {
    if (!q.view) return q;
    const view = await this.load(m, q.view);
    return mergeViewQuery({ projectId: view.projectId, query: view.query as ViewQueryDto }, q);
  }
}
