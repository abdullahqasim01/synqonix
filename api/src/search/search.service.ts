import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { Membership } from '../generated/prisma/client.js';
import { ChannelAccessService } from '../channels/channel-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { statusDto } from '../tasks/task-mapper.js';
import type { SearchResultDto } from './dto/search.dto.js';
import { escapeLike, hasFilters, makeSnippet, parseQuery, type ParsedQuery } from './query-parser.js';

const KINDS = ['tasks', 'comments', 'projects', 'channels', 'messages', 'people'] as const;
type Kind = (typeof KINDS)[number];

const TASK_TYPES = ['TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK'];
const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const CANDIDATES = 300;

/**
 * Workspace search. Text is matched with Postgres full-text search (stemming), trigram similarity
 * (typos) and plain substring matching; the database only proposes candidates, and every result is
 * then re-read through the same visibility rules the rest of the API uses, so nobody finds what
 * they could not open.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  private visibleProjects(m: Membership): Prisma.ProjectWhereInput {
    return { AND: [{ workspaceId: m.workspaceId }, this.projects.visibleProjects(m)] };
  }

  async search(m: Membership, q: string, typesCsv: string | undefined, limit = 8, now = new Date()): Promise<SearchResultDto> {
    const parsed = parseQuery(q);
    const wanted = new Set<Kind>(typesCsv ? (typesCsv.split(',').map((t) => t.trim()) as Kind[]).filter((t) => KINDS.includes(t)) : KINDS);
    // Filters only make sense for tasks.
    const taskOnly = hasFilters(parsed);
    const want = (k: Kind) => wanted.has(k) && (!taskOnly || k === 'tasks');

    const empty = { tasks: [], comments: [], projects: [], channels: [], messages: [], people: [] } as Omit<SearchResultDto, 'query'>;
    const result: SearchResultDto = { query: { text: parsed.text, filters: parsed.filters as Record<string, string[]> }, ...empty };
    if (!parsed.text && !taskOnly) return result;

    const [tasks, comments, projects, channels, messages, people] = await Promise.all([
      want('tasks') ? this.tasks(m, parsed, limit, now) : [],
      want('comments') && parsed.text ? this.comments(m, parsed.text, limit) : [],
      want('projects') && parsed.text ? this.projectHits(m, parsed.text, limit) : [],
      want('channels') && parsed.text ? this.channels(m, parsed.text, limit) : [],
      want('messages') && parsed.text ? this.messages(m, parsed.text, limit) : [],
      want('people') && parsed.text ? this.people(m, parsed.text, limit) : [],
    ]);
    return { ...result, tasks, comments, projects, channels, messages, people };
  }

  // ---------------------------------------------------------------- tasks

  private async taskCandidates(workspaceId: string, text: string): Promise<string[]> {
    const like = `%${escapeLike(text)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT t."id",
        GREATEST(
          CASE WHEN upper(p."key" || '-' || t."number") = upper(${text}) THEN 10 ELSE 0 END,
          CASE WHEN t."title" ILIKE ${like} THEN 1 ELSE 0 END,
          similarity(t."title", ${text}) * 2,
          ts_rank(to_tsvector('english', t."title" || ' ' || coalesce(t."description", '')), websearch_to_tsquery('english', ${text}))
        ) AS score
      FROM "Task" t JOIN "Project" p ON p."id" = t."projectId"
      WHERE p."workspaceId" = ${workspaceId}
        AND (
          upper(p."key" || '-' || t."number") = upper(${text})
          OR t."title" ILIKE ${like}
          OR t."title" % ${text}
          OR to_tsvector('english', t."title" || ' ' || coalesce(t."description", '')) @@ websearch_to_tsquery('english', ${text})
        )
      ORDER BY score DESC, t."updatedAt" DESC
      LIMIT ${CANDIDATES}`);
    return rows.map((r) => r.id);
  }

  private taskFilters(m: Membership, f: ParsedQuery['filters'], now: Date): Prisma.TaskWhereInput[] {
    const and: Prisma.TaskWhereInput[] = [];
    const assignee = (value: string): Prisma.TaskWhereInput => {
      const v = value.toLowerCase();
      if (v === 'me') return { assignees: { some: { userId: m.userId } } };
      if (v === 'none' || v === 'unassigned') return { assignees: { none: {} } };
      return { assignees: { some: { user: { name: { contains: value, mode: 'insensitive' } } } } };
    };
    for (const v of f.assignee ?? []) and.push(assignee(v));
    for (const v of f.reporter ?? []) {
      if (v.toLowerCase() === 'me') and.push({ reporterId: m.userId });
      else and.push({ reporterId: { in: [] } }); // names for reporters are not indexed; only "me" is supported
    }
    for (const v of f.status ?? []) {
      const l = v.toLowerCase();
      if (l === 'open') and.push({ status: { category: { not: 'DONE' } } });
      else if (l === 'done' || l === 'closed') and.push({ status: { category: 'DONE' } });
      else and.push({ status: { name: { equals: v, mode: 'insensitive' } } });
    }
    for (const v of f.label ?? []) and.push({ labels: { some: { label: { name: { equals: v, mode: 'insensitive' } } } } });
    for (const v of f.type ?? []) and.push(TASK_TYPES.includes(v.toUpperCase()) ? { type: v.toUpperCase() as never } : { id: { in: [] } });
    for (const v of f.priority ?? []) and.push(PRIORITIES.includes(v.toUpperCase()) ? { priority: v.toUpperCase() as never } : { id: { in: [] } });
    for (const v of f.project ?? []) and.push({ project: { key: { equals: v, mode: 'insensitive' } } });
    for (const v of f.is ?? []) {
      const l = v.toLowerCase();
      if (l === 'open') and.push({ status: { category: { not: 'DONE' } } });
      else if (l === 'done') and.push({ status: { category: 'DONE' } });
      else if (l === 'overdue') and.push({ dueDate: { lt: now }, status: { category: { not: 'DONE' } } });
      else if (l === 'archived') and.push({ archivedAt: { not: null } });
      else and.push({ id: { in: [] } });
    }
    return and;
  }

  private async tasks(m: Membership, parsed: ParsedQuery, limit: number, now: Date) {
    const candidates = parsed.text ? await this.taskCandidates(m.workspaceId, parsed.text) : null;
    const archived = (parsed.filters.is ?? []).some((v) => v.toLowerCase() === 'archived');
    const rows = await this.prisma.task.findMany({
      where: {
        AND: [
          { project: this.visibleProjects(m) }, archived ? {} : { archivedAt: null },
          ...(candidates ? [{ id: { in: candidates } }] : []), ...this.taskFilters(m, parsed.filters, now),
        ],
      },
      include: { project: { select: { key: true } }, status: true },
      orderBy: candidates ? undefined : { updatedAt: 'desc' },
      take: candidates ? CANDIDATES : limit,
    });
    const rank = new Map((candidates ?? []).map((id, i) => [id, i]));
    const ordered = candidates ? rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, limit) : rows;
    const terms = parsed.text.split(/\s+/);
    return ordered.map((t) => ({
      id: t.id, key: `${t.project.key}-${t.number}`, title: t.title, type: t.type, status: statusDto(t.status), projectId: t.projectId,
      snippet: parsed.text && t.description && !t.title.toLowerCase().includes(parsed.text.toLowerCase()) ? makeSnippet(t.description, terms) : null,
    }));
  }

  // ---------------------------------------------------------------- comments, messages

  private async comments(m: Membership, text: string, limit: number) {
    const like = `%${escapeLike(text)}%`;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT c."id" FROM "Comment" c
      JOIN "Task" t ON t."id" = c."taskId" JOIN "Project" p ON p."id" = t."projectId"
      WHERE p."workspaceId" = ${m.workspaceId}
        AND (c."body" ILIKE ${like} OR to_tsvector('english', c."body") @@ websearch_to_tsquery('english', ${text}))
      ORDER BY ts_rank(to_tsvector('english', c."body"), websearch_to_tsquery('english', ${text})) DESC, c."createdAt" DESC
      LIMIT ${CANDIDATES}`);
    const rows = await this.prisma.comment.findMany({
      where: { id: { in: ids.map((r) => r.id) }, task: { archivedAt: null, project: this.visibleProjects(m) } },
      include: { task: { select: { number: true, title: true, project: { select: { key: true } } } } },
    });
    const rank = new Map(ids.map((r, i) => [r.id, i]));
    const top = rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, limit);
    const authors = await this.names(top.map((c) => c.authorId));
    return top.map((c) => ({
      id: c.id, taskKey: `${c.task.project.key}-${c.task.number}`, taskTitle: c.task.title, authorName: c.authorId ? authors.get(c.authorId) ?? null : null,
      snippet: makeSnippet(c.body, text.split(/\s+/)), createdAt: c.createdAt,
    }));
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async messages(m: Membership, text: string, limit: number) {
    const like = `%${escapeLike(text)}%`;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT msg."id" FROM "Message" msg JOIN "Channel" c ON c."id" = msg."channelId"
      WHERE c."workspaceId" = ${m.workspaceId} AND msg."deletedAt" IS NULL
        AND (msg."body" ILIKE ${like} OR to_tsvector('english', msg."body") @@ websearch_to_tsquery('english', ${text}))
      ORDER BY ts_rank(to_tsvector('english', msg."body"), websearch_to_tsquery('english', ${text})) DESC, msg."createdAt" DESC
      LIMIT ${CANDIDATES}`);
    const rows = await this.prisma.message.findMany({
      where: { id: { in: ids.map((r) => r.id) }, deletedAt: null, channel: { is: this.channelAccess.visibleWhere(m) } },
      include: { channel: { select: { id: true, name: true, type: true, members: { select: { userId: true, user: { select: { name: true } } } } } } },
    });
    const rank = new Map(ids.map((r, i) => [r.id, i]));
    const top = rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, limit);
    const authors = await this.names(top.map((x) => x.authorId));
    return top.map((x) => ({
      id: x.id, channelId: x.channelId, channelName: this.channelName(x.channel, m.userId), authorName: x.authorId ? authors.get(x.authorId) ?? null : null,
      snippet: makeSnippet(x.body, text.split(/\s+/)), createdAt: x.createdAt,
    }));
  }

  private channelName(c: { name: string | null; type: string; members: { userId: string; user: { name: string } }[] }, userId: string) {
    if (c.type !== 'DIRECT') return c.name ?? 'channel';
    const others = c.members.filter((x) => x.userId !== userId).map((x) => x.user.name);
    return others.length ? others.join(', ') : 'Just you';
  }

  // ---------------------------------------------------------------- projects, channels, people

  private async projectHits(m: Membership, text: string, limit: number) {
    const rows = await this.prisma.project.findMany({
      where: { AND: [this.visibleProjects(m), { archivedAt: null }, { OR: [{ name: { contains: text, mode: 'insensitive' } }, { key: { contains: text, mode: 'insensitive' } }] }] },
      select: { id: true, key: true, name: true }, take: 50,
    });
    const t = text.toLowerCase();
    const score = (p: { key: string; name: string }) => (p.key.toLowerCase() === t ? 0 : p.name.toLowerCase().startsWith(t) || p.key.toLowerCase().startsWith(t) ? 1 : 2);
    return rows.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, limit);
  }

  private async channels(m: Membership, text: string, limit: number) {
    const rows = await this.prisma.channel.findMany({
      where: {
        AND: [
          this.channelAccess.visibleWhere(m), { archivedAt: null },
          { OR: [{ name: { contains: text, mode: 'insensitive' } }, { type: 'DIRECT', members: { some: { user: { name: { contains: text, mode: 'insensitive' } } } } }] },
        ],
      },
      include: { members: { select: { userId: true, user: { select: { name: true } } } } }, take: 50,
    });
    return rows
      .map((c) => ({ id: c.id, type: c.type, name: this.channelName(c, m.userId), projectId: c.projectId }))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }

  private async people(m: Membership, text: string, limit: number) {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId: m.workspaceId, user: { OR: [{ name: { contains: text, mode: 'insensitive' } }, { email: { contains: text, mode: 'insensitive' } }] } },
      include: { user: { select: { id: true, name: true, email: true } } }, take: 50,
    });
    return rows.map((r) => ({ userId: r.user.id, name: r.user.name, email: r.user.email })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }
}
