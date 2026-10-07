import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InsightsService } from '../src/insights/insights.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TimeService } from '../src/time/time.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

const NOW = new Date('2026-03-10T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('Insights and time tracking (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let insights: InsightsService;
  let timeSvc: TimeService;
  let alice: TestUser, bob: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const mem = (u: TestUser) => prisma.membership.findFirstOrThrow({ where: { workspaceId: ws, userId: u.id } });
  const sid = (n: string) => project.statuses.find((s) => s.name === n)!.id;

  beforeAll(async () => {
    ({ app, mail, prisma } = await createTestApp());
    insights = app.get(InsightsService);
    timeSvc = app.get(TimeService);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [alice, bob, viv, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const mk = async (title: string, body: Record<string, unknown> = {}) =>
    (await http().post(api(`/projects/${project.id}/tasks`)).set(alice.auth).send({ title, ...body }).expect(201)).body as { id: string; key: string };

  /** Rewrites a task's history so the numbers can be checked against known dates. */
  async function history(taskId: string, o: { created: string; status?: string; completed?: string; due?: string; changes?: [string, string, string][] }) {
    await prisma.task.update({
      where: { id: taskId },
      data: { createdAt: at(o.created), ...(o.status && { statusId: sid(o.status) }), completedAt: o.completed ? at(o.completed) : null, ...(o.due && { dueDate: at(o.due) }) },
    });
    await prisma.activity.deleteMany({ where: { taskId } });
    await prisma.activity.createMany({
      data: (o.changes ?? []).map(([when, from, to]) => ({ taskId, type: 'updated', field: 'status', from, to, createdAt: at(when) })),
    });
  }

  /** The fixture: five tasks with known dates, assignees, estimates and logged time. */
  async function fixture() {
    const a = await mk('A', { assigneeIds: [bob.id], estimate: 5, timeEstimateMinutes: 120 });
    const b = await mk('B', { assigneeIds: [bob.id], estimate: 3 });
    const c = await mk('C', { assigneeIds: [alice.id], estimate: 2 });
    const d = await mk('D');
    const e = await mk('E', { assigneeIds: [alice.id], timeEstimateMinutes: 60 });
    await history(a.id, { created: '2026-03-01T10:00:00Z', status: 'Done', completed: '2026-03-05T09:00:00Z', changes: [['2026-03-03T09:00:00Z', 'To Do', 'In Progress'], ['2026-03-05T09:00:00Z', 'In Progress', 'Done']] });
    await history(b.id, { created: '2026-03-02T10:00:00Z', status: 'To Do', due: '2026-03-08T12:00:00Z' });
    await history(c.id, { created: '2026-03-04T10:00:00Z', status: 'In Progress', changes: [['2026-03-06T09:00:00Z', 'To Do', 'In Progress']] });
    await history(d.id, { created: '2026-03-08T10:00:00Z', status: 'To Do' });
    await history(e.id, { created: '2026-03-09T08:00:00Z', status: 'Done', completed: '2026-03-09T09:00:00Z', changes: [['2026-03-09T09:00:00Z', 'To Do', 'Done']] });
    const entry = (taskId: string, userId: string, start: string, minutes: number) =>
      prisma.timeEntry.create({ data: { taskId, userId, startedAt: at(start), endedAt: new Date(at(start).getTime() + minutes * 60_000), minutes } });
    await entry(a.id, alice.id, '2026-03-04T10:00:00Z', 60);
    await entry(a.id, bob.id, '2026-03-05T10:00:00Z', 30);
    await entry(e.id, alice.id, '2026-03-09T10:00:00Z', 120);
    return { a, b, c, d, e };
  }

  describe('reports match the raw data', () => {
    it('counts tasks created and resolved per day and per week', async () => {
      await fixture();
      const day = await insights.createdResolved(await mem(alice), project.id, 10, 'day', NOW);
      const pick = (d: string) => day.points.find((p) => p.date === d)!;
      expect(day.points).toHaveLength(10);
      expect(day.points[0].date).toBe('2026-03-01');
      expect(day.points.map((p) => p.created)).toEqual([1, 1, 0, 1, 0, 0, 0, 1, 1, 0]);
      expect(day.points.map((p) => p.resolved)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
      expect(pick('2026-03-05')).toEqual({ date: '2026-03-05', created: 0, resolved: 1 });
      expect(day).toMatchObject({ totalCreated: 5, totalResolved: 2, openNow: 3 });
      const week = await insights.createdResolved(await mem(alice), project.id, 10, 'week', NOW);
      expect(week.points).toEqual([
        { date: '2026-02-23', created: 1, resolved: 0 },
        { date: '2026-03-02', created: 3, resolved: 1 },
        { date: '2026-03-09', created: 1, resolved: 1 },
      ]);
    });

    it('rebuilds the cumulative flow from status history', async () => {
      await fixture();
      const cfd = await insights.cumulativeFlow(await mem(alice), project.id, 10, NOW);
      expect(cfd.statuses).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
      const rows = cfd.points.map((p) => [p.date.slice(5), p.todo, p.inProgress, p.done, p.total]);
      expect(rows).toEqual([
        ['03-01', 1, 0, 0, 1], ['03-02', 2, 0, 0, 2], ['03-03', 1, 1, 0, 2], ['03-04', 2, 1, 0, 3], ['03-05', 2, 0, 1, 3],
        ['03-06', 1, 1, 1, 3], ['03-07', 1, 1, 1, 3], ['03-08', 2, 1, 1, 4], ['03-09', 2, 1, 2, 5], ['03-10', 2, 1, 2, 5],
      ]);
      expect(cfd.points[8].byStatus).toEqual([{ name: 'To Do', count: 2 }, { name: 'In Progress', count: 1 }, { name: 'In Review', count: 0 }, { name: 'Done', count: 2 }]);
      // every day's categories add up to its total
      for (const p of cfd.points) expect(p.todo + p.inProgress + p.done).toBe(p.total);
    });

    it('leaves archived tasks out from the day they were archived, and keeps renamed or deleted statuses countable', async () => {
      const { d } = await fixture();
      await prisma.task.update({ where: { id: d.id }, data: { archivedAt: at('2026-03-09T00:00:00Z') } });
      await prisma.activity.create({ data: { taskId: d.id, type: 'updated', field: 'status', from: 'Ancient Column', to: 'To Do', createdAt: at('2026-03-08T11:00:00Z') } });
      const cfd = await insights.cumulativeFlow(await mem(alice), project.id, 3, NOW);
      expect(cfd.points.map((p) => p.total)).toEqual([4, 4, 4]); // D counted on the 8th, gone from the 9th (E arrives that day)
      const early = await insights.cumulativeFlow(await mem(alice), project.id, 10, NOW);
      expect(early.points.find((p) => p.date === '2026-03-08')!.byStatus.find((s) => s.name === 'Ancient Column')).toBeUndefined();
      const seven = early.points.find((p) => p.date === '2026-03-08')!;
      expect(seven.total).toBe(4);
    });

    it('summarises workload per person, with overdue and recently finished work', async () => {
      await fixture();
      const rows = await insights.workload(await mem(alice), project.id, NOW);
      const by = (name: string) => rows.find((r) => r.name === name)!;
      expect(by('Bob')).toMatchObject({ openTasks: 1, openPoints: 3, overdueTasks: 1, doneLast30Days: 1 });
      expect(by('Alice')).toMatchObject({ openTasks: 1, openPoints: 2, overdueTasks: 0, doneLast30Days: 1 });
      expect(by('Unassigned')).toMatchObject({ userId: null, openTasks: 1, openPoints: 0 });
      expect(rows).toHaveLength(3);
    });

    it('lists overdue open tasks, oldest first', async () => {
      const { b } = await fixture();
      const list = await insights.overdue(await mem(alice), project.id, NOW);
      expect(list).toEqual([expect.objectContaining({ key: b.key, title: 'B', daysOverdue: 2, assignees: ['Bob'], statusName: 'To Do' })]);
    });

    it('adds up logged time by person and task, and compares estimates with actuals', async () => {
      const { a, e } = await fixture();
      const r = await insights.timeReport(await mem(alice), project.id, undefined, undefined, NOW);
      expect(r.totalMinutes).toBe(210);
      expect(r.byUser.map((u) => [u.name, u.minutes])).toEqual([['Alice', 180], ['Bob', 30]]);
      expect(r.byTask.map((t) => [t.key, t.spentMinutes, t.estimateMinutes])).toEqual([[e.key, 120, 60], [a.key, 90, 120]]);
      expect(r).toMatchObject({ estimatedMinutes: 180, actualMinutesOnEstimated: 210 });
      const narrow = await insights.timeReport(await mem(alice), project.id, '2026-03-09T00:00:00Z', '2026-03-10T00:00:00Z', NOW);
      expect(narrow).toMatchObject({ totalMinutes: 120 });
      expect(narrow.byUser).toEqual([expect.objectContaining({ name: 'Alice', minutes: 120 })]);
    });

    it('gives a workspace overview limited to visible projects', async () => {
      await fixture();
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await http().post(api(`/projects/${hidden.id}/tasks`)).set(alice.auth).send({ title: 'Hidden', assigneeIds: [alice.id] }).expect(201);
      const asAlice = await insights.overview(await mem(alice), NOW);
      expect(asAlice.projects.map((p) => p.key)).toEqual(['SEC', 'SYN']);
      expect(asAlice.projects.find((p) => p.key === 'SYN')).toMatchObject({ open: 3, done: 2, overdue: 1, createdLast14Days: 5, resolvedLast14Days: 2 });
      const asBob = await insights.overview(await mem(bob), NOW);
      expect(asBob.projects.map((p) => p.key)).toEqual(['SYN']);
      expect(asBob.totalOpen).toBe(3);
      expect(asBob.workload.find((w) => w.name === 'Alice')!.openTasks).toBe(1); // not counting the hidden project
    });
  });

  describe('endpoints', () => {
    it('serves the reports to anyone who can see the project, and hides private ones', async () => {
      await fixture();
      for (const path of ['created-resolved', 'cumulative-flow', 'workload', 'overdue', 'time']) {
        await http().get(api(`/projects/${project.id}/insights/${path}`)).set(viv.auth).expect(200);
      }
      const cr = (await http().get(api(`/projects/${project.id}/insights/created-resolved?days=7&bucket=week`)).set(bob.auth).expect(200)).body;
      expect(cr.bucket).toBe('week');
      await http().get(api(`/projects/${project.id}/insights/created-resolved?days=999`)).set(bob.auth).expect(400);
      await http().get(api(`/projects/${project.id}/insights/created-resolved?bucket=hour`)).set(bob.auth).expect(400);
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await http().get(api(`/projects/${hidden.id}/insights/workload`)).set(bob.auth).expect(404);
      expect((await http().get(api('/insights/overview')).set(bob.auth).expect(200)).body.projects.map((p: { key: string }) => p.key)).toEqual(['SYN']);
      await http().get(api(`/projects/${project.id}/insights/workload`)).set(eve.auth).expect(404);
    });
  });

  describe('time tracking', () => {
    it('logs, edits and deletes time, and totals it on the task', async () => {
      const t = await mk('Timed', { timeEstimateMinutes: 90 });
      expect((await http().get(api(`/tasks/${t.key}`)).set(alice.auth).expect(200)).body).toMatchObject({ timeEstimateMinutes: 90, timeSpentMinutes: 0 });
      const e1 = (await http().post(api(`/tasks/${t.key}/time`)).set(bob.auth).send({ minutes: 45, note: 'investigation' }).expect(201)).body;
      expect(e1).toMatchObject({ minutes: 45, running: false, note: 'investigation', userName: 'Bob', taskKey: t.key });
      await http().post(api(`/tasks/${t.key}/time`)).set(alice.auth).send({ minutes: 30, startedAt: '2026-01-02T09:00:00Z' }).expect(201);
      const list = (await http().get(api(`/tasks/${t.key}/time`)).set(viv.auth).expect(200)).body;
      expect(list).toMatchObject({ estimateMinutes: 90, spentMinutes: 75 });
      expect(list.entries).toHaveLength(2);
      expect((await http().get(api(`/tasks/${t.key}`)).set(alice.auth).expect(200)).body.timeSpentMinutes).toBe(75);
      // only the author or a project admin changes an entry
      await http().patch(api(`/tasks/${t.key}/time/${e1.id}`)).set(viv.auth).send({ minutes: 1 }).expect(403);
      const e2 = list.entries.find((x: { userName: string }) => x.userName === 'Alice');
      await http().patch(api(`/tasks/${t.key}/time/${e2.id}`)).set(bob.auth).send({ minutes: 1 }).expect(403);
      const edited = (await http().patch(api(`/tasks/${t.key}/time/${e1.id}`)).set(bob.auth).send({ minutes: 60, note: null }).expect(200)).body;
      expect(edited).toMatchObject({ minutes: 60, note: null });
      await http().patch(api(`/tasks/${t.key}/time/${e2.id}`)).set(alice.auth).send({ minutes: 20 }).expect(200); // the project lead may edit anyone's
      await http().delete(api(`/tasks/${t.key}/time/${e1.id}`)).set(alice.auth).expect(204); // as may the project lead
      expect((await http().get(api(`/tasks/${t.key}/time`)).set(alice.auth).expect(200)).body.spentMinutes).toBe(20);
      await http().delete(api(`/tasks/${t.key}/time/${e1.id}`)).set(alice.auth).expect(404);
    });

    it('validates entries and who may log', async () => {
      const t = await mk('Timed');
      await http().post(api(`/tasks/${t.key}/time`)).set(viv.auth).send({ minutes: 10 }).expect(403);
      await http().post(api(`/tasks/${t.key}/time`)).set(eve.auth).send({ minutes: 10 }).expect(404);
      for (const minutes of [0, -5, 1441, 1.5]) await http().post(api(`/tasks/${t.key}/time`)).set(alice.auth).send({ minutes }).expect(400);
      await http().post(api(`/tasks/${t.key}/time`)).set(alice.auth).send({ minutes: 10, startedAt: new Date(Date.now() + 3600_000).toISOString() }).expect(400);
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ timeEstimateMinutes: 180 }).expect(200);
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ timeEstimateMinutes: -1 }).expect(400);
      expect((await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ timeEstimateMinutes: null }).expect(200)).body.timeEstimateMinutes).toBeNull();
    });

    it('runs one timer at a time and logs the elapsed minutes when stopped', async () => {
      const t1 = await mk('First');
      const t2 = await mk('Second');
      expect((await http().get(api('/time/timer')).set(bob.auth).expect(200)).body.entry).toBeNull();
      const started = (await http().post(api('/time/timer/start')).set(bob.auth).send({ taskRef: t1.key }).expect(200)).body.entry;
      expect(started).toMatchObject({ running: true, taskKey: t1.key, minutes: 0 });
      // pretend it has been running for 25 minutes
      await prisma.timeEntry.update({ where: { id: started.id }, data: { startedAt: new Date(Date.now() - 25 * 60_000) } });
      const running = (await http().get(api('/time/timer')).set(bob.auth).expect(200)).body.entry;
      expect(running.minutes).toBe(25);
      expect((await http().get(api(`/tasks/${t1.key}`)).set(bob.auth).expect(200)).body.timeSpentMinutes).toBe(25);
      // starting another stops the first and keeps its time
      const second = (await http().post(api('/time/timer/start')).set(bob.auth).send({ taskRef: t2.key }).expect(200)).body.entry;
      expect(second.taskKey).toBe(t2.key);
      expect(await prisma.timeEntry.count({ where: { userId: bob.id, endedAt: null } })).toBe(1);
      const first = (await http().get(api(`/tasks/${t1.key}/time`)).set(bob.auth).expect(200)).body;
      expect(first.entries).toEqual([expect.objectContaining({ running: false, minutes: 25 })]);
      // stopping straight away discards the sliver
      const stopped = (await http().post(api('/time/timer/stop')).set(bob.auth).expect(200)).body;
      expect(stopped.entry).toBeNull();
      expect((await http().get(api(`/tasks/${t2.key}/time`)).set(bob.auth).expect(200)).body.entries).toEqual([]);
      expect((await http().post(api('/time/timer/stop')).set(bob.auth).expect(200)).body.entry).toBeNull();
      await http().post(api('/time/timer/start')).set(viv.auth).send({ taskRef: t1.key }).expect(403);
      await http().post(api('/time/timer/start')).set(bob.auth).send({ taskRef: 'NOPE-1' }).expect(404);
    });

    it('stops a long timer with its elapsed time, and lists my entries', async () => {
      const t = await mk('Long');
      const started = (await http().post(api('/time/timer/start')).set(alice.auth).send({ taskRef: t.key }).expect(200)).body.entry;
      await prisma.timeEntry.update({ where: { id: started.id }, data: { startedAt: new Date(Date.now() - 90 * 60_000) } });
      const stopped = (await http().post(api('/time/timer/stop')).set(alice.auth).expect(200)).body.entry;
      expect(stopped).toMatchObject({ running: false, minutes: 90, taskKey: t.key });
      await http().post(api(`/tasks/${t.key}/time`)).set(bob.auth).send({ minutes: 15 }).expect(201);
      const mine = (await http().get(api('/time/mine')).set(alice.auth).expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0].minutes).toBe(90);
      expect((await http().get(api('/time/mine?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z')).set(alice.auth).expect(200)).body).toEqual([]);
    });

    it('refuses a second running timer even if two requests race', async () => {
      const t = await mk('Race');
      await timeSvc.start(await mem(alice), t.key);
      await expect(prisma.timeEntry.create({ data: { taskId: t.id, userId: alice.id, startedAt: new Date() } })).rejects.toThrow();
    });

    it('deletes time with its task', async () => {
      const t = await mk('Gone');
      await http().post(api(`/tasks/${t.key}/time`)).set(alice.auth).send({ minutes: 10 }).expect(201);
      await http().delete(api(`/tasks/${t.key}`)).set(alice.auth).expect(204);
      expect(await prisma.timeEntry.count()).toBe(0);
    });
  });
});
