import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RetentionService } from '../src/retention/retention.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

describe('Automation rules (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  let labels: { id: string; name: string }[];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const pj = (p: string) => api(`/projects/${project.id}${p}`);
  const sid = (n: string) => project.statuses.find((s) => s.name === n)!.id;
  const label = (n: string) => labels.find((l) => l.name === n)!.id;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, viv, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
    labels = (await http().get(pj('')).set(alice.auth).expect(200)).body.labels;
  });

  const rule = async (body: Record<string, unknown>, user = alice) => (await http().post(pj('/automations')).set(user.auth).send(body).expect(201)).body as { id: string };
  const mk = async (body: Record<string, unknown> = {}) => (await http().post(pj('/tasks')).set(alice.auth).send({ title: 'Task', ...body }).expect(201)).body as { id: string; key: string };
  const get = async (key: string) => (await http().get(api(`/tasks/${key}`)).set(alice.auth).expect(200)).body;
  const until = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 3000;
    while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 30)); }
    throw new Error('timed out');
  };
  const runs = async (id: string) => (await prisma.automationRule.findUniqueOrThrow({ where: { id } })).runCount;
  const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  describe('management', () => {
    it('lets project admins manage rules and everyone who can see the project read them', async () => {
      const r = await rule({ name: 'Escalate', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'HIGH' }] });
      expect((await http().get(pj('/automations')).set(viv.auth).expect(200)).body).toEqual([expect.objectContaining({ id: r.id, name: 'Escalate', enabled: true, runCount: 0, trigger: 'TASK_CREATED' })]);
      await http().post(pj('/automations')).set(bob.auth).send({ name: 'x', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'LOW' }] }).expect(403);
      await http().patch(pj(`/automations/${r.id}`)).set(bob.auth).send({ enabled: false }).expect(403);
      await http().delete(pj(`/automations/${r.id}`)).set(bob.auth).expect(403);
      await http().get(pj('/automations')).set(eve.auth).expect(404);
      const upd = (await http().patch(pj(`/automations/${r.id}`)).set(alice.auth).send({ name: 'Renamed', enabled: false, conditions: { types: ['BUG'] } }).expect(200)).body;
      expect(upd).toMatchObject({ name: 'Renamed', enabled: false, conditions: { types: ['BUG'] } });
      await http().delete(pj(`/automations/${r.id}`)).set(alice.auth).expect(204);
      await http().delete(pj(`/automations/${r.id}`)).set(alice.auth).expect(404);
    });

    it('validates everything a rule points at', async () => {
      const ok = { name: 'x', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'LOW' }] };
      const bad: Record<string, unknown>[] = [
        { ...ok, actions: [] }, { ...ok, actions: [{ type: 'DELETE_EVERYTHING', value: 'x' }] }, { ...ok, actions: [{ type: 'SET_PRIORITY', value: 'SUPER' }] },
        { ...ok, actions: [{ type: 'ASSIGN', value: eve.id }] }, { ...ok, actions: [{ type: 'ADD_LABEL', value: 'nope' }] }, { ...ok, actions: [{ type: 'MOVE_TO_STATUS', value: 'nope' }] },
        { ...ok, trigger: 'STATUS_CHANGED', triggerStatusId: 'nope' }, { ...ok, triggerStatusId: sid('Done') }, { ...ok, conditions: { labelIds: ['nope'] } },
        { ...ok, conditions: { types: ['POTATO'] } }, { ...ok, trigger: 'TASK_DELETED' }, { ...ok, actions: Array.from({ length: 6 }, () => ({ type: 'SET_PRIORITY', value: 'LOW' })) },
      ];
      for (const b of bad) await http().post(pj('/automations')).set(alice.auth).send(b).expect(400);
      for (let i = 0; i < 25; i++) await rule({ ...ok, name: `r${i}` });
      await http().post(pj('/automations')).set(alice.auth).send(ok).expect(400);
    });
  });

  describe('running', () => {
    it('applies actions to new tasks that match the conditions', async () => {
      const r = await rule({
        name: 'Triage bugs', trigger: 'TASK_CREATED', conditions: { types: ['BUG'] },
        actions: [{ type: 'SET_PRIORITY', value: 'HIGH' }, { type: 'ADD_LABEL', value: label('bug') }, { type: 'ASSIGN', value: bob.id }, { type: 'COMMENT', value: 'Auto-triaged' }],
      });
      const bug = await mk({ title: 'Crash', type: 'BUG', assigneeIds: [alice.id] });
      const chore = await mk({ title: 'Chore', type: 'TASK' });
      await until(async () => (await runs(r.id)) === 1);
      const t = await get(bug.key);
      expect(t).toMatchObject({ priority: 'HIGH' });
      expect(t.labels.map((l: { name: string }) => l.name)).toEqual(['bug']);
      expect(t.assignees.map((a: { name: string }) => a.name).sort()).toEqual(['Alice', 'Bob']); // added, not replaced
      const comments = (await http().get(api(`/tasks/${bug.key}/comments`)).set(alice.auth).expect(200)).body;
      expect(comments.map((c: { body: string }) => c.body)).toEqual(['Auto-triaged']);
      expect(await get(chore.key)).toMatchObject({ priority: 'NONE' });
      const history = (await http().get(api(`/tasks/${bug.key}/activity`)).set(alice.auth).expect(200)).body as { type: string; to: unknown; actorId: string | null }[];
      expect(history.find((h) => h.type === 'automation')).toMatchObject({ to: 'Triage bugs', actorId: null });
      expect(await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ runCount: 1, lastError: null });
    });

    it('reacts to a task moving into a chosen status, and to any status when none is chosen', async () => {
      const done = await rule({ name: 'Wrap up', trigger: 'STATUS_CHANGED', triggerStatusId: sid('Done'), actions: [{ type: 'COMMENT', value: 'Shipped!' }] });
      const any = await rule({ name: 'Any move', trigger: 'STATUS_CHANGED', actions: [{ type: 'SET_PRIORITY', value: 'LOW' }] });
      const t = await mk();
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ statusId: sid('In Progress') }).expect(200);
      await until(async () => (await runs(any.id)) === 1);
      await quiet();
      expect(await runs(done.id)).toBe(0);
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ statusId: sid('Done') }).expect(200);
      await until(async () => (await runs(done.id)) === 1);
      expect((await http().get(api(`/tasks/${t.key}/comments`)).set(alice.auth).expect(200)).body.map((c: { body: string }) => c.body)).toEqual(['Shipped!']);
    });

    it('can move tasks, and does not cascade into other rules or loop', async () => {
      const move = await rule({ name: 'Auto review', trigger: 'STATUS_CHANGED', triggerStatusId: sid('In Progress'), actions: [{ type: 'MOVE_TO_STATUS', value: sid('In Review') }] });
      const chained = await rule({ name: 'On review', trigger: 'STATUS_CHANGED', triggerStatusId: sid('In Review'), actions: [{ type: 'SET_PRIORITY', value: 'URGENT' }] });
      const selfish = await rule({ name: 'Bounce', trigger: 'STATUS_CHANGED', actions: [{ type: 'MOVE_TO_STATUS', value: sid('In Review') }] });
      const t = await mk();
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ statusId: sid('In Progress') }).expect(200);
      await until(async () => (await runs(move.id)) === 1);
      await quiet(500);
      expect((await get(t.key)).status.name).toBe('In Review');
      expect(await runs(move.id)).toBe(1);
      expect(await runs(selfish.id)).toBe(1); // ran for the first change only; its own move did not start it again
      expect(await runs(chained.id)).toBe(0); // a rule's changes never start another rule
      expect(await get(t.key)).toMatchObject({ priority: 'NONE' });
      // a person moving it into review does start that rule
      const u = await mk();
      await http().patch(api(`/tasks/${u.key}`)).set(alice.auth).send({ statusId: sid('In Review') }).expect(200);
      await until(async () => (await runs(chained.id)) === 1);
      expect(await get(u.key)).toMatchObject({ priority: 'URGENT' });
    });

    it('matches on priority and labels, and ignores disabled rules', async () => {
      const r = await rule({ name: 'Urgent bugs', trigger: 'TASK_CREATED', conditions: { priorities: ['URGENT'], labelIds: [label('bug')] }, actions: [{ type: 'ASSIGN', value: bob.id }] });
      const off = await rule({ name: 'Off', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'LOW' }] });
      await http().patch(pj(`/automations/${off.id}`)).set(alice.auth).send({ enabled: false }).expect(200);
      const a = await mk({ priority: 'URGENT', labelIds: [label('bug')] });
      await mk({ priority: 'URGENT' });
      await mk({ priority: 'LOW', labelIds: [label('bug')] });
      await until(async () => (await runs(r.id)) === 1);
      await quiet();
      expect(await runs(r.id)).toBe(1);
      expect(await runs(off.id)).toBe(0);
      expect((await get(a.key)).assignees.map((x: { name: string }) => x.name)).toEqual(['Bob']);
    });

    it('does nothing to tasks that already look right, and records a failure instead of breaking', async () => {
      const r = await rule({ name: 'Noop', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'HIGH' }] });
      await mk({ priority: 'HIGH' });
      await until(async () => (await runs(r.id)) === 1);
      const broken = await rule({ name: 'Stale status', trigger: 'TASK_CREATED', actions: [{ type: 'MOVE_TO_STATUS', value: sid('In Review') }] });
      await http().delete(pj(`/statuses/${sid('In Review')}?moveTo=${sid('In Progress')}`)).set(alice.auth).expect(204);
      const t = await mk({ title: 'After the status is gone' });
      await until(async () => !!(await prisma.automationRule.findUniqueOrThrow({ where: { id: broken.id } })).lastError);
      expect(await get(t.key)).toMatchObject({ title: 'After the status is gone' }); // the task was still created
    });

    it('switches a rule off when the person who set it up leaves, and imports are silent', async () => {
      await http().put(pj('/members')).set(alice.auth).send({ userId: bob.id, role: 'ADMIN' }).expect(200);
      const r = await rule({ name: "Bob's rule", trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'HIGH' }] }, bob);
      await http().delete(api(`/members/${bob.id}`)).set(alice.auth).expect(204);
      await mk();
      await until(async () => !(await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } })).enabled);
      expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: r.id } })).lastError).toContain('left the workspace');

      const quietRule = await rule({ name: 'Imports', trigger: 'TASK_CREATED', actions: [{ type: 'SET_PRIORITY', value: 'LOW' }] });
      await http().post(pj('/import')).set(alice.auth).attach('file', Buffer.from('Title\nFrom a file\n'), 'x.csv').expect(200);
      await quiet(500);
      expect(await runs(quietRule.id)).toBe(0);
    });
  });
});

