import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

describe('Saved views & recent tasks (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, vic: TestUser, carol: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[]; labels: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, vic, carol] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Vic'), await signUp(app, 'Carol')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [vic, 'VIEWER'], [carol, 'MEMBER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const mk = (title: string, body: Record<string, unknown> = {}, user = alice) =>
    http().post(api(`/projects/${project.id}/tasks`)).set(user.auth).send({ title, ...body }).expect(201).then((r) => r.body as { id: string; key: string });
  const createView = (body: Record<string, unknown>, user = alice) =>
    http().post(api('/views')).set(user.auth).send({ name: 'My view', query: {}, ...body });
  const keys = (r: { body: { items: { key: string }[] } }) => r.body.items.map((i) => i.key);

  describe('views', () => {
    it('creates, lists, updates and deletes views', async () => {
      const v = await createView({ projectId: project.id, layout: 'BOARD', query: { swimlane: 'assignee', display: { hiddenStatusIds: ['x'], cardFields: ['key', 'due'] } } }).expect(201);
      expect(v.body).toMatchObject({ name: 'My view', scope: 'PERSONAL', layout: 'BOARD', projectId: project.id, ownerId: alice.id, canEdit: true });
      expect(v.body.query).toEqual({ swimlane: 'assignee', display: { hiddenStatusIds: ['x'], cardFields: ['key', 'due'] } });

      const list = await http().get(api(`/views?projectId=${project.id}`)).set(alice.auth).expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).toEqual([v.body.id]);
      expect((await http().get(api('/views')).set(alice.auth).expect(200)).body).toEqual([]); // workspace-level only

      const patched = await http().patch(api(`/views/${v.body.id}`)).set(alice.auth).send({ name: 'Renamed', layout: 'LIST', query: { sort: 'dueDate' } }).expect(200);
      expect(patched.body).toMatchObject({ name: 'Renamed', layout: 'LIST', query: { sort: 'dueDate' } });
      await http().delete(api(`/views/${v.body.id}`)).set(alice.auth).expect(204);
      await http().get(api(`/views/${v.body.id}`)).set(alice.auth).expect(404);
    });

    it('validates the stored query', async () => {
      await createView({ name: '' }).expect(400);
      await createView({ query: { filters: { priority: 'WHENEVER' } } }).expect(400);
      await createView({ query: { filters: { nope: 1 } } }).expect(400);
      await createView({ query: { sort: 'bogus' } }).expect(400);
      await createView({ query: { swimlane: 'diagonal' } }).expect(400);
      await createView({ query: { display: { cardFields: [1] } } }).expect(400);
      await createView({ layout: 'GANTT' }).expect(400);
      await createView({ projectId: 'missing' }).expect(404);
    });

    it('keeps personal views private and shares the rest within the project', async () => {
      const mine = (await createView({ name: 'Mine', projectId: project.id }, bob).expect(201)).body;
      const shared = (await createView({ name: 'Team board', projectId: project.id, scope: 'SHARED', layout: 'BOARD' }, bob).expect(201)).body;
      const names = async (u: TestUser) => (await http().get(api(`/views?projectId=${project.id}`)).set(u.auth)).body.map((v: { name: string }) => v.name);
      expect(await names(bob)).toEqual(['Team board', 'Mine']);
      expect(await names(carol)).toEqual(['Team board']);
      await http().get(api(`/views/${mine.id}`)).set(carol.auth).expect(404);
      await http().patch(api(`/views/${mine.id}`)).set(carol.auth).send({ name: 'x' }).expect(404);
      expect((await http().get(api(`/views/${shared.id}`)).set(carol.auth).expect(200)).body.canEdit).toBe(false);
    });

    it('controls who can edit or delete shared views', async () => {
      const shared = (await createView({ projectId: project.id, scope: 'SHARED' }, bob).expect(201)).body;
      await http().patch(api(`/views/${shared.id}`)).set(carol.auth).send({ name: 'x' }).expect(403); // plain member
      await http().delete(api(`/views/${shared.id}`)).set(carol.auth).expect(403);
      await http().patch(api(`/views/${shared.id}`)).set(alice.auth).send({ name: 'by lead' }).expect(200); // project lead
      await http().delete(api(`/views/${shared.id}`)).set(bob.auth).expect(204); // owner
    });

    it('lets viewers keep personal views but not share them', async () => {
      await createView({ projectId: project.id }, vic).expect(201);
      await createView({ projectId: project.id, scope: 'SHARED' }, vic).expect(403);
      const mine = (await createView({ projectId: project.id }, vic)).body;
      await http().patch(api(`/views/${mine.id}`)).set(vic.auth).send({ scope: 'SHARED' }).expect(403);
    });

    it('hides views of private projects and supports workspace-wide views', async () => {
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      const v = (await createView({ projectId: priv.id, scope: 'SHARED' }).expect(201)).body;
      await http().get(api(`/views/${v.id}`)).set(bob.auth).expect(404);
      await http().get(api(`/views?projectId=${priv.id}`)).set(bob.auth).expect(404);
      await createView({ projectId: priv.id }, bob).expect(404);

      const wide = (await createView({ name: 'Everything', scope: 'SHARED', query: { filters: { assignee: 'me' } } }).expect(201)).body;
      expect(wide.projectId).toBeNull();
      expect((await http().get(api('/views')).set(carol.auth)).body.map((x: { name: string }) => x.name)).toEqual(['Everything']);
    });

    it('is workspace scoped', async () => {
      const v = (await createView({ scope: 'SHARED' }).expect(201)).body;
      const outsider = await signUp(app, 'Eve');
      const other = (await http().post('/api/v1/workspaces').set(outsider.auth).send({ name: 'Other' })).body.id;
      await http().get(`/api/v1/workspaces/${other}/views/${v.id}`).set(outsider.auth).expect(404);
      await http().get(api('/views')).set(outsider.auth).expect(404);
    });
  });

  describe('applying a view to the task list (?view=)', () => {
    beforeEach(async () => {
      await mk('Login page', { priority: 'HIGH', assigneeIds: [bob.id], dueDate: '2026-03-01', type: 'STORY' });
      await mk('Crash on save', { priority: 'URGENT', assigneeIds: [bob.id, alice.id], dueDate: '2026-02-01', type: 'BUG' });
      await mk('Write docs', { priority: 'HIGH', dueDate: '2026-01-15' });
      await mk('Polish', { priority: 'LOW', assigneeIds: [alice.id] });
    });

    it('returns exactly what the equivalent explicit filters return', async () => {
      const filters = { priority: 'HIGH', q: 'o' };
      const v = (await createView({ projectId: project.id, query: { filters, sort: 'dueDate', order: 'asc' } }).expect(201)).body;
      const viaView = await http().get(api(`/tasks?view=${v.id}`)).set(alice.auth).expect(200);
      const explicit = await http().get(api(`/tasks?projectId=${project.id}&priority=HIGH&q=o&sort=dueDate&order=asc`)).set(alice.auth).expect(200);
      expect(keys(viaView)).toEqual(['SYN-3', 'SYN-1']);
      expect(viaView.body).toEqual(explicit.body);
    });

    it('lets explicit parameters narrow or override the view', async () => {
      const v = (await createView({ projectId: project.id, query: { filters: { priority: 'HIGH' }, sort: 'number', order: 'asc' } })).body;
      expect(keys(await http().get(api(`/tasks?view=${v.id}`)).set(alice.auth))).toEqual(['SYN-1', 'SYN-3']);
      expect(keys(await http().get(api(`/tasks?view=${v.id}&assignee=none`)).set(alice.auth))).toEqual(['SYN-3']);
      expect(keys(await http().get(api(`/tasks?view=${v.id}&priority=LOW`)).set(alice.auth))).toEqual(['SYN-4']);
      expect(keys(await http().get(api(`/tasks?view=${v.id}&order=desc`)).set(alice.auth))).toEqual(['SYN-3', 'SYN-1']);
      expect((await http().get(api(`/tasks?view=${v.id}&limit=1`)).set(alice.auth)).body).toMatchObject({ total: 2 });
    });

    it('resolves "me" for whoever opens a shared view', async () => {
      const v = (await createView({ projectId: project.id, scope: 'SHARED', query: { filters: { assignee: 'me' }, sort: 'number' } }).expect(201)).body;
      expect(keys(await http().get(api(`/tasks?view=${v.id}`)).set(alice.auth))).toEqual(['SYN-2', 'SYN-4']);
      expect(keys(await http().get(api(`/tasks?view=${v.id}`)).set(bob.auth))).toEqual(['SYN-1', 'SYN-2']);
      expect(keys(await http().get(api(`/tasks?view=${v.id}`)).set(carol.auth))).toEqual([]);
    });

    it('applies workspace-wide views across projects and date ranges', async () => {
      const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
      await http().post(api(`/projects/${ops.id}/tasks`)).set(alice.auth).send({ title: 'Ops thing', dueDate: '2026-02-10' }).expect(201);
      const v = (await createView({ query: { filters: { dueAfter: '2026-02-01', dueBefore: '2026-03-31' }, sort: 'dueDate', order: 'asc' } }).expect(201)).body;
      expect(keys(await http().get(api(`/tasks?view=${v.id}`)).set(alice.auth))).toEqual(['SYN-2', 'OPS-1', 'SYN-1']);
    });

    it('rejects unknown or invisible views', async () => {
      await http().get(api('/tasks?view=nope')).set(alice.auth).expect(404);
      const personal = (await createView({ projectId: project.id }, bob)).body;
      await http().get(api(`/tasks?view=${personal.id}`)).set(carol.auth).expect(404);
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      const hidden = (await createView({ projectId: priv.id, scope: 'SHARED' })).body;
      await http().get(api(`/tasks?view=${hidden.id}`)).set(bob.auth).expect(404);
    });

    it('also drives the board', async () => {
      const v = (await createView({ projectId: project.id, layout: 'BOARD', query: { filters: { priority: 'HIGH' } } })).body;
      const res = await http().get(api(`/projects/${project.id}/board?view=${v.id}`)).set(alice.auth).expect(200);
      expect(res.body.columns[0].tasks.map((t: { key: string }) => t.key).sort()).toEqual(['SYN-1', 'SYN-3']);
    });
  });

  describe('recently viewed', () => {
    const viewed = (ref: string, user = alice) => http().post(api(`/tasks/${ref}/viewed`)).set(user.auth);
    const recent = async (user = alice, qs = '') => (await http().get(api(`/recent-tasks${qs}`)).set(user.auth).expect(200)).body as { items: { key: string }[]; total: number };

    it('lists tasks newest-first and moves repeats to the top', async () => {
      for (const t of ['A', 'B', 'C']) await mk(t);
      for (const k of ['SYN-1', 'SYN-2', 'SYN-3']) await viewed(k).expect(204);
      expect((await recent()).items.map((i) => i.key)).toEqual(['SYN-3', 'SYN-2', 'SYN-1']);
      await viewed('SYN-1').expect(204);
      expect((await recent()).items.map((i) => i.key)).toEqual(['SYN-1', 'SYN-3', 'SYN-2']);
      expect((await recent(alice, '?limit=2')).items).toHaveLength(2);
      expect((await recent(alice, '?limit=2')).total).toBe(3);
      await http().get(api('/recent-tasks?limit=500')).set(alice.auth).expect(400);
    });

    it('is per user and respects visibility', async () => {
      await mk('A');
      await viewed('SYN-1', bob).expect(204);
      expect((await recent(alice)).items).toEqual([]);
      expect((await recent(bob)).items.map((i) => i.key)).toEqual(['SYN-1']);

      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC' })).body;
      await http().post(api(`/projects/${priv.id}/tasks`)).set(alice.auth).send({ title: 'Hidden later' }).expect(201);
      await http().put(api(`/projects/${priv.id}/members`)).set(alice.auth).send({ userId: bob.id, role: 'MEMBER' }).expect(200);
      await viewed('SEC-1', bob).expect(204);
      expect((await recent(bob)).items.map((i) => i.key)).toEqual(['SEC-1', 'SYN-1']);
      await http().patch(api(`/projects/${priv.id}`)).set(alice.auth).send({ visibility: 'PRIVATE' }).expect(200);
      await http().delete(api(`/projects/${priv.id}/members/${bob.id}`)).set(alice.auth).expect(204);
      expect((await recent(bob)).items.map((i) => i.key)).toEqual(['SYN-1']); // no longer visible
      await viewed('SEC-1', bob).expect(404);
      await viewed('SYN-99').expect(404);
    });

    it('keeps only the latest 50', async () => {
      await Promise.all(Array.from({ length: 52 }, (_, i) => mk(`T${i}`)));
      const keysAll = (await http().get(api('/tasks?limit=200&sort=number')).set(alice.auth)).body.items.map((t: { key: string }) => t.key) as string[];
      for (const k of keysAll) await viewed(k).expect(204);
      const r = await recent(alice, '?limit=50');
      expect(r.total).toBe(50);
      expect(r.items[0].key).toBe(keysAll[51]);
      expect(r.items.map((i) => i.key)).not.toContain(keysAll[0]);
    }, 60_000);
  });
});
