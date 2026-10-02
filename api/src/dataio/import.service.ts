import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Membership, TaskPriority, TaskType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { parseCsv } from './csv.js';
import type { ImportMessageDto, ImportOptionsDto, ImportResultDto, ImportRowDto } from './dto/dataio.dto.js';
import {
  cleanCell, detectMapping, hasTitle, parseDate, parseNumber, parsePriority, parseType, splitList, statusCategoryGuess,
  type ColumnMapping, type ImportField,
} from './import-fields.js';

const MAX_ROWS = 5000;
const MAX_REPORTED = 500;
const DEFAULT_LABEL_COLOR = '#6366f1';

type Values = Partial<Record<ImportField, string>>;
interface RawRow { line: number; values: Values }

interface Plan {
  line: number;
  externalId: string;
  title: string;
  description: string | null;
  statusId: string;
  priority: TaskPriority;
  type: TaskType;
  assigneeIds: string[];
  labels: string[];
  estimate?: number;
  timeEstimate?: number;
  startDate?: string;
  dueDate?: string;
  parentRef: string | null;
  messages: ImportMessageDto[];
}

const err = (text: string): ImportMessageDto => ({ level: 'error', text });
const warn = (text: string): ImportMessageDto => ({ level: 'warning', text });

/** Turns a spreadsheet or JSON export from us, Jira or GitHub into tasks, reporting every row. */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  // ---------------------------------------------------------------- reading the file

  private readCsv(text: string, explicit: Record<string, string>): { mapping: ColumnMapping[]; rows: RawRow[] } {
    const table = parseCsv(text);
    if (table.length === 0) throw new BadRequestException('The file is empty');
    const mapping = detectMapping(table[0], explicit);
    if (!hasTitle(mapping)) throw new BadRequestException('No title column found. Name a column "Title" or "Summary", or map one explicitly.');
    const rows = table.slice(1).map((cells, i): RawRow => {
      const values: Values = {};
      for (const c of mapping) {
        if (c.field === 'ignore') continue;
        const cell = cleanCell(cells[c.index] ?? '');
        // Jira repeats columns such as Labels; their values are combined.
        if (cell) values[c.field] = values[c.field] ? `${values[c.field]};${cell}` : cell;
      }
      return { line: i + 2, values };
    });
    return { mapping, rows };
  }

  private readJson(text: string): { mapping: ColumnMapping[]; rows: RawRow[] } {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new BadRequestException('The file is not valid JSON'); }
    const list = Array.isArray(data) ? data : (data as { tasks?: unknown })?.tasks;
    if (!Array.isArray(list)) throw new BadRequestException('Expected a list of tasks, or an object with a "tasks" list');
    const str = (v: unknown) => (v === null || v === undefined ? undefined : Array.isArray(v) ? v.join(';') : String(v));
    const rows = list.map((item: Record<string, unknown>, i): RawRow => ({
      line: i + 1,
      values: {
        externalId: str(item.key ?? item.id), title: str(item.title), description: str(item.description), status: str(item.status), priority: str(item.priority),
        type: str(item.type), assignees: str(item.assignees), labels: str(item.labels), estimate: str(item.estimate), timeEstimate: str(item.timeEstimateMinutes),
        startDate: str(item.startDate), dueDate: str(item.dueDate), parent: str(item.parent),
      },
    }));
    const fields: ImportField[] = ['externalId', 'title', 'description', 'status', 'priority', 'type', 'assignees', 'labels', 'estimate', 'timeEstimate', 'startDate', 'dueDate', 'parent'];
    return { mapping: fields.map((field, index) => ({ column: field, index, field })), rows };
  }

  // ---------------------------------------------------------------- run

  async run(m: Membership, projectId: string, file: Express.Multer.File | undefined, opts: ImportOptionsDto): Promise<ImportResultDto> {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    const { project } = await this.projects.load(m, projectId, { write: true });
    if (project.archivedAt) throw new BadRequestException('This project is archived');
    const source = opts.source ?? 'csv';
    const dryRun = opts.dryRun ?? false;
    let explicit: Record<string, string> = {};
    if (opts.mapping) {
      try { explicit = JSON.parse(opts.mapping) as Record<string, string>; } catch { throw new BadRequestException('"mapping" must be a JSON object'); }
    }

    const text = file.buffer.toString('utf8');
    const isJson = /\.json$/i.test(file.originalname) || /^\s*[[{]/.test(text);
    const { mapping, rows } = isJson ? this.readJson(text) : this.readCsv(text, explicit);
    if (rows.length === 0) throw new BadRequestException('The file has no rows');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Too many rows (limit ${MAX_ROWS}); split the file`);

    const [statuses, members, labels, existing] = await Promise.all([
      this.prisma.projectStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
      this.prisma.membership.findMany({ where: { workspaceId: m.workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } }),
      this.prisma.label.findMany({ where: { projectId } }),
      this.prisma.taskImport.findMany({ where: { projectId, source }, include: { task: { select: { number: true } } } }),
    ]);
    const imported = new Map(existing.map((e) => [e.externalId, { taskId: e.taskId, key: `${project.key}-${e.task.number}` }]));
    const people = new Map<string, string>();
    for (const x of members) { people.set(x.user.name.toLowerCase(), x.userId); people.set(x.user.email.toLowerCase(), x.userId); }

    // ---- plan every row (no writes)
    const results = new Map<number, ImportRowDto>();
    const plans: Plan[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const plan = this.plan(raw, statuses, people);
      const messages = plan.messages;
      const hasError = messages.some((x) => x.level === 'error');
      if (!hasError && seen.has(plan.externalId)) messages.push(err('The same id appears more than once in this file'));
      seen.add(plan.externalId);
      const prior = imported.get(plan.externalId);
      if (messages.some((x) => x.level === 'error')) results.set(raw.line, { row: raw.line, status: 'error', key: null, messages });
      else if (prior) results.set(raw.line, { row: raw.line, status: 'skipped', key: prior.key, messages: [...messages, warn('Already imported')] });
      else plans.push(plan);
    }

    // ---- write
    if (dryRun) {
      for (const p of plans) results.set(p.line, { row: p.line, status: 'created', key: null, messages: p.messages });
    } else {
      await this.write(m, projectId, project.key, source, plans, labels, imported, results);
    }

    const all = [...results.values()].sort((a, b) => a.row - b.row);
    const count = (s: ImportRowDto['status']) => all.filter((r) => r.status === s).length;
    const interesting = all.filter((r) => r.status !== 'created' || r.messages.length > 0);
    return {
      dryRun, source, total: rows.length, created: count('created'), skipped: count('skipped'), failed: count('error'),
      warnings: all.reduce((n, r) => n + r.messages.filter((x) => x.level === 'warning').length, 0),
      columns: mapping.map((c) => ({ column: c.column, field: c.field })),
      rows: interesting.slice(0, MAX_REPORTED), truncated: interesting.length > MAX_REPORTED,
    };
  }

  // ---------------------------------------------------------------- planning one row

  private plan(raw: RawRow, statuses: { id: string; name: string; category: string }[], people: Map<string, string>): Plan {
    const v = raw.values;
    const messages: ImportMessageDto[] = [];
    const title = (v.title ?? '').trim();
    if (!title) messages.push(err('Title is empty'));
    else if (title.length > 300) messages.push(warn('Title was shortened to 300 characters'));

    let statusId = statuses.find((s) => s.category === 'TODO')?.id ?? statuses[0].id;
    if (v.status) {
      const exact = statuses.find((s) => s.name.toLowerCase() === v.status!.trim().toLowerCase());
      if (exact) statusId = exact.id;
      else if (['open', 'closed'].includes(v.status.trim().toLowerCase())) {
        // GitHub's two states need no warning; they land in the first to-do / done status.
        statusId = (statuses.find((s) => s.category === (v.status!.trim().toLowerCase() === 'open' ? 'TODO' : 'DONE')) ?? statuses[0]).id;
      } else {
        const guess = statusCategoryGuess(v.status);
        // GitHub's open/closed fall out of the same guess.
        statusId = (statuses.find((s) => s.category === guess) ?? statuses[0]).id;
        messages.push(warn(`Status "${v.status}" does not exist here; used ${statuses.find((s) => s.id === statusId)!.name}`));
      }
    }

    let priority: TaskPriority = 'NONE';
    if (v.priority) {
      const p = parsePriority(v.priority);
      if (p) priority = p;
      else messages.push(warn(`Unknown priority "${v.priority}"; left empty`));
    }
    let type: TaskType = 'TASK';
    if (v.type) {
      const t = parseType(v.type);
      if (t) type = t;
      else messages.push(warn(`Unknown type "${v.type}"; imported as a task`));
    }

    const assigneeIds: string[] = [];
    for (const name of splitList(v.assignees ?? '')) {
      const id = people.get(name.toLowerCase());
      if (id) assigneeIds.push(id);
      else messages.push(warn(`No workspace member matches "${name}"`));
    }

    const number = (field: 'estimate' | 'timeEstimate', label: string) => {
      if (!v[field]) return undefined;
      const n = parseNumber(v[field]!);
      if (n === null || n < 0) { messages.push(err(`${label} "${v[field]}" is not a number`)); return undefined; }
      return n;
    };
    const estimate = number('estimate', 'Estimate');
    const timeEstimate = number('timeEstimate', 'Time estimate');
    const date = (field: 'startDate' | 'dueDate', label: string) => {
      if (!v[field]) return undefined;
      const d = parseDate(v[field]!);
      if (!d) { messages.push(err(`${label} "${v[field]}" is not a date`)); return undefined; }
      return d.toISOString();
    };
    const startDate = date('startDate', 'Start date');
    const dueDate = date('dueDate', 'Due date');

    const externalId = (v.externalId ?? '').trim() || `row:${createHash('sha1').update(`${title}\n${v.description ?? ''}\n${v.status ?? ''}`).digest('hex').slice(0, 16)}`;
    return {
      line: raw.line, externalId, title: title.slice(0, 300), description: v.description?.trim() || null, statusId, priority, type, assigneeIds,
      labels: splitList(v.labels ?? ''), estimate, timeEstimate, startDate, dueDate, parentRef: (v.parent ?? '').trim() || null, messages,
    };
  }

  // ---------------------------------------------------------------- creating

  private async write(
    m: Membership, projectId: string, projectKey: string, source: string, plans: Plan[], labels: { id: string; name: string }[],
    imported: Map<string, { taskId: string; key: string }>, results: Map<number, ImportRowDto>,
  ) {
    // Labels that do not exist yet are created once.
    const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
    for (const name of new Set(plans.flatMap((p) => p.labels))) {
      if (byName.has(name.toLowerCase())) continue;
      const created = await this.prisma.label.create({ data: { projectId, name: name.slice(0, 40), color: DEFAULT_LABEL_COLOR } }).catch(() => null);
      if (created) byName.set(name.toLowerCase(), created.id);
    }

    const created = new Map<string, { taskId: string; key: string }>(imported);
    const resolveParent = async (ref: string | null) => {
      if (!ref) return null;
      const hit = created.get(ref);
      if (hit) return hit;
      const k = /^([A-Za-z][A-Za-z0-9]+)-(\d+)$/.exec(ref);
      if (k && k[1].toUpperCase() === projectKey) {
        const t = await this.prisma.task.findFirst({ where: { projectId, number: Number(k[2]) }, select: { id: true } });
        if (t) return { taskId: t.id, key: ref.toUpperCase() };
      }
      return null;
    };
    const inFile = new Set(plans.map((p) => p.externalId));

    const create = async (p: Plan, parentId: string | null) => {
      const labelIds = p.labels.map((n) => byName.get(n.toLowerCase())).filter((x): x is string => !!x);
      const dto = {
        title: p.title, type: p.type, ...(p.description ? { description: p.description } : {}), statusId: p.statusId, priority: p.priority,
        assigneeIds: p.assigneeIds, labelIds, ...(p.estimate !== undefined ? { estimate: p.estimate } : {}),
        ...(p.timeEstimate !== undefined ? { timeEstimateMinutes: Math.round(p.timeEstimate) } : {}),
        ...(p.startDate ? { startDate: p.startDate } : {}), ...(p.dueDate ? { dueDate: p.dueDate } : {}), ...(parentId ? { parentId } : {}),
      };
      return this.tasks.create(m, projectId, dto, { silent: true });
    };

    const attempt = async (p: Plan, parentId: string | null): Promise<void> => {
      let task;
      try {
        task = await create(p, parentId);
      } catch (e) {
        const reason = (e as { message?: string }).message ?? 'could not be created';
        if (parentId) {
          p.messages.push(warn(`Parent ignored: ${reason}`));
          return attempt(p, null);
        }
        if (p.type === 'SUBTASK') {
          p.messages.push(warn('A sub-task needs a parent; imported as a task'));
          p.type = 'TASK';
          return attempt(p, null);
        }
        results.set(p.line, { row: p.line, status: 'error', key: null, messages: [...p.messages, err(reason)] });
        return;
      }
      await this.prisma.taskImport.create({ data: { projectId, source, externalId: p.externalId, taskId: task.id } }).catch(() => undefined);
      created.set(p.externalId, { taskId: task.id, key: task.key });
      results.set(p.line, { row: p.line, status: 'created', key: task.key, messages: p.messages });
    };

    // Parents first: rows whose parent is later in the file wait for their turn.
    let pending = [...plans];
    while (pending.length > 0) {
      const next: Plan[] = [];
      let progressed = false;
      for (const p of pending) {
        const waiting = p.parentRef && inFile.has(p.parentRef) && !created.has(p.parentRef) && p.parentRef !== p.externalId;
        if (waiting) { next.push(p); continue; }
        const parent = await resolveParent(p.parentRef);
        if (p.parentRef && !parent) p.messages.push(warn(`Parent "${p.parentRef}" not found`));
        await attempt(p, parent?.taskId ?? null);
        progressed = true;
      }
      if (!progressed) { // a cycle of parents: create the rest without parents
        for (const p of next) { p.messages.push(warn('Parent chain loops; imported without a parent')); await attempt(p, null); }
        break;
      }
      pending = next;
    }
  }
}
