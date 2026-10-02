import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { randomToken } from '../common/crypto.js';
import { slugify } from '../common/slug.js';
import type { Membership, Workspace } from '../generated/prisma/client.js';
import type { WorkspaceRole } from '../generated/prisma/enums.js';
import { isWorkspaceAdmin } from '../permissions/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditLogDto, MemberDto, WorkspaceDto } from './dto/workspace.dto.js';

const toDto = (w: Workspace, role: WorkspaceRole): WorkspaceDto => ({
  id: w.id, name: w.name, slug: w.slug, createdAt: w.createdAt, role,
});

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(name: string) {
    const base = slugify(name);
    let slug = base;
    while (await this.prisma.workspace.findUnique({ where: { slug } })) {
      slug = `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    }
    return slug;
  }

  async create(userId: string, name: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: name.trim(),
        slug: await this.uniqueSlug(name),
        createdById: userId,
        memberships: { create: { userId, role: 'OWNER' } },
      },
    });
    await this.audit.log({
      workspaceId: workspace.id, actorId: userId, action: 'workspace.created',
      entityType: 'workspace', entityId: workspace.id,
    });
    return toDto(workspace, 'OWNER');
  }

  async listMine(userId: string): Promise<WorkspaceDto[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { workspace: { name: 'asc' } },
    });
    return rows.map((m) => toDto(m.workspace, m.role));
  }

  async get(membership: Membership): Promise<WorkspaceDto> {
    const w = await this.prisma.workspace.findUniqueOrThrow({ where: { id: membership.workspaceId } });
    return toDto(w, membership.role);
  }

  async update(membership: Membership, name: string): Promise<WorkspaceDto> {
    const w = await this.prisma.workspace.update({
      where: { id: membership.workspaceId }, data: { name: name.trim() },
    });
    await this.audit.log({
      workspaceId: w.id, actorId: membership.userId, action: 'workspace.updated',
      entityType: 'workspace', entityId: w.id, metadata: { name: w.name },
    });
    return toDto(w, membership.role);
  }

  async remove(workspaceId: string) {
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  // ---------- members ----------

  async listMembers(workspaceId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.createdAt,
    }));
  }

  private async ownerCount(workspaceId: string) {
    return this.prisma.membership.count({ where: { workspaceId, role: 'OWNER' } });
  }

  async changeRole(actor: Membership, targetUserId: string, role: WorkspaceRole): Promise<MemberDto> {
    const target = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: targetUserId } },
      include: { user: true },
    });
    if (!target) throw new NotFoundException('Member not found');

    // Only owners may grant or change the owner role.
    if ((role === 'OWNER' || target.role === 'OWNER') && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can change owner roles');
    }
    if (target.role === 'OWNER' && role !== 'OWNER' && (await this.ownerCount(actor.workspaceId)) <= 1) {
      throw new BadRequestException('A workspace needs at least one owner');
    }
    const updated = await this.prisma.membership.update({ where: { id: target.id }, data: { role } });
    await this.audit.log({
      workspaceId: actor.workspaceId, actorId: actor.userId, action: 'member.role_changed',
      entityType: 'user', entityId: targetUserId, metadata: { from: target.role, to: role },
    });
    return {
      userId: target.userId, name: target.user.name, email: target.user.email,
      role: updated.role, joinedAt: target.createdAt,
    };
  }

  /** Removes a member, or lets a member leave. */
  async removeMember(actor: Membership, targetUserId: string) {
    const leaving = actor.userId === targetUserId;
    const target = leaving
      ? actor
      : await this.prisma.membership.findUnique({
          where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: targetUserId } },
        });
    if (!target) throw new NotFoundException('Member not found');

    if (!leaving) {
      if (!isWorkspaceAdmin(actor.role)) throw new ForbiddenException("You don't have permission to do that");
      if (target.role === 'OWNER' && actor.role !== 'OWNER') {
        throw new ForbiddenException('Only an owner can remove an owner');
      }
    }
    if (target.role === 'OWNER' && (await this.ownerCount(actor.workspaceId)) <= 1) {
      throw new BadRequestException('A workspace needs at least one owner');
    }

    const { workspaceId } = actor;
    await this.prisma.$transaction([
      this.prisma.teamMember.deleteMany({ where: { userId: targetUserId, team: { workspaceId } } }),
      this.prisma.projectMember.deleteMany({ where: { userId: targetUserId, project: { workspaceId } } }),
      this.prisma.project.updateMany({ where: { workspaceId, leadId: targetUserId }, data: { leadId: null } }),
      this.prisma.membership.delete({ where: { id: target.id } }),
    ]);
    await this.audit.log({
      workspaceId, actorId: actor.userId, action: leaving ? 'member.left' : 'member.removed',
      entityType: 'user', entityId: targetUserId,
    });
  }

  // ---------- audit ----------

  async auditLog(workspaceId: string, limit = 50, before?: string): Promise<AuditLogDto[]> {
    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) throw new BadRequestException('Invalid "before"');
    const rows = await this.prisma.auditLog.findMany({
      where: { workspaceId, ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id, actorId: r.actorId, action: r.action, entityType: r.entityType,
      entityId: r.entityId, metadata: r.metadata as Record<string, unknown> | null, createdAt: r.createdAt,
    }));
  }
}
