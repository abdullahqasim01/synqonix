import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

const HOUR = 3600_000;

/** Background jobs: due-date reminders, waking snoozed notifications and sending queued emails. */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tells assignees about open tasks due within a day, or overdue by up to a week. Each due date is announced once. */
  async remindDue(now = new Date()): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        archivedAt: null, dueDate: { gte: new Date(now.getTime() - 7 * 24 * HOUR), lte: new Date(now.getTime() + 24 * HOUR) },
        status: { category: { not: 'DONE' } }, assignees: { some: {} },
      },
      include: { project: { select: { key: true, workspaceId: true } }, assignees: { select: { userId: true } } },
    });
    let created = 0;
    for (const t of tasks) {
      const due = t.dueDate!;
      const overdue = due.getTime() < now.getTime();
      const key = `${t.project.key}-${t.number}`;
      created += await this.notifications.notify({
        workspaceId: t.project.workspaceId, projectId: t.projectId, type: overdue ? 'OVERDUE' : 'DUE_SOON', userIds: t.assignees.map((a) => a.userId),
        title: overdue ? `${key} is overdue` : `${key} is due soon`, body: `${t.title} · due ${due.toISOString().slice(0, 10)}`,
        url: `/w/${t.project.workspaceId}/tasks/${key}`, taskId: t.id, taskKey: key,
        dedupeKey: `${overdue ? 'overdue' : 'due_soon'}:${t.id}:${due.toISOString()}`,
      }, now);
    }
    return created;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    try {
      const n = await this.remindDue();
      if (n > 0) this.logger.log(`Sent ${n} due-date reminders`);
    } catch (err) {
      this.logger.error('Due-date reminders failed', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async minutely() {
    try {
      await this.notifications.wakeSnoozed();
      await this.notifications.flushEmails();
    } catch (err) {
      this.logger.error('Notification maintenance failed', err as Error);
    }
  }
}
