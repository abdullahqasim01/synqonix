import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Prisma, Project, ProjectMember } from '../generated/prisma/client.js';
import { isWorkspaceAdmin } from '../permissions/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ProjectAccess {
  project: Project;
  /** May change project settings (workspace admin, project lead or project admin). */
  manage: boolean;
  /** May create and edit tasks (not a workspace viewer or project viewer). */
  write: boolean;
}

/** Single place for "who can see / change this project" so projects and tasks agree. */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  projectRole(projectId: string, userId: string): Promise<ProjectMember | null> {
    return this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  }

  canView(m: Membership, project: Project, pm: ProjectMember | null) {
    return (
      isWorkspaceAdmin(m.role) ||
      project.visibility === 'WORKSPACE' ||
      project.leadId === m.userId ||
      pm !== null
    );
  }

  canManage(m: Membership, project: Project, pm: ProjectMember | null) {
    return isWorkspaceAdmin(m.role) || project.leadId === m.userId || pm?.role === 'ADMIN';
  }

  canWrite(m: Membership, pm: ProjectMember | null) {
    return m.role !== 'VIEWER' && pm?.role !== 'VIEWER';
  }

  /** Prisma filter for the projects this member can see. */
  visibleProjects(m: Membership): Prisma.ProjectWhereInput {
    return isWorkspaceAdmin(m.role)
      ? {}
      : { OR: [{ visibility: 'WORKSPACE' }, { leadId: m.userId }, { members: { some: { userId: m.userId } } }] };
  }

  /** Loads a project the caller may see (404 otherwise, so private projects stay hidden). */
  async load(m: Membership, projectId: string, opts: { manage?: boolean; write?: boolean } = {}): Promise<ProjectAccess> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: m.workspaceId } });
    if (!project) throw new NotFoundException('Project not found');
    return this.check(m, project, opts);
  }

  async check(m: Membership, project: Project, opts: { manage?: boolean; write?: boolean } = {}): Promise<ProjectAccess> {
    const pm = await this.projectRole(project.id, m.userId);
    if (!this.canView(m, project, pm)) throw new NotFoundException('Project not found');
    const manage = this.canManage(m, project, pm);
    const write = this.canWrite(m, pm);
    if ((opts.manage && !manage) || (opts.write && !write)) {
      throw new ForbiddenException("You don't have permission to do that");
    }
    return { project, manage, write };
  }
}
