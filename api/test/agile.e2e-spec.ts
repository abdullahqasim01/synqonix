import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SprintTracker } from '../src/agile/sprint-tracker.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

interface Sprint { id: string; number: number; name: string; state: string; stats: { taskCount: number; doneCount: number; points: number; donePoints: number }; summary: Record<string, number> | null }
interface Point { reason: string; scopePoints: number; donePoints: number; remainingPoints: number; scopeTasks: number; doneTasks: number }

describe('Agile (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, vic: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const pj = (p = '') => api(`/projects/${project.id}${p}`);

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [alice, bob, vic] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Vic')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [vic, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const status = (name: string) => project.statuses.find((s) => s.name === name)!.id;
  const mk = (title: string, body: Record<string, unknown> = {}, user = alice, pid = project.id) =>
    http().post(api(`/projects/${pid}/tasks`)).set(user.auth).send({ title, ...body }).expect(201).then((r) => r.body as { id: string; key: string; sprint: { id: string } | null });
  const createSprint = (body: Record<string, unknown> = {}, user = alice) => http().post(pj('/sprints')).set(user.auth).send(body);
  const newSprint = async (body: Record<string, unknown> = {}) => (await createSprint(body).expect(201)).body as Sprint;
  const addToSprint = (sprintId: string, taskIds: string[], user = alice) => http().post(pj(`/sprints/${sprintId}/tasks`)).set(user.auth).send({ taskIds });
  const startSprint = (id: string, body: Record<string, unknown> = {}, user = alice) => http().post(pj(`/sprints/${id}/start`)).set(user.auth).send(body);
  const completeSprint = (id: string, body: Record<string, unknown>, user = alice) => http().post(pj(`/sprints/${id}/complete`)).set(user.auth).send(body);
  const patch = (ref: string, body: Record<string, unknown>, user = alice) => http().patch(api(`/tasks/${ref}`)).set(user.auth).send(body);
  const getTask = async (ref: string, user = alice) => (await http().get(api(`/tasks/${ref}`)).set(user.auth).expect(200)).body;
  const getSprint = async (id: string) => (await http().get(pj(`/sprints/${id}`)).set(alice.auth).expect(200)).body as Sprint;
  const burndown = async (id: string) => (await http().get(pj(`/sprints/${id}/burndown`)).set(alice.auth).expect(200)).body as { points: Point[]; ideal: { date: string; remaining: number }[]; sprint: Sprint };
  const done = (ref: string) => patch(ref, { statusId: status('Done') }).expect(200);

  /** Scope-change snapshots are written asynchronously after the request; wait for the expected state. */
  async function waitForPoints(id: string, pred: (pts: Point[]) => boolean, ms = 3000) {
    const end = Date.now() + ms;
    let pts: Point[] = [];
    while (Date.now() < end) {
      pts = (await burndown(id)).points;
      if (pred(pts)) return pts;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`timed out waiting for snapshots, have ${JSON.stringify(pts)}`);
  }

  describe('project agile settings', () => {
    it('derives the methodology from the template and allows changing the settings', async () => {
      expect((await http().get(pj()).set(alice.auth)).body).toMatchObject({ methodology: 'SCRUM', estimationUnit: 'POINTS', sprintDurationDays: 14, definitionOfDone: null });
      const kanban = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS', template: 'KANBAN' })).body;
      expect(kanban.methodology).toBe('KANBAN');
      const res = await http().patch(pj()).set(alice.auth).send({ estimationUnit: 'HOURS', sprintDurationDays: 7, definitionOfDone: '- tests pass\n- reviewed' }).expect(200);
      expect(res.body).toMatchObject({ estimationUnit: 'HOURS', sprintDurationDays: 7, definitionOfDone: '- tests pass\n- reviewed' });
      await http().patch(pj()).set(alice.auth).send({ sprintDurationDays: 0 }).expect(400);
      await http().patch(pj()).set(bob.auth).send({ estimationUnit: 'POINTS' }).expect(403);
      await http().patch(pj()).set(alice.auth).send({ definitionOfDone: null }).expect(200);
    });

    it('only offers sprints in Scrum projects, and protects a running sprint when switching', async () => {
      const s = await newSprint();
      await addToSprint(s.id, [(await mk('A')).id]).expect(200);
      await startSprint(s.id).expect(200);
      await http().patch(pj()).set(alice.auth).send({ methodology: 'KANBAN' }).expect(400);
      await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(200);
      await http().patch(pj()).set(alice.auth).send({ methodology: 'KANBAN' }).expect(200);
      await createSprint().expect(400);
      await startSprint(s.id).expect(400);
    });

    it('validates T-shirt estimates', async () => {
      await http().patch(pj()).set(alice.auth).send({ estimationUnit: 'TSHIRT' }).expect(200);
      await mk('ok', { estimate: 5 });
      await http().post(pj('/tasks')).set(alice.auth).send({ title: 'bad', estimate: 4 }).expect(400);
      await patch('SYN-1', { estimate: 4 }).expect(400);
      await patch('SYN-1', { estimate: 13 }).expect(200);
      await patch('SYN-1', { estimate: null }).expect(200);
    });
  });

  describe('sprints', () => {
    it('creates numbered sprints, edits them and deletes planned ones', async () => {
      const a = await newSprint({ goal: 'Ship login', capacity: 20 });
      const b = await newSprint({ name: 'Hardening' });
      expect([a.number, a.name, b.number, b.name]).toEqual([1, 'Sprint 1', 2, 'Hardening']);
      expect((await http().get(pj('/sprints')).set(vic.auth).expect(200)).body.map((s: Sprint) => s.name)).toEqual(['Sprint 1', 'Hardening']);
      await createSprint({ startDate: '2026-03-10', endDate: '2026-03-01' }).expect(400);
      await createSprint({}, bob).expect(403); // sprint management needs project admin rights
      await createSprint({}, vic).expect(403);

      const upd = await http().patch(pj(`/sprints/${a.id}`)).set(alice.auth).send({ name: 'Auth sprint', goal: null, capacity: 25, startDate: '2026-03-02', endDate: '2026-03-13' }).expect(200);
      expect(upd.body).toMatchObject({ name: 'Auth sprint', goal: null, capacity: 25 });
      await http().patch(pj(`/sprints/${a.id}`)).set(alice.auth).send({ endDate: '2026-03-01' }).expect(400);
      await http().patch(pj(`/sprints/${a.id}`)).set(bob.auth).send({ name: 'x' }).expect(403);

      const t = await mk('Planned');
      await addToSprint(b.id, [t.id]).expect(200);
      await http().delete(pj(`/sprints/${b.id}`)).set(alice.auth).expect(204);
      expect((await getTask(t.key)).sprint).toBeNull(); // back in the backlog
      await http().get(pj(`/sprints/${b.id}`)).set(alice.auth).expect(404);
    });

    it('plans tasks into sprints and keeps stats and history', async () => {
      const s1 = await newSprint(); const s2 = await newSprint();
      const a = await mk('A', { estimate: 3 }); const b = await mk('B', { estimate: 5 });
      const epic = await mk('Epic', { type: 'EPIC' });
      expect((await addToSprint(s1.id, [a.id, b.id], bob)).body).toEqual({ updated: 2 });
      await addToSprint(s1.id, [epic.id]).expect(400); // epics are not sprintable
      await addToSprint(s1.id, [a.id], vic).expect(403);
      await addToSprint(s1.id, ['ghost']).expect(404);
      expect((await getSprint(s1.id)).stats).toEqual({ taskCount: 2, doneCount: 0, points: 8, donePoints: 0 });
      expect((await getTask(a.key)).sprint).toMatchObject({ id: s1.id, name: 'Sprint 1', state: 'PLANNED' });

      // moving to another sprint, then back to the backlog through the task itself
      await addToSprint(s2.id, [a.id]).expect(200);
      expect((await getSprint(s1.id)).stats.taskCount).toBe(1);
      await patch(b.key, { sprintId: null }).expect(200);
      expect((await getSprint(s1.id)).stats.taskCount).toBe(0);
      const acts = (await http().get(api(`/tasks/${a.key}/activity`)).set(alice.auth)).body as { field: string; from: string | null; to: string | null }[];
      expect(acts.filter((x) => x.field === 'sprint').map((x) => `${x.from}>${x.to}`)).toEqual(['Sprint 1>Sprint 2', 'null>Sprint 1']);

      // removal endpoint
      await http().delete(pj(`/sprints/${s1.id}/tasks/${a.key}`)).set(alice.auth).expect(404); // not in s1 any more
      await http().delete(pj(`/sprints/${s2.id}/tasks/${a.key}`)).set(alice.auth).expect(200);
      expect((await getTask(a.key)).sprint).toBeNull();
      await patch(a.key, { sprintId: 'missing' }).expect(400);
      // creating a task straight into a sprint
      const direct = await mk('Direct', { sprintId: s1.id, estimate: 2 });
      expect(direct.sprint).toMatchObject({ id: s1.id });
      await http().post(pj('/tasks')).set(alice.auth).send({ title: 'Epic in sprint', type: 'EPIC', sprintId: s1.id }).expect(400);
    });

    it('filters tasks by sprint', async () => {
      const s = await newSprint();
      const a = await mk('In sprint'); await mk('Backlog');
      await addToSprint(s.id, [a.id]);
      const keys = async (qs: string) => (await http().get(api(`/tasks?${qs}`)).set(alice.auth).expect(200)).body.items.map((t: { key: string }) => t.key);
      expect(await keys(`sprintId=${s.id}`)).toEqual(['SYN-1']);
      expect(await keys('sprintId=none')).toEqual(['SYN-2']);
      expect(await keys('sprintId=active')).toEqual([]);
      await startSprint(s.id).expect(200);
      expect(await keys('sprintId=active')).toEqual(['SYN-1']);
      // the board can show just the active sprint
      const board = (await http().get(pj('/board?sprintId=active')).set(alice.auth).expect(200)).body;
      expect(board.columns[0].tasks.map((t: { key: string }) => t.key)).toEqual(['SYN-1']);
    });

    it('starts a sprint once, with default dates and committed scope', async () => {
      const s = await newSprint({ capacity: 10 });
      await addToSprint(s.id, [(await mk('A', { estimate: 3 })).id, (await mk('B', { estimate: 5 })).id]);
      await startSprint(s.id, {}, bob).expect(403);
      const started = (await startSprint(s.id).expect(200)).body as Sprint & { startDate: string; endDate: string };
      expect(started.state).toBe('ACTIVE');
      expect(started.summary).toMatchObject({ committedPoints: 8, committedTasks: 2 });
      expect(new Date(started.endDate).getTime() - new Date(started.startDate).getTime()).toBe(14 * 24 * 3600 * 1000);

      const second = await newSprint();
      await startSprint(second.id).expect(409); // one active sprint at a time
      await startSprint(s.id).expect(400); // already active
      await http().delete(pj(`/sprints/${s.id}`)).set(alice.auth).expect(400);
      expect((await startSprint(second.id, { startDate: '2026-03-10', endDate: '2026-03-05' })).status).toBe(400);
    });
  });

  describe('burndown data', () => {
    it('records a point at start and on every scope or progress change', async () => {
      const s = await newSprint();
      const a = await mk('A', { estimate: 3 }); const b = await mk('B', { estimate: 5 });
      await addToSprint(s.id, [a.id, b.id]);
      await startSprint(s.id, { startDate: '2026-03-02T09:00:00Z', endDate: '2026-03-06T17:00:00Z' }).expect(200);
      let pts = await waitForPoints(s.id, (p) => p.length === 1);
      expect(pts[0]).toMatchObject({ reason: 'START', scopePoints: 8, donePoints: 0, remainingPoints: 8, scopeTasks: 2 });

      await done(a.key);                                   // progress
      pts = await waitForPoints(s.id, (p) => p.length === 2);
      expect(pts[1]).toMatchObject({ reason: 'SCOPE_CHANGE', scopePoints: 8, donePoints: 3, remainingPoints: 5, doneTasks: 1 });

      const c = await mk('C', { estimate: 2 });
      await addToSprint(s.id, [c.id]);                     // scope added
      pts = await waitForPoints(s.id, (p) => p.length === 3);
      expect(pts[2]).toMatchObject({ scopePoints: 10, donePoints: 3, remainingPoints: 7, scopeTasks: 3 });

      await patch(b.key, { estimate: 8 }).expect(200);     // re-estimate
      pts = await waitForPoints(s.id, (p) => p.length === 4);
      expect(pts[3]).toMatchObject({ scopePoints: 13, remainingPoints: 10 });

      await http().delete(pj(`/sprints/${s.id}/tasks/${c.key}`)).set(alice.auth).expect(200); // scope removed
      pts = await waitForPoints(s.id, (p) => p.length === 5);
      expect(pts[4]).toMatchObject({ scopePoints: 11, scopeTasks: 2 });

      await http().post(api(`/tasks/${b.key}/archive`)).set(alice.auth).expect(200);          // archived work leaves the scope
      pts = await waitForPoints(s.id, (p) => p.length === 6);
      expect(pts[5]).toMatchObject({ scopePoints: 3, scopeTasks: 1 });

      // no-op edits do not add noise
      await patch(a.key, { title: 'A renamed' }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect((await burndown(s.id)).points).toHaveLength(6);

      const report = await burndown(s.id);
      expect(report.ideal.map((p) => p.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
      expect(report.ideal.map((p) => p.remaining)).toEqual([8, 6, 4, 2, 0]); // from the committed scope of 8
      // live view of the scope changes made so far: C (2 pts) was added after the start, then removed again
      expect(report.sprint.summary).toMatchObject({ committedPoints: 8, addedPoints: 2, removedPoints: 2 });
    });

    it('adds a daily point when a new day begins, without duplicating it', async () => {
      const s = await newSprint();
      await addToSprint(s.id, [(await mk('A', { estimate: 2 })).id]);
      await startSprint(s.id).expect(200);
      await waitForPoints(s.id, (p) => p.length === 1);
      const before = (await burndown(s.id)).points.length;
      expect((await burndown(s.id)).points.length).toBe(before); // same day: nothing added

      // pretend everything recorded so far happened two days ago
      await prisma.sprintSnapshot.updateMany({ where: { sprintId: s.id }, data: { at: new Date(Date.now() - 2 * 24 * 3600 * 1000) } });
      const pts = (await burndown(s.id)).points;
      expect(pts.map((p) => p.reason)).toEqual(['START', 'DAILY']);
      expect((await burndown(s.id)).points).toHaveLength(2);

      // the scheduled job does the same for sprints nobody is looking at
      await prisma.sprintSnapshot.updateMany({ where: { sprintId: s.id }, data: { at: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
      await app.get(SprintTracker).recordDailySnapshots();
      await app.get(SprintTracker).recordDailySnapshots(); // idempotent
      expect((await burndown(s.id)).points.filter((p) => p.reason === 'DAILY')).toHaveLength(2); // the earlier one plus today's
    });
  });

  describe('completing a sprint', () => {
    async function runningSprint() {
      const s = await newSprint({ goal: 'Login' });
      const a = await mk('A done', { estimate: 3 }); const b = await mk('B open', { estimate: 5 }); const c = await mk('C open', { estimate: 2 });
      await addToSprint(s.id, [a.id, b.id, c.id]);
      await startSprint(s.id).expect(200);
      await done(a.key);
      return { s, a, b, c };
    }

    it('carries unfinished tasks to the backlog and snapshots the results', async () => {
      const { s, a, b } = await runningSprint();
      const extra = await mk('Late', { estimate: 1 });
      await addToSprint(s.id, [extra.id]); // scope creep
      await completeSprint(s.id, { carryOver: 'BACKLOG' }, bob).expect(403);
      await completeSprint(s.id, { carryOver: 'SPRINT' }).expect(400); // needs a target
      const res = (await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(200)).body;
      expect(res).toMatchObject({ carriedOverCount: 3, nextSprint: null, sprint: { state: 'COMPLETED' } });
      expect(res.sprint.summary).toEqual({
        committedPoints: 10, committedTasks: 3, addedPoints: 1, removedPoints: 0,
        completedPoints: 3, completedTasks: 1, carriedOverPoints: 8, carriedOverTasks: 3,
      });
      expect((await getTask(a.key)).sprint).toMatchObject({ id: s.id, state: 'COMPLETED' }); // finished work keeps its sprint
      expect((await getTask(b.key)).sprint).toBeNull();
      // final point of the burndown is taken before tasks move
      const pts = (await burndown(s.id)).points;
      expect(pts.at(-1)).toMatchObject({ reason: 'COMPLETE', scopePoints: 11, donePoints: 3, remainingPoints: 8 });

      // closed sprints are read-only
      await startSprint(s.id).expect(400);
      await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(400);
      await addToSprint(s.id, [b.id]).expect(400);
      await http().patch(pj(`/sprints/${s.id}`)).set(alice.auth).send({ capacity: 5 }).expect(400);
      await http().patch(pj(`/sprints/${s.id}`)).set(alice.auth).send({ name: 'Login sprint', goal: 'Done' }).expect(200);
      await patch(a.key, { sprintId: null }).expect(400); // finished work cannot leave
    });

    it('can carry work into the next planned sprint, creating one when needed', async () => {
      const { s, b, c } = await runningSprint();
      const res = (await completeSprint(s.id, { carryOver: 'NEXT_SPRINT' }).expect(200)).body;
      expect(res.nextSprint).toMatchObject({ number: 2, name: 'Sprint 2', state: 'PLANNED', stats: { taskCount: 2, points: 7 } });
      expect((await getTask(b.key)).sprint).toMatchObject({ id: res.nextSprint.id });
      expect((await getTask(c.key)).sprint).toMatchObject({ id: res.nextSprint.id });

      // next time an existing planned sprint is used
      await startSprint(res.nextSprint.id).expect(200);
      const planned = await newSprint({ name: 'Later' });
      const second = (await completeSprint(res.nextSprint.id, { carryOver: 'NEXT_SPRINT' }).expect(200)).body;
      expect(second.nextSprint.id).toBe(planned.id);
    });

    it('can carry work into a chosen planned sprint, and validates the target', async () => {
      const { s, b } = await runningSprint();
      const target = await newSprint({ name: 'Target' });
      await completeSprint(s.id, { carryOver: 'SPRINT', targetSprintId: 'missing' }).expect(400);
      await completeSprint(s.id, { carryOver: 'SPRINT', targetSprintId: s.id }).expect(400); // not planned
      const res = (await completeSprint(s.id, { carryOver: 'SPRINT', targetSprintId: target.id }).expect(200)).body;
      expect(res.nextSprint.id).toBe(target.id);
      expect((await getTask(b.key)).sprint).toMatchObject({ id: target.id });
      const acts = (await http().get(api(`/tasks/${b.key}/activity`)).set(alice.auth)).body as { field: string; to: string | null }[];
      expect(acts.some((a) => a.field === 'sprint' && a.to === 'Target')).toBe(true);
    });

    it('sends reopened tasks of a closed sprint back to the backlog', async () => {
      const { s, a } = await runningSprint();
      await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(200);
      await patch(a.key, { statusId: status('In Progress') }).expect(200);
      expect((await getTask(a.key)).sprint).toBeNull();
    });

    it('counts removed scope in the summary', async () => {
      const { s, c } = await runningSprint();
      await http().delete(pj(`/sprints/${s.id}/tasks/${c.key}`)).set(alice.auth).expect(200);
      const res = (await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(200)).body;
      expect(res.sprint.summary).toMatchObject({ committedPoints: 10, removedPoints: 2, carriedOverTasks: 1 });
    });

    it('reports velocity across completed sprints', async () => {
      expect((await http().get(pj('/velocity')).set(alice.auth).expect(200)).body).toMatchObject({ unit: 'points', sprints: [], average: 0 });
      for (const [points, doneCount] of [[3, 1], [8, 1], [5, 1]] as const) {
        const s = await newSprint();
        const t = await mk(`T${points}`, { estimate: points });
        await mk(`open${points}`, { estimate: 1, sprintId: s.id });
        await addToSprint(s.id, [t.id]);
        await startSprint(s.id).expect(200);
        await done(t.key);
        await completeSprint(s.id, { carryOver: 'BACKLOG' }).expect(200);
        expect(doneCount).toBe(1);
      }
      const v = (await http().get(pj('/velocity')).set(vic.auth).expect(200)).body;
      expect(v.sprints.map((x: { completedPoints: number }) => x.completedPoints)).toEqual([3, 8, 5]); // oldest first
      expect(v.sprints[1]).toMatchObject({ number: 2, committedPoints: 9, carriedOverPoints: 1, completedTasks: 1 });
      expect(v.average).toBeCloseTo(5.33, 1);
      expect(v.recentAverage).toBeCloseTo(5.33, 1);
      expect((await http().get(pj('/velocity?limit=2')).set(alice.auth)).body.sprints.map((x: { number: number }) => x.number)).toEqual([2, 3]);
    });
  });

  describe('backlog', () => {
    it('lists sprints with their tasks above the ranked backlog', async () => {
      const s1 = await newSprint(); const s2 = await newSprint();
      const [a, b, c, d] = [await mk('A', { estimate: 2 }), await mk('B', { estimate: 3 }), await mk('C', { estimate: 5 }), await mk('D done', { statusId: status('Done') })];
      await mk('Epic', { type: 'EPIC' });
      await mk('Sub', { type: 'SUBTASK', parentId: a.id });
      await addToSprint(s1.id, [a.id]); await addToSprint(s2.id, [b.id]);
      await startSprint(s1.id).expect(200);

      const res = (await http().get(pj('/backlog')).set(vic.auth).expect(200)).body;
      expect(res.sprints.map((x: { sprint: Sprint }) => [x.sprint.name, x.sprint.state])).toEqual([['Sprint 1', 'ACTIVE'], ['Sprint 2', 'PLANNED']]);
      expect(res.sprints[0].tasks.map((t: { key: string }) => t.key)).toEqual(['SYN-1']);
      expect(res.backlog.tasks.map((t: { key: string }) => t.key)).toEqual(['SYN-3']); // done, epic and sub-task hidden
      expect(res.backlog).toMatchObject({ total: 1, points: 5 });
      expect(res.epics.map((e: { key: string }) => e.key)).toEqual(['SYN-5']);
      const withDone = (await http().get(pj('/backlog?includeDone=true')).set(alice.auth)).body.backlog.tasks.map((t: { key: string }) => t.key);
      expect(withDone).toEqual(['SYN-3', 'SYN-4']);
      expect(c.key + d.key).toBe('SYN-3SYN-4');
      const filtered = (await http().get(pj('/backlog?q=A')).set(alice.auth)).body;
      expect(filtered.sprints[0].tasks).toHaveLength(1);
      expect(filtered.backlog.total).toBe(0);
    });

    it('plans by dragging: moves tasks between lists and orders them', async () => {
      const s = await newSprint();
      const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];
      const rank = (ref: string, body: Record<string, unknown>, user = alice) => http().post(api(`/tasks/${ref}/backlog-rank`)).set(user.auth).send(body);
      const backlog = async () => (await http().get(pj('/backlog')).set(alice.auth)).body as { sprints: { tasks: { title: string }[] }[]; backlog: { tasks: { title: string; id: string }[] } };
      const titles = async () => { const r = await backlog(); return { sprint: r.sprints[0].tasks.map((t) => t.title), backlog: r.backlog.tasks.map((t) => t.title) }; };

      await rank(a.key, { sprintId: s.id }).expect(200);
      await rank(b.key, { sprintId: s.id, afterId: a.id }).expect(200);
      await rank(c.key, { sprintId: s.id, beforeId: a.id }).expect(200);
      expect(await titles()).toEqual({ sprint: ['C', 'A', 'B'], backlog: [] });
      expect((await getTask(a.key)).sprint).toMatchObject({ id: s.id });

      await rank(a.key, { sprintId: null }).expect(200);          // back to the backlog
      await rank(c.key, { sprintId: null, afterId: a.id }).expect(200);
      expect(await titles()).toEqual({ sprint: ['B'], backlog: ['A', 'C'] });
      await rank(c.key, { sprintId: null, beforeId: a.id }).expect(200);
      expect((await titles()).backlog).toEqual(['C', 'A']);

      await rank(a.key, { sprintId: s.id, beforeId: c.id }).expect(400); // neighbour is in another list
      await rank(a.key, { sprintId: s.id, beforeId: a.id }).expect(400);
      await rank(a.key, { sprintId: s.id, beforeId: b.id, afterId: b.id }).expect(400);
      await rank(a.key, { sprintId: 'missing' }).expect(400);
      await rank(a.key, { sprintId: s.id }, vic).expect(403);
      await rank(a.key, {}).expect(400); // sprintId is required (null = backlog)

      // the board shows the same relative order for tasks sharing a column
      const col = (await http().get(pj('/board')).set(alice.auth)).body.columns[0].tasks.map((t: { title: string }) => t.title);
      expect(col.indexOf('C')).toBeLessThan(col.indexOf('A'));
    });
  });

  describe('releases', () => {
    it('manages releases and shows progress', async () => {
      const r = (await http().post(pj('/releases')).set(alice.auth).send({ name: 'v1.0', releaseDate: '2026-06-01', description: 'First release' }).expect(201)).body;
      await http().post(pj('/releases')).set(alice.auth).send({ name: 'v1.0' }).expect(409);
      await http().post(pj('/releases')).set(bob.auth).send({ name: 'v2' }).expect(403);
      const a = await mk('A', { releaseId: r.id }); const b = await mk('B', { releaseId: r.id }); await mk('C');
      await done(a.key);
      let list = (await http().get(pj('/releases')).set(vic.auth).expect(200)).body;
      expect(list[0]).toMatchObject({ name: 'v1.0', status: 'UNRELEASED', counts: { total: 2, done: 1 } });
      expect((await getTask(a.key)).release).toEqual({ id: r.id, name: 'v1.0' });
      await patch(b.key, { releaseId: 'missing' }).expect(400);
      const upd = await http().patch(pj(`/releases/${r.id}`)).set(alice.auth).send({ name: 'v1.0.0', description: null }).expect(200);
      expect(upd.body).toMatchObject({ name: 'v1.0.0', description: null });

      const keys = async (qs: string) => (await http().get(api(`/tasks?${qs}`)).set(alice.auth)).body.items.map((t: { key: string }) => t.key);
      expect(await keys(`releaseId=${r.id}&sort=number`)).toEqual(['SYN-1', 'SYN-2']);
      expect(await keys('releaseId=none')).toEqual(['SYN-3']);

      await http().patch(pj(`/releases/${r.id}`)).set(alice.auth).send({ status: 'ARCHIVED' }).expect(200);
      list = (await http().get(pj('/releases')).set(alice.auth)).body;
      expect(list[0].status).toBe('ARCHIVED');
      await http().delete(pj(`/releases/${r.id}`)).set(alice.auth).expect(204);
      expect((await getTask(a.key)).release).toBeNull();
    });

    it('ships a release, optionally moving unfinished work, and writes release notes', async () => {
      const v1 = (await http().post(pj('/releases')).set(alice.auth).send({ name: 'v1', description: 'Intro text' }).expect(201)).body;
      const v2 = (await http().post(pj('/releases')).set(alice.auth).send({ name: 'v2' }).expect(201)).body;
      const story = await mk('Login page', { type: 'STORY', releaseId: v1.id, statusId: status('Done') });
      const bug = await mk('Crash on save', { type: 'BUG', releaseId: v1.id, statusId: status('Done') });
      const chore = await mk('Update deps', { type: 'TASK', releaseId: v1.id, statusId: status('Done') });
      const open = await mk('Not finished', { releaseId: v1.id });

      const notes = (await http().get(pj(`/releases/${v1.id}/notes`)).set(vic.auth).expect(200)).body;
      expect(notes.unfinished).toBe(1);
      expect(notes.sections.map((s: { title: string }) => s.title)).toEqual(['Features', 'Bug fixes', 'Tasks']);
      expect(notes.markdown).toBe('# v1\n\nIntro text\n\n## Features\n- SYN-1 Login page\n\n## Bug fixes\n- SYN-2 Crash on save\n\n## Tasks\n- SYN-3 Update deps\n');
      expect(story.key + bug.key + chore.key).toBe('SYN-1SYN-2SYN-3');

      await http().post(pj(`/releases/${v1.id}/ship`)).set(bob.auth).send({}).expect(403);
      await http().post(pj(`/releases/${v1.id}/ship`)).set(alice.auth).send({ moveUnfinishedTo: v1.id }).expect(400);
      await http().post(pj(`/releases/${v1.id}/ship`)).set(alice.auth).send({ moveUnfinishedTo: 'missing' }).expect(400);
      const shipped = (await http().post(pj(`/releases/${v1.id}/ship`)).set(alice.auth).send({ moveUnfinishedTo: v2.id }).expect(200)).body;
      expect(shipped).toMatchObject({ status: 'RELEASED', counts: { total: 3, done: 3 } });
      expect(shipped.releasedAt).toBeTruthy();
      expect((await getTask(open.key)).release).toMatchObject({ name: 'v2' });
      await http().post(pj(`/releases/${v1.id}/ship`)).set(alice.auth).send({}).expect(400); // already shipped
      await http().patch(pj(`/releases/${v1.id}`)).set(alice.auth).send({ status: 'UNRELEASED' }).expect(400);
      expect((await http().get(pj(`/releases/${v1.id}/notes`)).set(alice.auth)).body.markdown).toContain('Released ');
      expect((await http().get(pj(`/releases/${v2.id}/notes`)).set(alice.auth)).body.markdown).toContain('_No finished work yet._');
    });
  });

  describe('milestones', () => {
    it('groups tasks, tracks progress and can be closed and reopened', async () => {
      const m = (await http().post(pj('/milestones')).set(alice.auth).send({ name: 'Beta', dueDate: '2026-05-01' }).expect(201)).body;
      await http().post(pj('/milestones')).set(alice.auth).send({ name: 'Beta' }).expect(409);
      await http().post(pj('/milestones')).set(bob.auth).send({ name: 'x' }).expect(403);
      const a = await mk('A', { milestoneId: m.id }); await mk('B', { milestoneId: m.id });
      await done(a.key);
      expect((await http().get(pj('/milestones')).set(vic.auth)).body[0]).toMatchObject({ name: 'Beta', closedAt: null, counts: { total: 2, done: 1 } });
      const closed = (await http().patch(pj(`/milestones/${m.id}`)).set(alice.auth).send({ closed: true }).expect(200)).body;
      expect(closed.closedAt).toBeTruthy();
      expect((await http().patch(pj(`/milestones/${m.id}`)).set(alice.auth).send({ closed: false })).body.closedAt).toBeNull();
      expect((await getTask(a.key)).milestone).toEqual({ id: m.id, name: 'Beta' });
      const keys = (await http().get(api(`/tasks?milestoneId=${m.id}&sort=number`)).set(alice.auth)).body.items.map((t: { key: string }) => t.key);
      expect(keys).toEqual(['SYN-1', 'SYN-2']);
      await patch(a.key, { milestoneId: 'missing' }).expect(400);
      await http().delete(pj(`/milestones/${m.id}`)).set(alice.auth).expect(204);
      expect((await getTask(a.key)).milestone).toBeNull();
    });
  });

  describe('epics', () => {
    it('rolls progress up from child issues', async () => {
      const epic = await mk('Auth', { type: 'EPIC' });
      const empty = await mk('Empty epic', { type: 'EPIC' });
      const s1 = await mk('Login', { type: 'STORY', parentId: epic.id, estimate: 5 });
      await mk('Signup', { type: 'STORY', parentId: epic.id, estimate: 3 });
      await mk('Reset', { type: 'TASK', parentId: epic.id });
      await done(s1.key);
      const res = (await http().get(pj('/epics')).set(vic.auth).expect(200)).body;
      expect(res[0]).toMatchObject({ key: epic.key, childCount: 3, doneCount: 1, points: 8, donePoints: 5, progress: 63 });
      expect(res[1]).toMatchObject({ key: empty.key, childCount: 0, progress: 0 });
      // without estimates the count is used
      const e2 = await mk('Counted', { type: 'EPIC' });
      const t1 = await mk('One', { parentId: e2.id }); await mk('Two', { parentId: e2.id });
      await done(t1.key);
      expect((await http().get(pj('/epics')).set(alice.auth)).body.find((e: { key: string }) => e.key === e2.key)).toMatchObject({ points: 0, progress: 50 });
    });
  });

  describe('flow metrics (Kanban)', () => {
    it('computes lead and cycle time, throughput and WIP', async () => {
      const DAY = 24 * 3600 * 1000;
      const now = Date.now();
      const specs = [{ title: 'Fast', lead: 2, cycle: 1 }, { title: 'Normal', lead: 6, cycle: 4 }, { title: 'Slow', lead: 12, cycle: 10 }];
      for (const s of specs) {
        const t = await mk(s.title, { statusId: status('Done') });
        await prisma.task.update({
          where: { id: t.id },
          data: { createdAt: new Date(now - (s.lead + 1) * DAY), startedAt: new Date(now - (s.cycle + 1) * DAY), completedAt: new Date(now - DAY) },
        });
      }
      const old = await mk('Old', { statusId: status('Done') });
      await prisma.task.update({ where: { id: old.id }, data: { createdAt: new Date(now - 90 * DAY), completedAt: new Date(now - 80 * DAY) } });
      await mk('In flight', { statusId: status('In Progress') });
      await mk('Planned');

      const flow = (await http().get(pj('/flow?days=30')).set(vic.auth).expect(200)).body;
      expect(flow).toMatchObject({ days: 30, wip: 1 });
      expect(flow.stats).toMatchObject({ count: 3, avgLeadDays: 6.67, medianLeadDays: 6, avgCycleDays: 5, medianCycleDays: 4 });
      expect(flow.stats.p85LeadDays).toBeCloseTo(10.2, 1); // 6 + (12 - 6) * 0.7
      expect(flow.tasks.map((t: { title: string }) => t.title).sort()).toEqual(['Fast', 'Normal', 'Slow']);
      expect(flow.throughput.reduce((a: number, w: { count: number }) => a + w.count, 0)).toBe(3);
      expect(flow.throughput.length).toBeGreaterThanOrEqual(5);
      expect((await http().get(pj('/flow?days=90')).set(alice.auth)).body.stats.count).toBe(4);
      expect((await http().get(pj('/flow?days=0')).set(alice.auth)).status).toBe(400);
      const empty = (await http().get(api(`/projects/${(await http().post(api('/projects')).set(alice.auth).send({ name: 'Blank', key: 'BLK' })).body.id}/flow`)).set(alice.auth)).body;
      expect(empty.stats).toMatchObject({ count: 0, avgLeadDays: null, medianCycleDays: null });
    });
  });

  describe('task agile fields', () => {
    it('stores acceptance criteria and exposes the definition of done', async () => {
      const t = await mk('Story', { acceptanceCriteria: '- [ ] works' });
      expect((await getTask(t.key)).acceptanceCriteria).toBe('- [ ] works');
      await patch(t.key, { acceptanceCriteria: '- [ ] works\n- [ ] fast' }).expect(200);
      const acts = (await http().get(api(`/tasks/${t.key}/activity`)).set(alice.auth)).body as { field: string }[];
      expect(acts.some((a) => a.field === 'acceptanceCriteria')).toBe(true);
      await patch(t.key, { acceptanceCriteria: null }).expect(200);
      expect((await getTask(t.key)).acceptanceCriteria).toBeNull();
    });

    it('clears sprint, release and milestone when a task moves to another project', async () => {
      const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS', template: 'KANBAN' })).body;
      const s = await newSprint();
      const r = (await http().post(pj('/releases')).set(alice.auth).send({ name: 'v1' })).body;
      const m = (await http().post(pj('/milestones')).set(alice.auth).send({ name: 'M1' })).body;
      const t = await mk('Mover', { sprintId: s.id, releaseId: r.id, milestoneId: m.id, estimate: 4 });
      await startSprint(s.id).expect(200);
      await waitForPoints(s.id, (p) => p.length === 1);
      await http().post(api(`/tasks/${t.key}/move`)).set(alice.auth).send({ projectId: ops.id }).expect(200);
      const moved = await getTask('OPS-1');
      expect(moved).toMatchObject({ sprint: null, release: null, milestone: null });
      const pts = await waitForPoints(s.id, (p) => p.length === 2); // the sprint lost 4 points of scope
      expect(pts[1]).toMatchObject({ scopePoints: 0, scopeTasks: 0 });
    });

    it('cannot plan work across projects', async () => {
      const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS', template: 'SCRUM' })).body;
      const other = (await http().post(api(`/projects/${ops.id}/sprints`)).set(alice.auth).send({})).body as Sprint;
      const t = await mk('Mine');
      await patch(t.key, { sprintId: other.id }).expect(400);
      await addToSprint(other.id, [t.id]).expect(404); // path project mismatch
    });
  });
});
