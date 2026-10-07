import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { verifySignature } from '../src/webhooks/crypto.js';
import { MAX_ATTEMPTS, MAX_FAILURES, RETRY_DELAYS_MS, WebhooksService } from '../src/webhooks/webhooks.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type FakeWebhookSender, type TestUser, resetDatabase } from './helpers.js';

describe('Outbound webhooks (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let sender: FakeWebhookSender;
  let svc: WebhooksService;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const URL = 'https://hooks.example.com/synqonix';

  beforeAll(async () => {
    ({ app, mail, prisma, webhookSender: sender } = await createTestApp());
    svc = app.get(WebhooksService);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    sender.requests = []; sender.status = 200; sender.fail = null;
    [alice, bob, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const hook = async (over: Record<string, unknown> = {}) =>
    (await http().post(api('/webhooks')).set(alice.auth).send({ name: 'CI bridge', url: URL, events: ['task.created', 'task.updated', 'task.status_changed', 'task.commented', 'task.deleted'], ...over }).expect(201)).body as { id: string; secret: string };
  const mk = async (title = 'Fix login', body: Record<string, unknown> = {}, pid = project.id) => (await http().post(api(`/projects/${pid}/tasks`)).set(alice.auth).send({ title, ...body }).expect(201)).body as { id: string; key: string };
  const until = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 3000;
    while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 30)); }
    throw new Error('timed out');
  };
  const queued = (event?: string) => prisma.outboundDelivery.count({ where: event ? { event } : {} });
  const T0 = new Date('2030-01-01T12:00:00Z');
  const sentBodies = () => sender.requests.map((r) => JSON.parse(r.body) as Record<string, any>);

  describe('management', () => {
    it('lets only admins manage webhooks, and shows the secret once', async () => {
      await http().get(api('/webhooks')).set(bob.auth).expect(403);
      await http().post(api('/webhooks')).set(bob.auth).send({ name: 'x', url: URL, events: ['task.created'] }).expect(403);
      const h = await hook();
      expect(h.secret).toMatch(/^whsec_/);
      const list = (await http().get(api('/webhooks')).set(alice.auth).expect(200)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: 'CI bridge', url: URL, active: true, failureCount: 0, projectId: null });
      expect(JSON.stringify(list)).not.toContain(h.secret);
      const stored = (await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: h.id } })).secret;
      expect(stored).not.toContain(h.secret); // encrypted at rest
      await http().get(api('/webhooks')).set(eve.auth).expect(404);
    });

    it('validates URLs, events and projects', async () => {
      for (const url of ['http://hooks.example.com/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://10.0.0.1/x', 'nonsense', 'https://u:p@hooks.example.com/']) {
        await http().post(api('/webhooks')).set(alice.auth).send({ name: 'x', url, events: ['task.created'] }).expect(400);
      }
      await http().post(api('/webhooks')).set(alice.auth).send({ name: 'x', url: URL, events: [] }).expect(400);
      await http().post(api('/webhooks')).set(alice.auth).send({ name: 'x', url: URL, events: ['task.exploded'] }).expect(400);
      await http().post(api('/webhooks')).set(alice.auth).send({ name: 'x', url: URL, events: ['task.created'], projectId: 'nope' }).expect(400);
      for (let i = 0; i < 20; i++) await hook({ name: `h${i}` });
      await http().post(api('/webhooks')).set(alice.auth).send({ name: 'one too many', url: URL, events: ['task.created'] }).expect(409);
    });

    it('updates, rotates the secret and deletes', async () => {
      const h = await hook();
      const upd = (await http().patch(api(`/webhooks/${h.id}`)).set(alice.auth).send({ name: 'Renamed', events: ['task.deleted'], active: false }).expect(200)).body;
      expect(upd).toMatchObject({ name: 'Renamed', events: ['task.deleted'], active: false });
      await http().patch(api(`/webhooks/${h.id}`)).set(alice.auth).send({ url: 'http://nope.example.com' }).expect(400);
      const rotated = (await http().post(api(`/webhooks/${h.id}/rotate-secret`)).set(alice.auth).expect(200)).body;
      expect(rotated.secret).toMatch(/^whsec_/);
      expect(rotated.secret).not.toBe(h.secret);
      await http().delete(api(`/webhooks/${h.id}`)).set(alice.auth).expect(204);
      await http().delete(api(`/webhooks/${h.id}`)).set(alice.auth).expect(404);
    });
  });

  describe('events', () => {
    it('queues task events and sends them signed', async () => {
      const h = await hook();
      const t = await mk('Fix login', { assigneeIds: [bob.id] });
      await until(async () => (await queued('task.created')) === 1);
      expect(await svc.deliverDue(T0)).toBeGreaterThanOrEqual(1);
      const req = sender.requests.find((r) => r.headers['X-Synqonix-Event'] === 'task.created')!;
      expect(req.url).toBe(URL);
      expect(req.headers['Content-Type']).toBe('application/json');
      expect(verifySignature(h.secret, Number(req.headers['X-Synqonix-Timestamp']), req.body, req.headers['X-Synqonix-Signature'])).toBe(true);
      const body = JSON.parse(req.body);
      expect(body).toMatchObject({
        event: 'task.created', workspaceId: ws, project: { key: 'SYN', name: 'Synqonix' }, actor: { name: 'Alice' },
        task: { key: t.key, title: 'Fix login', status: { name: 'To Do', category: 'TODO' }, assignees: [{ name: 'Bob' }] },
      });
      expect(body.id).toBe(req.headers['X-Synqonix-Delivery']);
    });

    it('sends status changes, comments and deletions with their details, and only to those who asked', async () => {
      await hook({ name: 'Statuses only', events: ['task.status_changed'] });
      await hook({ name: 'Everything', events: ['task.created', 'task.commented', 'task.deleted', 'task.status_changed'] });
      const t = await mk();
      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ statusId: project.statuses.find((s) => s.name === 'In Progress')!.id }).expect(200);
      await http().post(api(`/tasks/${t.key}/comments`)).set(bob.auth).send({ body: 'Looks good' }).expect(201);
      await http().delete(api(`/tasks/${t.key}`)).set(alice.auth).expect(204);
      await until(async () => (await queued()) === 5); // 1 status change for the first hook; created, status, comment and delete for the second
      await svc.deliverDue(T0);
      const events = sender.requests.map((r) => r.headers['X-Synqonix-Event']).sort();
      expect(events).toEqual(['task.commented', 'task.created', 'task.deleted', 'task.status_changed', 'task.status_changed']);
      const status = sentBodies().find((b) => b.event === 'task.status_changed')!;
      expect(status).toMatchObject({ from: 'To Do', to: 'In Progress', task: { key: t.key, status: { name: 'In Progress' } } });
      expect(sentBodies().find((b) => b.event === 'task.commented')).toMatchObject({ comment: { body: 'Looks good' }, actor: { name: 'Bob' } });
      expect(sentBodies().find((b) => b.event === 'task.deleted')!.task).toEqual({ id: t.id, key: t.key }); // nothing but ids once it is gone
    });

    it('can be limited to a project, and skips inactive webhooks', async () => {
      const other = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Other', key: 'OTH', template: 'SCRUM' }).expect(201)).body;
      const scoped = await hook({ name: 'Only OTH', projectId: other.id, events: ['task.created'] });
      const all = await hook({ name: 'All', events: ['task.created'] });
      await http().patch(api(`/webhooks/${all.id}`)).set(alice.auth).send({ active: false }).expect(200);
      await mk('In SYN');
      await mk('In OTH', {}, other.id);
      await until(async () => (await queued()) === 1);
      await new Promise((r) => setTimeout(r, 200));
      expect(await prisma.outboundDelivery.count({ where: { webhookId: scoped.id } })).toBe(1);
      expect(await prisma.outboundDelivery.count({ where: { webhookId: all.id } })).toBe(0);
    });

    it('includes private projects (workspace admins can see them anyway)', async () => {
      await hook({ events: ['task.created'] });
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await mk('Hidden', {}, hidden.id);
      await until(async () => (await queued('task.created')) === 1);
    });
  });

  describe('delivery', () => {
    it('retries with backoff, then gives up', async () => {
      const h = await hook({ events: ['task.created'] });
      sender.status = 500;
      await mk();
      await until(async () => (await queued()) === 1);
      let now = T0;
      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
        expect(await svc.deliverDue(now)).toBe(1);
        const d = await prisma.outboundDelivery.findFirstOrThrow();
        expect(d).toMatchObject({ status: 'PENDING', attempts: attempt, responseStatus: 500, error: 'The endpoint answered 500' });
        expect(d.nextAttemptAt.getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[attempt - 1]);
        expect(await svc.deliverDue(new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1] - 1000))).toBe(0); // not yet
        now = new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]);
      }
      expect(await svc.deliverDue(now)).toBe(1);
      expect(await prisma.outboundDelivery.findFirstOrThrow()).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
      expect(await svc.deliverDue(new Date(now.getTime() + 99 * 3600_000))).toBe(0);
      expect((await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: h.id } })).failureCount).toBe(1);
    });

    it('recovers when the endpoint comes back, and records network errors', async () => {
      const h = await hook({ events: ['task.created'] });
      sender.fail = 'getaddrinfo ENOTFOUND hooks.example.com';
      await mk();
      await until(async () => (await queued()) === 1);
      await svc.deliverDue(T0);
      expect(await prisma.outboundDelivery.findFirstOrThrow()).toMatchObject({ status: 'PENDING', error: 'getaddrinfo ENOTFOUND hooks.example.com', responseStatus: null });
      sender.fail = null;
      await svc.deliverDue(new Date(T0.getTime() + 61_000));
      expect(await prisma.outboundDelivery.findFirstOrThrow()).toMatchObject({ status: 'SUCCESS', attempts: 2, responseStatus: 200, error: null });
      expect(await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ failureCount: 0, lastSuccessAt: new Date(T0.getTime() + 61_000) });
    });

    it('switches a webhook off after too many consecutive failures, and back on when re-enabled', async () => {
      const h = await hook({ events: ['task.created'] });
      sender.status = 410;
      for (let i = 0; i < MAX_FAILURES; i++) {
        await prisma.outboundDelivery.create({ data: { webhookId: h.id, event: 'task.created', payload: { n: i }, attempts: MAX_ATTEMPTS - 1, nextAttemptAt: T0 } });
      }
      await svc.deliverDue(T0);
      const off = await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: h.id } });
      expect(off).toMatchObject({ active: false, failureCount: MAX_FAILURES });
      expect(off.disabledReason).toContain('Switched off');
      const listed = (await http().get(api('/webhooks')).set(alice.auth).expect(200)).body[0];
      expect(listed).toMatchObject({ active: false, disabledReason: expect.stringContaining('Switched off') });
      await http().patch(api(`/webhooks/${h.id}`)).set(alice.auth).send({ active: true }).expect(200);
      expect(await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ active: true, failureCount: 0, disabledReason: null });
    });

    it('never sends the same attempt twice when workers overlap', async () => {
      const h = await hook({ events: ['task.created'] });
      for (let i = 0; i < 5; i++) await prisma.outboundDelivery.create({ data: { webhookId: h.id, event: 'task.created', payload: { n: i }, nextAttemptAt: T0 } });
      await Promise.all([svc.deliverDue(T0), svc.deliverDue(T0), svc.deliverDue(T0)]);
      expect(sender.requests).toHaveLength(5);
      expect(await prisma.outboundDelivery.count({ where: { status: 'SUCCESS' } })).toBe(5);
    });

    it('does not send for inactive webhooks, and keeps the log', async () => {
      const h = await hook({ events: ['task.created'] });
      await prisma.outboundDelivery.create({ data: { webhookId: h.id, event: 'task.created', payload: {}, nextAttemptAt: T0 } });
      await http().patch(api(`/webhooks/${h.id}`)).set(alice.auth).send({ active: false }).expect(200);
      expect(await svc.deliverDue(T0)).toBe(0);
      const log = (await http().get(api(`/webhooks/${h.id}/deliveries`)).set(alice.auth).expect(200)).body;
      expect(log).toEqual([expect.objectContaining({ event: 'task.created', status: 'PENDING', attempts: 0 })]);
      await http().get(api(`/webhooks/${h.id}/deliveries`)).set(bob.auth).expect(403);
    });

    it('redelivers a past delivery and answers test pings', async () => {
      const h = await hook({ events: ['task.created'] });
      await mk();
      await until(async () => (await queued()) === 1);
      await svc.deliverDue(T0);
      const first = (await http().get(api(`/webhooks/${h.id}/deliveries`)).set(alice.auth).expect(200)).body[0];
      await http().post(api(`/webhooks/${h.id}/deliveries/${first.id}/redeliver`)).set(alice.auth).expect(204);
      await http().post(api(`/webhooks/${h.id}/deliveries/nope/redeliver`)).set(alice.auth).expect(404);
      expect(await svc.deliverDue(new Date())).toBe(1);
      expect(sender.requests).toHaveLength(2);
      expect(JSON.parse(sender.requests[1].body).id).not.toBe(JSON.parse(sender.requests[0].body).id);

      sender.requests = [];
      expect((await http().post(api(`/webhooks/${h.id}/test`)).set(alice.auth).expect(200)).body).toEqual({ ok: true, responseStatus: 200, error: null });
      expect(sender.requests[0].headers['X-Synqonix-Event']).toBe('ping');
      sender.status = 503;
      expect((await http().post(api(`/webhooks/${h.id}/test`)).set(alice.auth).expect(200)).body).toEqual({ ok: false, responseStatus: 503, error: null });
      sender.fail = 'connect ECONNREFUSED';
      expect((await http().post(api(`/webhooks/${h.id}/test`)).set(alice.auth).expect(200)).body).toEqual({ ok: false, responseStatus: null, error: 'connect ECONNREFUSED' });
      await http().post(api(`/webhooks/${h.id}/test`)).set(bob.auth).expect(403);
    });
  });
});
