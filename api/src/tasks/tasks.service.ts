import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership, Prisma, Project } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { ActivityService, type ActivityEntry } from './activity.service.js';
import type {
  BoardDto, BoardQueryDto, BulkChangesDto, BulkResultDto, CreateTaskDto, ListTasksQueryDto, TaskDetailDto, TaskDto,
  TaskListDto, UpdateTaskDto,
} from './dto/task.dto.js';
import { hierarchyError, validParentTypes } from './hierarchy.js';
import { TaskEvents, type TaskEvent } from './events.js';
import { extractMentionedUserIds } from './mentions.js';
import { TaskAccessService } from './task-access.service.js';
import { refInclude, summaryInclude, toRefDto, toTaskDto, type TaskRow } from './task-mapper.js';
import { TaskSupportService } from './task-support.service.js';
import { taskKey } from './task-ref.js';
import { StorageService } from './storage/storage.service.js';
import { ViewsService } from '../views/views.service.js';

type Tx = Prisma.TransactionClient;
const POSITION_STEP = 1000;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly access: TaskAccessService,
    private readonly support: TaskSupportService,
    private readonly activity: ActivityService,
    private readonly events: EventEmitter2,
    private readonly storage: StorageService,
    private readonly views: ViewsService,
  ) {}

  private emit(events: TaskEvent[]) {
    for (const e of events) this.events.emit(e.name, e.payload);
  }

  // ---------- create ----------

  async create(m: Membership, projectId: string, dto: CreateTaskDto): Promise<TaskDetailDto> {
    const { project } = await this.projects.load(m, projectId, { write: true });
    if (project.archivedAt) throw new BadRequestException('This project is archived');

    const events: TaskEvent[] = [];
    const created = await this.prisma.$transaction(async (tx) => {
      await this.support.lockProject(tx, project.id);
      const type = dto.type ?? 'TASK';
      const parent = dto.parentId ? await this.support.resolveParent(tx, project.id, dto.parentId) : null;
      const problem = hierarchyError(type, parent?.type ?? null);
      if (problem) throw new BadRequestException(problem);

      const status = await this.support.resolveStatus(tx, project.id, dto.statusId);
      const assigneeIds = await this.support.assertAssignees(tx, m.workspaceId, project, dto.assigneeIds ?? []);
      const labels = await this.support.assertLabels(tx, project.id, dto.labelIds ?? []);
      const defs = await this.support.customFieldDefs(tx, project.id);
      const custom = this.support.normalizeCustomInput(defs, dto.customFields ?? {});
      this.support.assertEstimate(project, dto.estimate);
      const sprint = dto.sprintId ? await this.support.resolveSprint(tx, project.id, dto.sprintId) : null;
      if (sprint && type === 'EPIC') throw new BadRequestException('Epics cannot be planned into a sprint');
      const release = dto.releaseId ? await this.support.resolveRelease(tx, project.id, dto.releaseId) : null;
      const milestone = dto.milestoneId ? await this.support.resolveMilestone(tx, project.id, dto.milestoneId) : null;

      // Atomic counter: concurrent creators each get a distinct number.
      const { nextTaskNumber } = await tx.project.update({
        where: { id: project.id },
        data: { nextTaskNumber: { increment: 1 } },
        select: { nextTaskNumber: true },
      });
      const last = await tx.task.aggregate({ where: { projectId: project.id }, _max: { position: true } });

      const task = await tx.task.create({
        data: {
          projectId: project.id,
          number: nextTaskNumber - 1,
          type,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          statusId: status.id,
          priority: dto.priority ?? 'NONE',
          reporterId: m.userId,
          estimate: dto.estimate ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          parentId: parent?.id ?? null,
          sprintId: sprint?.id ?? null,
          releaseId: release?.id ?? null,
          milestoneId: milestone?.id ?? null,
          acceptanceCriteria: dto.acceptanceCriteria?.trim() || null,
          position: (last._max.position ?? 0) + POSITION_STEP,
          ...this.support.lifecycle(status.category, { startedAt: null, completedAt: null }),
          assignees: { create: assigneeIds.map((userId) => ({ userId })) },
          labels: { create: labels.map((l) => ({ labelId: l.id })) },
          watchers: { create: [...new Set([m.userId, ...assigneeIds])].map((userId) => ({ userId })) },
          customValues: {
            create: [...custom.entries()]
              .filter(([, v]) => v.value !== null)
              .map(([fieldId, v]) => ({ fieldId, value: v.value as Prisma.InputJsonValue })),
          },
        },
      });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'created' }]);
      if (sprint) await this.support.trackSprintChange(tx, task, null, sprint);
      return task;
    });

    const key = taskKey(project.key, created.number);
    const base = { workspaceId: m.workspaceId, projectId: project.id, taskId: created.id, taskKey: key, actorId: m.userId };
    events.push({ name: TaskEvents.created, payload: base });
    if (created.sprintId) events.push({ name: TaskEvents.updated, payload: { ...base, fields: ['sprint'], sprintIds: [created.sprintId] } });
    if (dto.assigneeIds?.length) events.push({ name: TaskEvents.assigned, payload: { ...base, assigneeIds: [...new Set(dto.assigneeIds)] } });
    await this.pushMentions(events, base, project, m.workspaceId, extractMentionedUserIds(dto.description), 'description');
    this.emit(events);
    return this.detail(m, created.id);
  }

  async pushMentions(
    events: TaskEvent[],
    base: { workspaceId: string; projectId: string; taskId: string; taskKey: string; actorId: string },
    project: Project,
    workspaceId: string,
    wanted: string[],
    source: 'comment' | 'description',
    commentId?: string,
  ) {
    const mentionable = await this.support.visibleUserIds(
      this.prisma, workspaceId, project, wanted.filter((id) => id !== base.actorId),
    );
    if (mentionable.length) {
      events.push({ name: TaskEvents.mentioned, payload: { ...base, mentionedUserIds: mentionable, source, commentId } });
    }
  }

  // ---------- read ----------

  private async doneCounts(parentIds: string[]) {
    if (parentIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.task.groupBy({
      by: ['parentId'],
      where: { parentId: { in: parentIds }, archivedAt: null, status: { category: 'DONE' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.parentId as string, r._count._all]));
  }

  async toDtos(rows: TaskRow[]): Promise<TaskDto[]> {
    const done = await this.doneCounts(rows.filter((r) => r._count.children > 0).map((r) => r.id));
    return rows.map((r) => toTaskDto(r, done.get(r.id) ?? 0));
  }

  /** Filters shared by the list and the board. 404s when the project is hidden from the caller. */
  async buildWhere(m: Membership, q: ListTasksQueryDto): Promise<Prisma.TaskWhereInput> {
    if (q.projectId) await this.projects.load(m, q.projectId); // 404 for hidden/unknown projects

    const and: Prisma.TaskWhereInput[] = [];
    if (q.statusId) and.push({ statusId: q.statusId });
    if (q.statusCategory) and.push({ status: { category: q.statusCategory } });
    if (q.type) and.push({ type: q.type });
    if (q.excludeSubtasks) and.push({ type: { not: 'SUBTASK' } });
    if (q.sprintId === 'none') and.push({ sprintId: null });
    else if (q.sprintId === 'active') and.push({ sprint: { state: 'ACTIVE' } });
    else if (q.sprintId) and.push({ sprintId: q.sprintId });
    if (q.releaseId === 'none') and.push({ releaseId: null });
    else if (q.releaseId) and.push({ releaseId: q.releaseId });
    if (q.milestoneId === 'none') and.push({ milestoneId: null });
    else if (q.milestoneId) and.push({ milestoneId: q.milestoneId });
    if (q.priority) and.push({ priority: q.priority });
    if (q.reporter) and.push({ reporterId: q.reporter === 'me' ? m.userId : q.reporter });
    if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } });
    if (q.assignee === 'none') and.push({ assignees: { none: {} } });
    else if (q.assignee) and.push({ assignees: { some: { userId: q.assignee === 'me' ? m.userId : q.assignee } } });
    if (q.parent === 'none') and.push({ parentId: null });
    else if (q.parent) and.push({ parentId: q.parent });
    if (q.dueBefore) and.push({ dueDate: { lte: new Date(q.dueBefore) } });
    if (q.dueAfter) and.push({ dueDate: { gte: new Date(q.dueAfter) } });
    if (q.q?.trim()) {
      const text = q.q.trim();
      const key = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(text);
      and.push({
        OR: [
          { title: { contains: text, mode: 'insensitive' } },
          ...(key ? [{ number: Number(key[2]), project: { key: key[1].toUpperCase() } }] : []),
          ...(/^\d{1,9}$/.test(text) ? [{ number: Number(text) }] : []),
        ],
      });
    }

    return {
      project: {
        workspaceId: m.workspaceId,
        ...this.projects.visibleProjects(m),
        ...(q.projectId ? { id: q.projectId } : q.includeArchived ? {} : { archivedAt: null }),
      },
      ...(q.includeArchived ? {} : { archivedAt: null }),
      AND: and,
    };

  }

  async list(m: Membership, rawQuery: ListTasksQueryDto): Promise<TaskListDto> {
    const q = await this.views.resolveQuery(m, rawQuery);
    const where = await this.buildWhere(m, q);

    const order = q.order ?? (q.sort === 'createdAt' || q.sort === 'updatedAt' ? 'desc' : 'asc');
    const sort = q.sort ?? 'position';
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
      sort === 'dueDate' || sort === 'startDate'
        ? { [sort]: { sort: order, nulls: 'last' } } as Prisma.TaskOrderByWithRelationInput
        : ({ [sort]: order } as Prisma.TaskOrderByWithRelationInput),
      { id: 'asc' },
    ];

    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({
        where, orderBy, include: summaryInclude, take: q.limit ?? 50, skip: q.offset ?? 0,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items: await this.toDtos(rows), total };
  }


  /** Kanban data: one column per workflow status, each ranked by position. */
  async board(m: Membership, projectId: string, rawQuery: BoardQueryDto): Promise<BoardDto> {
    const { project } = await this.projects.load(m, projectId);
    const q = await this.views.resolveQuery(m, { ...rawQuery, projectId });
    const base = await this.buildWhere(m, { ...q, projectId, excludeSubtasks: q.excludeSubtasks ?? true });
    const limit = Math.min(q.limit ?? 50, 200);

    const statuses = await this.prisma.projectStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
    const columns = await Promise.all(
      statuses.map(async (status) => {
        const where: Prisma.TaskWhereInput = { AND: [base, { statusId: status.id }] };
        const [rows, total] = await Promise.all([
          this.prisma.task.findMany({
            where, include: summaryInclude, take: limit, orderBy: [{ position: 'asc' }, { id: 'asc' }],
          }),
          this.prisma.task.count({ where }),
        ]);
        return {
          status: {
            id: status.id, name: status.name, category: status.category, color: status.color,
            position: status.position, wipLimit: status.wipLimit,
          },
          total,
          tasks: await this.toDtos(rows),
          hasMore: total > rows.length,
        };
      }),
    );
    const epics = await this.prisma.task.findMany({
      where: { projectId: project.id, type: 'EPIC', archivedAt: null },
      include: refInclude, orderBy: { number: 'asc' }, take: 100,
    });
    return { projectId, columns, epics: epics.map(toRefDto) };
  }

  async get(m: Membership, ref: string): Promise<TaskDetailDto> {
    const { task } = await this.access.load(m, ref);
    return this.detail(m, task.id);
  }

  async detail(m: Membership, taskId: string): Promise<TaskDetailDto> {
    const row = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        ...summaryInclude,
        parent: { include: refInclude },
        children: { where: { archivedAt: null }, include: summaryInclude, orderBy: { number: 'asc' } },
        relationsFrom: { include: { to: { include: refInclude } } },
        relationsTo: { include: { from: { include: refInclude } } },
        checklists: { include: { items: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        customValues: { include: { field: true } },
        watchers: { include: { user: { select: { id: true, name: true } } } },
      },
    });
    const pm = await this.projects.projectRole(row.projectId, m.userId);
    const canEdit = this.projects.canWrite(m, pm);

    // Hide related tasks that live in projects the caller cannot see.
    const visible = new Set(
      (await this.prisma.project.findMany({
        where: { workspaceId: m.workspaceId, ...this.projects.visibleProjects(m) },
        select: { id: true },
      })).map((p) => p.id),
    );
    const relations = [
      ...row.relationsFrom.map((r) => ({
        id: r.id, row: r.to,
        kind: ({ BLOCKS: 'blocks', RELATES: 'relates_to', DUPLICATES: 'duplicates' } as const)[r.type],
      })),
      ...row.relationsTo.map((r) => ({
        id: r.id, row: r.from,
        kind: ({ BLOCKS: 'blocked_by', RELATES: 'relates_to', DUPLICATES: 'duplicated_by' } as const)[r.type],
      })),
    ].filter((r) => visible.has(r.row.projectId)).map((r) => ({ id: r.id, kind: r.kind, task: toRefDto(r.row) }));

    const [summary] = await this.toDtos([row]);
    const subtasks = await this.toDtos(row.children);
    return {
      ...summary,
      description: row.description,
      acceptanceCriteria: row.acceptanceCriteria,
      parent: row.parent ? toRefDto(row.parent) : null,
      subtasks,
      relations,
      checklists: row.checklists.map((c) => ({
        id: c.id, title: c.title, position: c.position,
        items: c.items.map((i) => ({ id: i.id, text: i.text, done: i.done, position: i.position })),
      })),
      attachments: row.attachments.map((a) => ({
        id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, uploaderId: a.uploaderId, createdAt: a.createdAt,
      })),
      customFields: row.customValues
        .map((v) => ({ fieldId: v.fieldId, name: v.field.name, type: v.field.type, value: v.value as string | number | boolean | null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      watchers: row.watchers.map((w) => ({ userId: w.userId, name: w.user.name })),
      isWatching: row.watchers.some((w) => w.userId === m.userId),
      canEdit,
    };
  }

  // ---------- update ----------

  async update(m: Membership, ref: string, dto: UpdateTaskDto): Promise<TaskDetailDto> {
    const { task, project } = await this.access.load(m, ref, { write: true });
    const events: TaskEvent[] = [];
    await this.prisma.$transaction(async (tx) => {
      await this.applyUpdate(tx, m, project, task.id, dto, events);
    });
    this.emit(events);
    return this.detail(m, task.id);
  }

  /** Applies `dto` to one task, writing activity rows and collecting events. Runs inside a transaction. */
  async applyUpdate(
    tx: Tx, m: Membership, project: Project, taskId: string, dto: UpdateTaskDto, events: TaskEvent[],
  ): Promise<void> {
    const task = await tx.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        status: true, parent: true, children: { select: { type: true } },
        assignees: true, labels: { include: { label: true } }, sprint: true,
      },
    });
    const entries: ActivityEntry[] = [];
    const data: Prisma.TaskUpdateInput = {};
    const base = { workspaceId: m.workspaceId, projectId: project.id, taskId, taskKey: taskKey(project.key, task.number), actorId: m.userId };

    if (dto.title !== undefined && dto.title.trim() !== task.title) {
      data.title = dto.title.trim();
      entries.push({ type: 'updated', field: 'title', from: task.title, to: data.title });
    }

    if (dto.description !== undefined) {
      const next = dto.description?.trim() || null;
      if (next !== task.description) {
        data.description = next;
        entries.push({ type: 'updated', field: 'description' });
        const added = extractMentionedUserIds(next).filter((id) => !extractMentionedUserIds(task.description).includes(id));
        await this.pushMentions(events, base, project, m.workspaceId, added, 'description');
      }
    }

    // type and parent are validated together
    const newType = dto.type ?? task.type;
    let parentRow: { id: string; type: typeof task.type } | null = task.parent ? { id: task.parent.id, type: task.parent.type } : null;
    if (dto.parentId !== undefined) {
      if (dto.parentId === task.id) throw new BadRequestException('A task cannot be its own parent');
      parentRow = dto.parentId ? await this.support.resolveParent(tx, project.id, dto.parentId) : null;
    }
    if (newType !== task.type || dto.parentId !== undefined) {
      const problem = hierarchyError(newType, parentRow?.type ?? null);
      if (problem) throw new BadRequestException(problem);
      const allowedParents = (t: typeof newType) => validParentTypes(t);
      for (const child of task.children) {
        if (!allowedParents(child.type)?.includes(newType)) {
          throw new BadRequestException(`A ${newType.toLowerCase()} cannot contain ${child.type.toLowerCase()}s; move or delete its children first`);
        }
      }
    }
    if (newType !== task.type) {
      data.type = newType;
      entries.push({ type: 'updated', field: 'type', from: task.type, to: newType });
    }
    if (dto.parentId !== undefined && (parentRow?.id ?? null) !== task.parentId) {
      data.parent = parentRow ? { connect: { id: parentRow.id } } : { disconnect: true };
      entries.push({ type: 'updated', field: 'parent', from: task.parentId, to: parentRow?.id ?? null });
    }

    if (dto.statusId !== undefined && dto.statusId !== task.statusId) {
      const status = await this.support.resolveStatus(tx, project.id, dto.statusId);
      data.status = { connect: { id: status.id } };
      Object.assign(data, this.support.lifecycle(status.category, task));
      // A card changed through a form (not dragged) joins the bottom of its new column.
      await this.support.lockProject(tx, project.id);
      const last = await tx.task.aggregate({ where: { projectId: project.id }, _max: { position: true } });
      data.position = (last._max.position ?? 0) + POSITION_STEP;
      entries.push({ type: 'updated', field: 'status', from: task.status.name, to: status.name });
      events.push({ name: TaskEvents.statusChanged, payload: { ...base, from: task.status.name, to: status.name } });
    }

    if (dto.priority !== undefined && dto.priority !== task.priority) {
      data.priority = dto.priority;
      entries.push({ type: 'updated', field: 'priority', from: task.priority, to: dto.priority });
    }
    if (dto.estimate !== undefined && dto.estimate !== task.estimate) {
      this.support.assertEstimate(project, dto.estimate);
      data.estimate = dto.estimate;
      entries.push({ type: 'updated', field: 'estimate', from: task.estimate, to: dto.estimate });
    }
    if (dto.startDate !== undefined) {
      const next = dto.startDate ? new Date(dto.startDate) : null;
      if ((next?.getTime() ?? null) !== (task.startDate?.getTime() ?? null)) {
        data.startDate = next;
        entries.push({ type: 'updated', field: 'startDate', from: task.startDate?.toISOString() ?? null, to: next?.toISOString() ?? null });
      }
    }
    if (dto.dueDate !== undefined) {
      const next = dto.dueDate ? new Date(dto.dueDate) : null;
      if ((next?.getTime() ?? null) !== (task.dueDate?.getTime() ?? null)) {
        data.dueDate = next;
        entries.push({ type: 'updated', field: 'dueDate', from: task.dueDate?.toISOString() ?? null, to: next?.toISOString() ?? null });
      }
    }

    // ---- agile planning fields
    let sprintTouched = false;
    let nextSprint: Pick<import('../generated/prisma/client.js').Sprint, 'id' | 'name' | 'state'> | null | undefined;
    if (dto.sprintId !== undefined) {
      if (dto.sprintId === (task.sprintId ?? null)) nextSprint = undefined;
      else if (dto.sprintId === null) nextSprint = null;
      else nextSprint = await this.support.resolveSprint(tx, project.id, dto.sprintId);
    }
    // A task finished in a closed sprint that is reopened goes back to the backlog.
    if (nextSprint === undefined && task.sprint?.state === 'COMPLETED' && data.status && !(await this.isDone(tx, dto.statusId))) {
      nextSprint = null;
    }
    if (nextSprint !== undefined) {
      if (task.sprint?.state === 'COMPLETED' && task.status.category === 'DONE' && !(data.status && !(await this.isDone(tx, dto.statusId)))) {
        throw new BadRequestException('This task was finished in a closed sprint');
      }
      if (nextSprint && newType === 'EPIC') throw new BadRequestException('Epics cannot be planned into a sprint');
      if (nextSprint && task.archivedAt) throw new BadRequestException('Archived tasks cannot be planned into a sprint');
      const openFrom = task.sprint && task.sprint.state !== 'COMPLETED' ? task.sprint : null;
      await this.support.trackSprintChange(tx, task, openFrom, nextSprint);
      data.sprint = nextSprint ? { connect: { id: nextSprint.id } } : { disconnect: true };
      entries.push({ type: 'updated', field: 'sprint', from: task.sprint?.name ?? null, to: nextSprint?.name ?? null });
      sprintTouched = true;
    }
    if (dto.releaseId !== undefined && dto.releaseId !== (task.releaseId ?? null)) {
      const release = dto.releaseId ? await this.support.resolveRelease(tx, project.id, dto.releaseId) : null;
      const before = task.releaseId ? await tx.release.findUnique({ where: { id: task.releaseId } }) : null;
      data.release = release ? { connect: { id: release.id } } : { disconnect: true };
      entries.push({ type: 'updated', field: 'release', from: before?.name ?? null, to: release?.name ?? null });
    }
    if (dto.milestoneId !== undefined && dto.milestoneId !== (task.milestoneId ?? null)) {
      const milestone = dto.milestoneId ? await this.support.resolveMilestone(tx, project.id, dto.milestoneId) : null;
      const before = task.milestoneId ? await tx.milestone.findUnique({ where: { id: task.milestoneId } }) : null;
      data.milestone = milestone ? { connect: { id: milestone.id } } : { disconnect: true };
      entries.push({ type: 'updated', field: 'milestone', from: before?.name ?? null, to: milestone?.name ?? null });
    }
    if (dto.acceptanceCriteria !== undefined) {
      const next = dto.acceptanceCriteria?.trim() || null;
      if (next !== task.acceptanceCriteria) {
        data.acceptanceCriteria = next;
        entries.push({ type: 'updated', field: 'acceptanceCriteria' });
      }
    }

    if (dto.assigneeIds !== undefined) {
      const next = await this.support.assertAssignees(tx, m.workspaceId, project, dto.assigneeIds);
      const prev = task.assignees.map((a) => a.userId);
      const added = next.filter((id) => !prev.includes(id));
      const removed = prev.filter((id) => !next.includes(id));
      if (added.length || removed.length) {
        await tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: removed } } });
        await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId, userId })) });
        await tx.taskWatcher.createMany({ data: added.map((userId) => ({ taskId, userId })), skipDuplicates: true });
        entries.push({ type: 'updated', field: 'assignees', from: prev, to: next });
        if (added.length) events.push({ name: TaskEvents.assigned, payload: { ...base, assigneeIds: added } });
      }
    }

    if (dto.labelIds !== undefined) {
      const labels = await this.support.assertLabels(tx, project.id, dto.labelIds);
      const prev = new Set(task.labels.map((l) => l.labelId));
      const next = new Set(labels.map((l) => l.id));
      if (prev.size !== next.size || [...next].some((id) => !prev.has(id))) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        await tx.taskLabel.createMany({ data: labels.map((l) => ({ taskId, labelId: l.id })) });
        entries.push({
          type: 'updated', field: 'labels',
          from: task.labels.map((l) => l.label.name).sort(), to: labels.map((l) => l.name).sort(),
        });
      }
    }

    if (dto.customFields !== undefined) {
      const defs = await this.support.customFieldDefs(tx, project.id);
      const input = this.support.normalizeCustomInput(defs, dto.customFields);
      const existing = new Map((await tx.taskCustomValue.findMany({ where: { taskId } })).map((v) => [v.fieldId, v.value]));
      for (const [fieldId, { def, value }] of input) {
        const prev = existing.get(fieldId) ?? null;
        if (JSON.stringify(prev) === JSON.stringify(value)) continue;
        if (value === null) await tx.taskCustomValue.deleteMany({ where: { taskId, fieldId } });
        else {
          await tx.taskCustomValue.upsert({
            where: { taskId_fieldId: { taskId, fieldId } },
            create: { taskId, fieldId, value },
            update: { value },
          });
        }
        entries.push({ type: 'updated', field: `custom:${def.name}`, from: prev as Prisma.InputJsonValue | null, to: value });
      }
    }

    if (entries.length === 0) return;
    if (Object.keys(data).length) await tx.task.update({ where: { id: taskId }, data });
    else await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
    await this.activity.record(tx, taskId, m.userId, entries);
    const fields = entries.map((e) => e.field ?? e.type);
    // Sprints whose burndown may have changed: the old and new one, or the current one if progress changed.
    const sprintIds = new Set<string>();
    if (sprintTouched) {
      if (task.sprintId) sprintIds.add(task.sprintId);
      if (nextSprint) sprintIds.add(nextSprint.id);
    } else if (task.sprintId && fields.some((f) => f === 'status' || f === 'estimate')) {
      sprintIds.add(task.sprintId);
    }
    events.push({ name: TaskEvents.updated, payload: { ...base, fields, ...(sprintIds.size ? { sprintIds: [...sprintIds] } : {}) } });
  }

  private async isDone(tx: Tx, statusId: string | undefined): Promise<boolean> {
    if (!statusId) return false;
    return (await tx.projectStatus.findUnique({ where: { id: statusId } }))?.category === 'DONE';
  }

  // ---------- archive / delete ----------

  async setArchived(m: Membership, ref: string, archived: boolean): Promise<TaskDetailDto> {
    const { task, project } = await this.access.load(m, ref, { write: true });
    if (archived !== (task.archivedAt !== null)) {
      await this.prisma.$transaction(async (tx) => {
        await tx.task.update({ where: { id: task.id }, data: { archivedAt: archived ? new Date() : null } });
        await this.activity.record(tx, task.id, m.userId, [{ type: archived ? 'archived' : 'restored' }]);
      });
      this.events.emit(TaskEvents.updated, {
        workspaceId: m.workspaceId, projectId: task.projectId, taskId: task.id, taskKey: taskKey(project.key, task.number),
        actorId: m.userId, fields: ['archived'], ...(task.sprintId ? { sprintIds: [task.sprintId] } : {}),
      });
    }
    return this.detail(m, task.id);
  }

  async remove(m: Membership, ref: string) {
    const { task, manage, project } = await this.access.load(m, ref, { write: true });
    if (!manage && task.reporterId !== m.userId) {
      throw new ForbiddenException('Only the reporter or a project admin can delete a task');
    }
    const files = await this.prisma.attachment.findMany({ where: { taskId: task.id }, select: { storageKey: true } });
    await this.prisma.task.delete({ where: { id: task.id } });
    await Promise.all(files.map((f) => this.storage.delete(f.storageKey).catch(() => undefined)));
    this.events.emit(TaskEvents.deleted, {
      workspaceId: m.workspaceId, projectId: project.id, taskId: task.id,
      taskKey: taskKey(project.key, task.number), actorId: m.userId,
      ...(task.sprintId ? { sprintIds: [task.sprintId] } : {}),
    });
  }

  // ---------- bulk ----------

  async bulkUpdate(m: Membership, taskIds: string[], changes: BulkChangesDto): Promise<BulkResultDto> {
    const ids = [...new Set(taskIds)];
    const rows = await this.prisma.task.findMany({
      where: { id: { in: ids }, project: { workspaceId: m.workspaceId } },
      include: { labels: true },
    });
    if (rows.length !== ids.length) throw new NotFoundException('Some tasks were not found');

    const projects = new Map<string, Project>();
    for (const projectId of new Set(rows.map((r) => r.projectId))) {
      projects.set(projectId, (await this.projects.load(m, projectId, { write: true })).project);
    }
    if (changes.statusId && projects.size > 1) {
      throw new BadRequestException('Status can only be changed in bulk for tasks of a single project');
    }

    const events: TaskEvent[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const project = projects.get(row.projectId)!;
        const dto: UpdateTaskDto = {};
        if (changes.statusId !== undefined) dto.statusId = changes.statusId;
        if (changes.priority !== undefined) dto.priority = changes.priority;
        if (changes.assigneeIds !== undefined) dto.assigneeIds = changes.assigneeIds;
        if (changes.dueDate !== undefined) dto.dueDate = changes.dueDate;
        if (changes.sprintId !== undefined) dto.sprintId = changes.sprintId;
        if (changes.releaseId !== undefined) dto.releaseId = changes.releaseId;
        if (changes.milestoneId !== undefined) dto.milestoneId = changes.milestoneId;
        if (changes.addLabelIds || changes.removeLabelIds) {
          const labels = new Set(row.labels.map((l) => l.labelId));
          changes.addLabelIds?.forEach((id) => labels.add(id));
          changes.removeLabelIds?.forEach((id) => labels.delete(id));
          dto.labelIds = [...labels];
        }
        await this.applyUpdate(tx, m, project, row.id, dto, events);
        if (changes.archived !== undefined && changes.archived !== (row.archivedAt !== null)) {
          await tx.task.update({ where: { id: row.id }, data: { archivedAt: changes.archived ? new Date() : null } });
          await this.activity.record(tx, row.id, m.userId, [{ type: changes.archived ? 'archived' : 'restored' }]);
        }
      }
    });
    this.emit(events);
    return { updated: rows.length };
  }
}
