import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import { timeSpentByTask } from '../tasks/time-spent.js';
import type { LogTimeDto, TaskTimeDto, TimeEntryDto, TimerDto, UpdateTimeEntryDto } from './dto/time.dto.js';

const include = { task: { select: { id: true, number: true, title: true, project: { select: { key: true, workspaceId: true } } } }, user: { select: { id: true, name: true } } } satisfies Prisma.TimeEntryInclude;
type Row = Prisma.TimeEntryGetPayload<{ include: typeof include }>;

const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';
const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

@Injectable()
export class TimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
  ) {}

  private toDto(r: Row, now: Date): TimeEntryDto {
    const running = r.endedAt === null;
    return {
      id: r.id, taskId: r.taskId, taskKey: taskKey(r.task.project.key, r.task.number), taskTitle: r.task.title, userId: r.userId, userName: r.user.name,
      startedAt: r.startedAt, endedAt: r.endedAt, minutes: running ? minutesBetween(r.startedAt, now) : r.minutes, running, note: r.note,
    };
  }

  async forTask(m: Membership, ref: string, now = new Date()): Promise<TaskTimeDto> {
    const { task } = await this.access.load(m, ref);
    const rows = await this.prisma.timeEntry.findMany({ where: { taskId: task.id }, include, orderBy: { startedAt: 'desc' } });
    const spent = (await timeSpentByTask(this.prisma, [task.id], now)).get(task.id) ?? 0;
    return { estimateMinutes: task.timeEstimateMinutes, spentMinutes: spent, entries: rows.map((r) => this.toDto(r, now)) };
  }

  async log(m: Membership, ref: string, dto: LogTimeDto, now = new Date()): Promise<TimeEntryDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : new Date(now.getTime() - dto.minutes * 60_000);
    if (startedAt.getTime() > now.getTime() + 60_000) throw new BadRequestException('Time cannot be logged in the future');
    const row = await this.prisma.timeEntry.create({
      data: { taskId: task.id, userId: m.userId, startedAt, endedAt: new Date(startedAt.getTime() + dto.minutes * 60_000), minutes: dto.minutes, note: dto.note?.trim() || null },
      include,
    });
    return this.toDto(row, now);
  }

  private async ownEntry(m: Membership, ref: string, entryId: string) {
    const { task, manage } = await this.access.load(m, ref, { write: true });
    const entry = await this.prisma.timeEntry.findFirst({ where: { id: entryId, taskId: task.id }, include });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.userId !== m.userId && !manage) throw new ForbiddenException('Only the person who logged it or a project admin can change this entry');
    if (entry.endedAt === null) throw new BadRequestException('Stop the timer before changing this entry');
    return entry;
  }

  async update(m: Membership, ref: string, entryId: string, dto: UpdateTimeEntryDto, now = new Date()): Promise<TimeEntryDto> {
    const entry = await this.ownEntry(m, ref, entryId);
    const minutes = dto.minutes ?? entry.minutes;
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : entry.startedAt;
    if (startedAt.getTime() > now.getTime() + 60_000) throw new BadRequestException('Time cannot be logged in the future');
    const row = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: { minutes, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), ...(dto.note !== undefined && { note: dto.note?.trim() || null }) },
      include,
    });
    return this.toDto(row, now);
  }

  async remove(m: Membership, ref: string, entryId: string) {
    await this.ownEntry(m, ref, entryId);
    await this.prisma.timeEntry.delete({ where: { id: entryId } });
  }

  // ---------------------------------------------------------------- timer

  async timer(m: Membership, now = new Date()): Promise<TimerDto> {
    const row = await this.prisma.timeEntry.findFirst({ where: { userId: m.userId, endedAt: null, task: { project: { workspaceId: m.workspaceId } } }, include });
    return { entry: row ? this.toDto(row, now) : null };
  }

  /** Closes the person's running timer (in any workspace), dropping it if it ran for under a minute. */
  private async stopRunning(userId: string, now: Date): Promise<Row | null> {
    const running = await this.prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, include });
    if (!running) return null;
    const minutes = minutesBetween(running.startedAt, now);
    if (minutes < 1) {
      await this.prisma.timeEntry.delete({ where: { id: running.id } });
      return null;
    }
    return this.prisma.timeEntry.update({ where: { id: running.id }, data: { endedAt: now, minutes: Math.min(minutes, 1440) }, include });
  }

  async start(m: Membership, ref: string, now = new Date()): Promise<TimerDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    await this.stopRunning(m.userId, now);
    try {
      const row = await this.prisma.timeEntry.create({ data: { taskId: task.id, userId: m.userId, startedAt: now }, include });
      return { entry: this.toDto(row, now) };
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A timer is already running; try again');
      throw e;
    }
  }

  async stop(m: Membership, now = new Date()): Promise<TimeEntryDto | null> {
    const row = await this.stopRunning(m.userId, now);
    return row ? this.toDto(row, now) : null;
  }

  /** The caller's own entries in a period (default: the last 7 days) across the workspace. */
  async mine(m: Membership, from?: string, to?: string, now = new Date()): Promise<TimeEntryDto[]> {
    const rows = await this.prisma.timeEntry.findMany({
      where: {
        userId: m.userId, task: { project: { workspaceId: m.workspaceId } },
        startedAt: { gte: from ? new Date(from) : new Date(now.getTime() - 7 * 86_400_000), ...(to ? { lte: new Date(to) } : {}) },
      },
      include, orderBy: { startedAt: 'desc' }, take: 500,
    });
    return rows.map((r) => this.toDto(r, now));
  }
}
