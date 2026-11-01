import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

interface Card { id: string; key: string; title: string; position: number; status: { id: string; name: string } }
interface Column { status: { id: string; name: string; wipLimit: number | null }; total: number; tasks: Card[]; hasMore: boolean }

describe('Board & ranking (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, vic: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [alice, bob, vic] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Vic')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [vic, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const status = (name: string) => project.statuses.find((s) => s.name === name)!.id;
  const mk = (title: string, body: Record<string, unknown> = {}, user = alice) =>
    http().post(api(`/projects/${project.id}/tasks`)).set(user.auth).send({ title, ...body }).expect(201).then((r) => r.body as { id: string; key: string });
  const rank = (ref: string, body: Record<string, unknown>, user = alice) =>
    http().post(api(`/tasks/${ref}/rank`)).set(user.auth).send(body);
  const board = async (qs = '', user = alice) =>
    (await http().get(api(`/projects/${project.id}/board${qs}`)).set(user.auth).expect(200)).body as { columns: Column[]; epics: { key: string }[] };
  const col = async (name: string, qs = '') => (await board(qs)).columns.find((c) => c.status.name === name)!;
  const titles = async (name: string) => (await col(name)).tasks.map((t) => t.title);

  describe('board', () => {
    it('returns a column per status, in workflow order, with ranked cards', async () => {
      await mk('A'); await mk('B'); await mk('C', { statusId: status('Done') });
      const b = await board();
      expect(b.columns.map((c) => c.status.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
      expect(b.columns.map((c) => c.total)).toEqual([2, 0, 0, 1]);
      expect(await titles('To Do')).toEqual(['A', 'B']);
      expect((await col('To Do')).tasks[0]).toMatchObject({ key: 'SYN-1', status: { name: 'To Do' } });
    });

    it('hides sub-tasks by default, lists epics for swimlanes, and filters', async () => {
      const epic = await mk('Epic', { type: 'EPIC' });
      const story = await mk('Story', { type: 'STORY', parentId: epic.id, assigneeIds: [bob.id] });
      await mk('Sub', { type: 'SUBTASK', parentId: story.id });
      await mk('Other', { priority: 'HIGH' });
      const b = await board();
      expect(b.epics.map((e) => e.key)).toEqual(['SYN-1']);
      expect((await titles('To Do')).sort()).toEqual(['Epic', 'Other', 'Story']);
      expect((await col('To Do', '?excludeSubtasks=false')).tasks).toHaveLength(4);
      expect(await titles('To Do').then(() => col('To Do', `?assignee=${bob.id}`).then((c) => c.tasks.map((t) => t.title)))).toEqual(['Story']);
      expect((await col('To Do', '?priority=HIGH')).total).toBe(1);
      expect((await col('To Do', '?q=stor')).total).toBe(1);
    });

    it('caps each column and reports the real total', async () => {
      for (let i = 0; i < 5; i++) await mk(`T${i}`);
      const c = await col('To Do', '?limit=2');
      expect(c).toMatchObject({ total: 5, hasMore: true });
      expect(c.tasks).toHaveLength(2);
      expect((await col('To Do', '?limit=10')).hasMore).toBe(false);
      await http().get(api(`/projects/${project.id}/board?limit=999`)).set(alice.auth).expect(400);
    });

    it('respects project visibility', async () => {
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      await http().get(api(`/projects/${priv.id}/board`)).set(bob.auth).expect(404);
      await http().get(api(`/projects/${priv.id}/board`)).set(alice.auth).expect(200);
      await http().get(api(`/projects/${project.id}/board`)).set(vic.auth).expect(200); // viewers can look
    });

    it('exposes WIP limits and validates them', async () => {
      const url = api(`/projects/${project.id}/statuses/${status('In Progress')}`);
      await http().patch(url).set(alice.auth).send({ wipLimit: 2 }).expect(200);
      expect((await col('In Progress')).status.wipLimit).toBe(2);
      await http().patch(url).set(alice.auth).send({ wipLimit: 0 }).expect(400);
      await http().patch(url).set(bob.auth).send({ wipLimit: 3 }).expect(403);
      await http().patch(url).set(alice.auth).send({ wipLimit: null }).expect(200);
      expect((await col('In Progress')).status.wipLimit).toBeNull();
      const created = await http().post(api(`/projects/${project.id}/statuses`)).set(alice.auth).send({ name: 'Blocked', category: 'IN_PROGRESS', wipLimit: 1 }).expect(201);
      expect(created.body.wipLimit).toBe(1);
    });
  });

  describe('ranking', () => {
    it('reorders within a column', async () => {
      await mk('A'); await mk('B'); await mk('C');
      await rank('SYN-3', { beforeId: (await col('To Do')).tasks[0].id }).expect(200); // C above A
      expect(await titles('To Do')).toEqual(['C', 'A', 'B']);
      await rank('SYN-3', { afterId: (await col('To Do')).tasks[2].id }).expect(200); // C below B
      expect(await titles('To Do')).toEqual(['A', 'B', 'C']);
      await rank('SYN-1', {}).expect(200); // no neighbour = bottom
      expect(await titles('To Do')).toEqual(['B', 'C', 'A']);
      const mid = (await col('To Do')).tasks;
      await rank('SYN-1', { beforeId: mid[1].id }).expect(200); // between B and C
      expect(await titles('To Do')).toEqual(['B', 'A', 'C']);
    });

    it('moves cards between columns, changing status and recording it', async () => {
      await mk('A'); await mk('B');
      const doing = await rank('SYN-1', { statusId: status('In Progress') }).expect(200);
      expect(doing.body).toMatchObject({ key: 'SYN-1', status: { name: 'In Progress' } });
      expect(doing.body.startedAt).toBeTruthy();
      expect(await titles('To Do')).toEqual(['B']);
      expect(await titles('In Progress')).toEqual(['A']);

      await rank('SYN-2', { statusId: status('In Progress'), beforeId: (await col('In Progress')).tasks[0].id }).expect(200);
      expect(await titles('In Progress')).toEqual(['B', 'A']);
      await rank('SYN-1', { statusId: status('Done') }).expect(200);
      expect((await task('SYN-1')).completedAt).toBeTruthy();

      const acts = (await http().get(api('/tasks/SYN-1/activity')).set(alice.auth)).body as { field: string; from: string; to: string }[];
      expect(acts.filter((a) => a.field === 'status').map((a) => `${a.from}>${a.to}`)).toEqual(['In Progress>Done', 'To Do>In Progress']);
    });

    const task = async (ref: string) => (await http().get(api(`/tasks/${ref}`)).set(alice.auth)).body;

    it('puts a card changed through the form at the bottom of its new column', async () => {
      await mk('A', { statusId: status('Done') }); await mk('B');
      await http().patch(api('/tasks/SYN-2')).set(alice.auth).send({ statusId: status('Done') }).expect(200);
      expect(await titles('Done')).toEqual(['A', 'B']);
    });

    it('validates requests', async () => {
      await mk('A'); await mk('B', { statusId: status('Done') });
      const inDone = (await col('Done')).tasks[0].id;
      await rank('SYN-1', { beforeId: inDone, afterId: inDone }).expect(400); // both
      await rank('SYN-1', { beforeId: inDone }).expect(400); // neighbour is in another column
      await rank('SYN-1', { statusId: 'nope' }).expect(400);
      await rank('SYN-1', { beforeId: (await col('To Do')).tasks[0].id }).expect(400); // itself
      await rank('SYN-1', {}, vic).expect(403);
      await rank('SYN-9', {}).expect(404);
      await http().post(api('/tasks/SYN-1/archive')).set(alice.auth).expect(200);
      await rank('SYN-1', {}).expect(400);
    });

    it('converges under concurrent drags: every card exactly once, distinct positions', async () => {
      const keys: string[] = [];
      for (let i = 0; i < 8; i++) keys.push((await mk(`T${i}`)).key);
      const ids = (await col('To Do')).tasks.map((t) => t.id);
      // everyone grabs a different card and drops it above the first one, at once
      const results = await Promise.all(keys.slice(1).map((k) => rank(k, { beforeId: ids[0] })));
      expect(results.map((r) => r.status)).toEqual(Array(7).fill(200));

      const tasks = (await col('To Do')).tasks;
      expect(tasks).toHaveLength(8);
      expect(new Set(tasks.map((t) => t.id)).size).toBe(8);
      expect(new Set(tasks.map((t) => t.position)).size).toBe(8);
      expect(tasks[7].title).toBe('T0'); // the reference card ended up last
      // and a second read returns the identical order
      expect((await col('To Do')).tasks.map((t) => t.id)).toEqual(tasks.map((t) => t.id));
    });

    it('allocates distinct positions when cards are created concurrently', async () => {
      await Promise.all(Array.from({ length: 10 }, (_, i) => mk(`C${i}`)));
      const tasks = (await col('To Do')).tasks;
      expect(tasks).toHaveLength(10);
      expect(new Set(tasks.map((t) => t.position)).size).toBe(10);
    });

    it('survives concurrent drags between columns', async () => {
      for (let i = 0; i < 6; i++) await mk(`T${i}`);
      const columns = ['In Progress', 'In Review', 'Done'];
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => rank(`SYN-${i + 1}`, { statusId: status(columns[i % 3]) })));
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      const b = await board();
      expect(b.columns.map((c) => c.total)).toEqual([0, 2, 2, 2]);
      for (const c of b.columns) expect(new Set(c.tasks.map((t) => t.position)).size).toBe(c.tasks.length);
    });

    it('rebalances a column when positions run out of room, preserving order', async () => {
      const a = await mk('A'); await mk('spacer');
      const x = await mk('X'); const y = await mk('Y'); await mk('B');
      // Order is creation order: A, spacer, X, Y, B. Keep wedging cards just left of B so the gap halves each time.
      const expected = ['A', 'spacer', 'X', 'Y', 'B'];
      const move = async (card: { key: string }, name: string) => {
        const column = (await col('To Do')).tasks;
        const target = column.find((t) => t.title === 'B')!;
        await rank(card.key, { beforeId: target.id }).expect(200);
        expected.splice(expected.indexOf(name), 1);
        expected.splice(expected.indexOf('B'), 0, name);
      };
      for (let i = 0; i < 40; i++) await move(i % 2 === 0 ? x : y, i % 2 === 0 ? 'X' : 'Y');
      const tasks = (await col('To Do')).tasks;
      expect(tasks.map((t) => t.title)).toEqual(expected);
      expect(new Set(tasks.map((t) => t.position)).size).toBe(5);
      void a;
      // without a rebalance, 40 halvings would have collapsed the gap below float-safe resolution
      const gaps = tasks.slice(1).map((t, i) => t.position - tasks[i].position);
      expect(Math.min(...gaps)).toBeGreaterThan(1e-4);
    }, 60_000);
  });

  describe('start dates', () => {
    it('stores, logs and sorts by planned start', async () => {
      const a = await mk('A', { startDate: '2026-03-10' });
      await mk('B', { startDate: '2026-03-01' });
      await mk('C');
      const list = async (qs: string) => (await http().get(api(`/tasks?${qs}`)).set(alice.auth).expect(200)).body.items.map((t: { title: string }) => t.title);
      expect(await list('sort=startDate&order=asc')).toEqual(['B', 'A', 'C']); // nulls last
      await http().patch(api(`/tasks/${a.key}`)).set(alice.auth).send({ startDate: '2026-02-01' }).expect(200);
      expect(await list('sort=startDate&order=asc')).toEqual(['A', 'B', 'C']);
      const acts = (await http().get(api(`/tasks/${a.key}/activity`)).set(alice.auth)).body as { field: string }[];
      expect(acts.some((x) => x.field === 'startDate')).toBe(true);
      const cleared = await http().patch(api(`/tasks/${a.key}`)).set(alice.auth).send({ startDate: null }).expect(200);
      expect(cleared.body.startDate).toBeNull();
    });
  });
});
