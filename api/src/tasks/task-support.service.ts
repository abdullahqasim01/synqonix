import { BadRequestException, Injectable } from '@nestjs/common';
import type { Label, Prisma, Project, ProjectStatus, Sprint } from '../generated/prisma/client.js';
import type { StatusCategory, TaskType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type FieldDef, normalizeCustomValue } from './custom-values.js';

type Tx = Prisma.TransactionClient;

/** Sizes allowed when a project estimates in T-shirt sizes (XS, S, M, L, XL, XXL). */
export const TSHIRT_SIZES = [1, 2, 3, 5, 8, 13];

/** Validation shared by creating, updating, moving and duplicating tasks. */
@Injectable()
export class TaskSupportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serialises position allocation and ranking within a project for the rest of the transaction.
   * Re-entrant, so callers that already hold it (ranking) can call helpers that take it again.
   */
  lockProject(tx: Tx, projectId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
  }

  async resolveStatus(tx: Tx, projectId: string, statusId?: string): Promise<ProjectStatus> {
    const status = statusId
      ? await tx.projectStatus.findFirst({ where: { id: statusId, projectId } })
      : await tx.projectStatus.findFirst({ where: { projectId, category: 'TODO' }, orderBy: { position: 'asc' } });
    if (!status) throw new BadRequestException(statusId ? 'Unknown status for this project' : 'Project has no workflow status');
    return status;
  }

  async assertLabels(tx: Tx, projectId: string, labelIds: string[]): Promise<Label[]> {
    const ids = [...new Set(labelIds)];
    if (ids.length === 0) return [];
    const labels = await tx.label.findMany({ where: { projectId, id: { in: ids } } });
    if (labels.length !== ids.length) throw new BadRequestException('Unknown label for this project');
    return labels;
  }

  /** Subset of `userIds` that belong to the workspace and may see the project. */
  async visibleUserIds(db: Tx | PrismaService, workspaceId: string, project: Project, userIds: string[]): Promise<string[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const members = await db.membership.findMany({ where: { workspaceId, userId: { in: ids } } });
    if (project.visibility === 'WORKSPACE') return members.map((m) => m.userId);
    const projectMembers = await db.projectMember.findMany({ where: { projectId: project.id, userId: { in: ids } } });
    const inProject = new Set(projectMembers.map((p) => p.userId));
    return members
      .filter((m) => m.role === 'OWNER' || m.role === 'ADMIN' || project.leadId === m.userId || inProject.has(m.userId))
      .map((m) => m.userId);
  }

  async assertAssignees(tx: Tx, workspaceId: string, project: Project, userIds: string[]): Promise<string[]> {
    const ids = [...new Set(userIds)];
    const ok = await this.visibleUserIds(tx, workspaceId, project, ids);
    if (ok.length !== ids.length) {
      throw new BadRequestException('Assignees must be workspace members who can access this project');
    }
    return ids;
  }

  async resolveParent(tx: Tx, projectId: string, parentId: string): Promise<{ id: string; type: TaskType }> {
    const parent = await tx.task.findFirst({ where: { id: parentId, projectId }, select: { id: true, type: true } });
    if (!parent) throw new BadRequestException('Parent task must be in the same project');
    return parent;
  }

  customFieldDefs(tx: Tx, projectId: string): Promise<FieldDef[]> {
    return tx.customField.findMany({ where: { projectId } });
  }

  /** Validates `{fieldId: value}` input; returns the normalised values keyed by field id. */
  normalizeCustomInput(defs: FieldDef[], input: Record<string, unknown>) {
    const byId = new Map(defs.map((d) => [d.id, d]));
    const out = new Map<string, { def: FieldDef; value: string | number | boolean | null }>();
    for (const [fieldId, raw] of Object.entries(input)) {
      const def = byId.get(fieldId);
      if (!def) throw new BadRequestException(`Unknown custom field: ${fieldId}`);
      out.set(fieldId, { def, value: normalizeCustomValue(def, raw) });
    }
    return out;
  }

  /** Timestamps implied by moving a task into a status of `category`. */
  lifecycle(category: StatusCategory, current: { startedAt: Date | null; completedAt: Date | null }) {
    const now = new Date();
    const data: { startedAt?: Date; completedAt?: Date | null } = {};
    if (category === 'DONE') {
      data.completedAt = current.completedAt ?? now;
      if (!current.startedAt) data.startedAt = now;
    } else {
      data.completedAt = null;
      if (category === 'IN_PROGRESS' && !current.startedAt) data.startedAt = now;
    }
    return data;
  }

  /** T-shirt projects only accept the fixed size scale; other units take any non-negative number. */
  assertEstimate(project: Pick<Project, 'estimationUnit'>, estimate: number | null | undefined) {
    if (estimate === null || estimate === undefined) return;
    if (project.estimationUnit === 'TSHIRT' && !TSHIRT_SIZES.includes(estimate)) {
      throw new BadRequestException(`Estimates in T-shirt sizes must be one of: ${TSHIRT_SIZES.join(', ')}`);
    }
  }

  /** A sprint of this project that can still take work (planned or active). */
  async resolveSprint(tx: Tx, projectId: string, sprintId: string): Promise<Sprint> {
    const sprint = await tx.sprint.findFirst({ where: { id: sprintId, projectId } });
    if (!sprint) throw new BadRequestException('Unknown sprint for this project');
    if (sprint.state === 'COMPLETED') throw new BadRequestException('That sprint is already completed');
    return sprint;
  }

  async resolveRelease(tx: Tx, projectId: string, releaseId: string) {
    const release = await tx.release.findFirst({ where: { id: releaseId, projectId } });
    if (!release) throw new BadRequestException('Unknown release for this project');
    return release;
  }

  async resolveMilestone(tx: Tx, projectId: string, milestoneId: string) {
    const milestone = await tx.milestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new BadRequestException('Unknown milestone for this project');
    return milestone;
  }

  /**
   * Records a task entering or leaving a sprint: closes its open history entry in `from`
   * and opens one in `to`. Does not touch `Task.sprintId`.
   */
  async trackSprintChange(
    tx: Tx,
    task: { id: string; estimate: number | null },
    from: { id: string } | null,
    to: Pick<Sprint, 'id' | 'state'> | null,
  ) {
    if (from) {
      await tx.sprintTask.updateMany({
        where: { sprintId: from.id, taskId: task.id, removedAt: null },
        data: { removedAt: new Date(), outcome: 'REMOVED' },
      });
    }
    if (to) {
      await tx.sprintTask.create({
        data: { sprintId: to.id, taskId: task.id, estimateAtAdd: task.estimate, addedAfterStart: to.state === 'ACTIVE' },
      });
    }
  }
}