describe('Retention (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let retention: RetentionService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
    retention = app.get(RetentionService);
  });
  afterAll(() => app.close());

  it('removes old audit entries, read notifications and finished deliveries, but not what is still needed', async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace", "WebhookDelivery" CASCADE`;
    const alice = await signUp(app, 'Alice');
    const ws = await createWorkspace(app, mail, alice);
    const now = new Date('2031-01-01T00:00:00Z');
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await prisma.auditLog.deleteMany();
    await prisma.auditLog.createMany({ data: [
      { workspaceId: ws, action: 'old', entityType: 'x', createdAt: ago(400) }, { workspaceId: ws, action: 'recent', entityType: 'x', createdAt: ago(100) },
    ] });
    const note = (readAt: Date | null, created: Date) => prisma.notification.create({ data: { userId: alice.id, workspaceId: ws, type: 'ASSIGNED', title: 't', url: '/', readAt, createdAt: created, surfacedAt: created } });
    await note(ago(95), ago(100)); // read long ago: goes
    await note(ago(10), ago(100)); // read recently: stays
    await note(null, ago(200)); // unread: stays however old
    const hook = await prisma.outboundWebhook.create({ data: { workspaceId: ws, name: 'h', url: 'https://x.example.com', secret: 's', events: ['task.created'] } });
    const delivery = (status: 'PENDING' | 'SUCCESS' | 'FAILED', created: Date) => prisma.outboundDelivery.create({ data: { webhookId: hook.id, event: 'e', payload: {}, status, createdAt: created } });
    await delivery('SUCCESS', ago(40)); await delivery('FAILED', ago(40)); await delivery('PENDING', ago(40)); await delivery('SUCCESS', ago(5));
    await prisma.webhookDelivery.createMany({ data: [{ id: 'old', event: 'push', receivedAt: ago(40) }, { id: 'new', event: 'push', receivedAt: ago(1) }] });

    expect(await retention.run(now)).toEqual({ auditLogs: 1, notifications: 1, webhookDeliveries: 2, githubDeliveries: 1 });
    expect((await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action)).toEqual(['recent']);
    expect(await prisma.notification.count()).toBe(2);
    expect((await prisma.outboundDelivery.findMany({ select: { status: true } })).map((d) => d.status).sort()).toEqual(['PENDING', 'SUCCESS']);
    expect((await prisma.webhookDelivery.findMany()).map((d) => d.id)).toEqual(['new']);
    expect(await retention.run(now)).toEqual({ auditLogs: 0, notifications: 0, webhookDeliveries: 0, githubDeliveries: 0 });
    void http;
  });
});
