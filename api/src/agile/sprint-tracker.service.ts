import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { SnapshotReason } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskEvents } from '../tasks/events.js';

export interface Scope { scopePoints: number; donePoints: number; scopeTasks: number; doneTasks: number }

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Keeps the burndown data of active sprints: a snapshot at start, one per day, one whenever the
 * sprint's scope or progress changes, and a final one at completion.
 */
@Injectable()
export class SprintTracker {
  constructor(private readonly prisma: PrismaService) {}

  /** Current scope and progress of a sprint (archived tasks do not count). */
  async scope(sprintId: string): Promise<Scope> {
    const tasks = await this.prisma.task.findMany({
      where: { sprintId, archivedAt: null },
      select: { estimate: true, status: { select: { category: true } } },
    });
    const done = tasks.filter((t) => t.status.category === 'DONE');
    const sum = (list: typeof tasks) => list.reduce((acc, t) => acc + (t.estimate ?? 0), 0);
    return { scopePoints: sum(tasks), donePoints: sum(done), scopeTasks: tasks.length, doneTasks: done.length };
  }

  /**
   * Records a snapshot of an active sprint. Scope-change snapshots that would repeat the previous
   * numbers are skipped, so bursts of edits (bulk updates) do not flood the history.
   */
  async record(sprintId: string, reason: SnapshotReason, opts: { allowEnded?: boolean } = {}) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint || (sprint.state !== 'ACTIVE' && !opts.allowEnded)) return null;
    const scope = await this.scope(sprintId);
    if (reason === 'SCOPE_CHANGE') {
      const last = await this.prisma.sprintSnapshot.findFirst({ where: { sprintId }, orderBy: { at: 'desc' } });
      if (last && last.scopePoints === scope.scopePoints && last.donePoints === scope.donePoints
        && last.scopeTasks === scope.scopeTasks && last.doneTasks === scope.doneTasks) return null;
    }
    return this.prisma.sprintSnapshot.create({ data: { sprintId, reason, ...scope } });
  }

  /** Makes sure the sprint has its daily point for today (UTC). */
  async ensureDaily(sprintId: string) {
    const today = startOfUtcDay();
    const exists = await this.prisma.sprintSnapshot.findFirst({
      where: { sprintId, reason: { in: ['DAILY', 'START'] }, at: { gte: today } },
    });
    if (!exists) await this.record(sprintId, 'DAILY');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async recordDailySnapshots() {
    const active = await this.prisma.sprint.findMany({ where: { state: 'ACTIVE' }, select: { id: true } });
    for (const s of active) await this.ensureDaily(s.id);
  }

  // ---- reactions to task changes

  @OnEvent(TaskEvents.updated)
  async onTaskUpdated(e: { sprintIds?: string[] }) {
    for (const id of e.sprintIds ?? []) await this.record(id, 'SCOPE_CHANGE');
  }

  @OnEvent(TaskEvents.deleted)
  async onTaskDeleted(e: { sprintIds?: string[] }) {
    for (const id of e.sprintIds ?? []) await this.record(id, 'SCOPE_CHANGE');
  }
}
