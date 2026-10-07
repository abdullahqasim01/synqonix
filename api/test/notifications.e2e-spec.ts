import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RemindersService } from '../src/notifications/reminders.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

interface Item { id: string; type: string; title: string; body: string | null; url: string; read: boolean; taskKey: string | null; workspaceId: string }

describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let service: NotificationsService;
  let reminders: RemindersService;
  let url: string;
  let alice: TestUser, bob: TestUser, carol: TestUser, viv: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => {
    ({ app, mail, prisma } = await createTestApp());
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    service = app.get(NotificationsService);
    reminders = app.get(RemindersService);
  });
  afterAll(() => app.close());
  afterEach(() => { sockets.splice(0).forEach((s) => s.close()); });
  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.notifications = []; mail.failNotifications = false;
    [alice, bob, carol, viv] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Carol'), await signUp(app, 'Viv')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [carol, 'MEMBER'], [viv, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });

  const mkTask = async (body: Record<string, unknown> = {}, u = alice, pid = project.id) =>
    (await http().post(api(`/projects/${pid}/tasks`)).set(u.auth).send({ title: 'Fix login', ...body }).expect(201)).body as { id: string; key: string };
  const inbox = async (u: TestUser, query = '') => (await http().get(`/api/v1/notifications${query}`).set(u.auth).expect(200)).body as { items: Item[]; hasMore: boolean };
  const types = async (u: TestUser) => (await inbox(u)).items.map((i) => i.type);
  const unread = async (u: TestUser) => (await http().get('/api/v1/notifications/unread-count').set(u.auth).expect(200)).body as { count: number; workspaces: { workspaceId: string; count: number }[] };
  /** Handlers run after the request that caused them returns, so poll. */
  const until = async (check: () => Promise<boolean>, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 30)); }
    throw new Error('timed out waiting for notification');
  };
  const quiet = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const setPrefs = (u: TestUser, body: Record<string, unknown>) => http().put('/api/v1/notifications/preferences').set(u.auth).send(body);
  const statusId = (name: string) => project.statuses.find((s) => s.name === name)!.id;

  describe('task events', () => {
    it('tells people when they are assigned, but never about their own actions', async () => {
      const t = await mkTask({ assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).includes('ASSIGNED'));
      const n = (await inbox(bob)).items[0];
      expect(n).toMatchObject({ type: 'ASSIGNED', title: 'Alice assigned you SYN-1', body: 'Fix login', url: `/w/${ws}/tasks/${t.key}`, read: false, taskKey: 'SYN-1', workspaceId: ws });
      await http().patch(api(`/tasks/${t.key}`)).set(bob.auth).send({ assigneeIds: [bob.id, carol.id] }).expect(200);
      await until(async () => (await types(carol)).includes('ASSIGNED'));
      await quiet();
      expect((await types(bob)).filter((x) => x === 'ASSIGNED')).toHaveLength(1);
      expect(await types(alice)).toEqual([]);
    });

    it('notifies watchers about comments and status changes, and mentioned people once', async () => {
      const t = await mkTask({ assigneeIds: [bob.id] });
      await http().put(api(`/tasks/${t.key}/watch`)).set(carol.auth).expect(204);
      await until(async () => (await types(bob)).length === 1);
      await http().post(api(`/tasks/${t.key}/comments`)).set(alice.auth).send({ body: `Looks off [@Carol](mention:${carol.id}) what do you think?` }).expect(201);
      await until(async () => (await types(carol)).includes('MENTIONED'));
      await until(async () => (await types(bob)).includes('COMMENTED'));
      await quiet();
      expect(await types(carol)).toEqual(['MENTIONED']); // not also "commented"
      expect((await inbox(carol)).items[0]).toMatchObject({ title: 'Alice mentioned you in SYN-1', body: 'Looks off @Carol what do you think?' });
      expect((await inbox(bob)).items.find((i) => i.type === 'COMMENTED')).toMatchObject({ title: 'Alice commented on SYN-1' });
      expect(await types(alice)).toEqual([]);

      await http().patch(api(`/tasks/${t.key}`)).set(alice.auth).send({ statusId: statusId('In Progress') }).expect(200);
      await until(async () => (await types(carol)).includes('STATUS_CHANGED'));
      expect((await inbox(carol)).items.find((i) => i.type === 'STATUS_CHANGED')).toMatchObject({ title: 'Alice moved SYN-1 to In Progress' });
    });

    it('never notifies people who cannot see the project', async () => {
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await mkTask({ title: 'Layoffs plan', description: `cc [@Bob](mention:${bob.id})` }, alice, hidden.id);
      await http().post(api(`/tasks/SEC-1/comments`)).set(alice.auth).send({ body: `hey [@Bob](mention:${bob.id})` }).expect(201);
      await quiet(400);
      expect(await types(bob)).toEqual([]);
      // Once added to the project they hear about new things, and lose them again when removed.
      await http().put(api(`/projects/${hidden.id}/members`)).set(alice.auth).send({ userId: bob.id, role: 'MEMBER' }).expect(200);
      await http().post(api(`/tasks/SEC-1/comments`)).set(alice.auth).send({ body: `again [@Bob](mention:${bob.id})` }).expect(201);
      await until(async () => (await types(bob)).includes('MENTIONED'));
      expect((await unread(bob)).count).toBe(1);
      await http().delete(api(`/projects/${hidden.id}/members/${bob.id}`)).set(alice.auth).expect(204);
      expect(await types(bob)).toEqual([]);
      expect((await unread(bob)).count).toBe(0);
    });

    it('is quiet for muted projects and disabled types', async () => {
      await setPrefs(bob, { mutedProjectIds: [project.id] }).expect(200);
      await mkTask({ assigneeIds: [bob.id] });
      await quiet(400);
      expect(await types(bob)).toEqual([]);
      await setPrefs(bob, { mutedProjectIds: [] }).expect(200);
      await setPrefs(bob, { types: [{ type: 'ASSIGNED', inApp: false, email: false }] }).expect(200);
      await mkTask({ title: 'Second', assigneeIds: [bob.id] });
      await quiet(400);
      expect(await types(bob)).toEqual([]);
      expect(mail.notifications).toEqual([]);
    });
  });

  describe('inbox', () => {
    it('marks read and unread, reads everything, dismisses and keeps users apart', async () => {
      await mkTask({ assigneeIds: [bob.id] });
      await mkTask({ title: 'Second', assigneeIds: [bob.id] });
      await until(async () => (await unread(bob)).count === 2);
      const [a, b] = (await inbox(bob)).items;
      await http().post(`/api/v1/notifications/${a.id}/read`).set(bob.auth).expect(204);
      expect((await unread(bob)).count).toBe(1);
      expect((await inbox(bob, '?unread=true')).items.map((i) => i.id)).toEqual([b.id]);
      await http().post(`/api/v1/notifications/${a.id}/unread`).set(bob.auth).expect(204);
      expect((await unread(bob)).count).toBe(2);
      // other people cannot touch them
      for (const act of ['read', 'unread']) await http().post(`/api/v1/notifications/${a.id}/${act}`).set(carol.auth).expect(404);
      await http().delete(`/api/v1/notifications/${a.id}`).set(carol.auth).expect(404);
      await http().post('/api/v1/notifications/read-all').set(bob.auth).send({}).expect(204);
      expect((await unread(bob)).count).toBe(0);
      expect((await inbox(bob)).items).toHaveLength(2);
      await http().delete(`/api/v1/notifications/${a.id}`).set(bob.auth).expect(204);
      expect((await inbox(bob)).items.map((i) => i.id)).toEqual([b.id]);
      await http().post(`/api/v1/notifications/nope/read`).set(bob.auth).expect(404);
    });

    it('pages with a cursor and filters by workspace', async () => {
      for (let i = 0; i < 4; i++) await mkTask({ title: `T${i}`, assigneeIds: [bob.id] });
      await until(async () => (await unread(bob)).count === 4);
      const first = await inbox(bob, '?limit=3');
      expect(first.items).toHaveLength(3);
      expect(first.hasMore).toBe(true);
      const cursor = (await prisma.notification.findUniqueOrThrow({ where: { id: first.items[2].id } })).surfacedAt.toISOString();
      const second = await inbox(bob, `?limit=3&before=${encodeURIComponent(cursor)}`);
      expect(second.items).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      const other = (await http().post('/api/v1/workspaces').set(bob.auth).send({ name: 'Bob WS' }).expect(201)).body.id;
      expect((await inbox(bob, `?workspaceId=${other}`)).items).toEqual([]);
      expect((await inbox(bob, `?workspaceId=${ws}`)).items).toHaveLength(4);
      const counts = await unread(bob);
      expect(counts.workspaces).toEqual([{ workspaceId: ws, count: 4 }]);
      await http().post('/api/v1/notifications/read-all').set(bob.auth).send({ workspaceId: other }).expect(204);
      expect((await unread(bob)).count).toBe(4);
      await http().get('/api/v1/notifications').expect(401);
    });

    it('hides snoozed notifications until their time, then brings them back as unread', async () => {
      await mkTask({ assigneeIds: [bob.id] });
      await until(async () => (await unread(bob)).count === 1);
      const n = (await inbox(bob)).items[0];
      await http().post(`/api/v1/notifications/${n.id}/read`).set(bob.auth).expect(204);
      const hour = new Date(Date.now() + 3600_000).toISOString();
      await http().post(`/api/v1/notifications/${n.id}/snooze`).set(bob.auth).send({ until: new Date(Date.now() - 1000).toISOString() }).expect(400);
      await http().post(`/api/v1/notifications/${n.id}/snooze`).set(bob.auth).send({ until: new Date(Date.now() + 40 * 86400_000).toISOString() }).expect(400);
      await http().post(`/api/v1/notifications/${n.id}/snooze`).set(carol.auth).send({ until: hour }).expect(404);
      await http().post(`/api/v1/notifications/${n.id}/snooze`).set(bob.auth).send({ until: hour }).expect(204);
      expect((await inbox(bob)).items).toEqual([]);
      expect(await service.wakeSnoozed(new Date())).toBe(0);
      expect(await service.wakeSnoozed(new Date(Date.now() + 2 * 3600_000))).toBe(1);
      const back = await inbox(bob);
      expect(back.items).toHaveLength(1);
      expect(back.items[0]).toMatchObject({ id: n.id, read: false });
      expect((await unread(bob)).count).toBe(1);
    });
  });

  describe('preferences', () => {
    it('has sensible defaults and validates updates', async () => {
      const p = (await http().get('/api/v1/notifications/preferences').set(bob.auth).expect(200)).body;
      expect(p.emailMode).toBe('INSTANT');
      expect(p.quietHours).toEqual({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' });
      expect(p.types.find((t: { type: string }) => t.type === 'ASSIGNED')).toEqual({ type: 'ASSIGNED', inApp: true, email: true });
      expect(p.types.find((t: { type: string }) => t.type === 'COMMENTED')).toEqual({ type: 'COMMENTED', inApp: true, email: false });
      expect(p.types).toHaveLength(12);
      const upd = (await setPrefs(bob, { emailMode: 'DIGEST', quietHours: { enabled: true, start: '23:30', end: '07:15', timezone: 'Europe/Berlin' }, types: [{ type: 'COMMENTED', inApp: false, email: true }] }).expect(200)).body;
      expect(upd).toMatchObject({ emailMode: 'DIGEST', quietHours: { enabled: true, start: '23:30', end: '07:15', timezone: 'Europe/Berlin' } });
      expect(upd.types.find((t: { type: string }) => t.type === 'COMMENTED')).toEqual({ type: 'COMMENTED', inApp: false, email: true });
      expect(upd.types.find((t: { type: string }) => t.type === 'ASSIGNED')).toEqual({ type: 'ASSIGNED', inApp: true, email: true });
      await setPrefs(bob, { quietHours: { enabled: true, start: '25:00', end: '07:00', timezone: 'UTC' } }).expect(400);
      await setPrefs(bob, { quietHours: { enabled: true, start: '22:00', end: '07:00', timezone: 'Mars/Base' } }).expect(400);
      await setPrefs(bob, { emailMode: 'SOMETIMES' }).expect(400);
      await setPrefs(bob, { types: [{ type: 'NOPE', inApp: true, email: true }] }).expect(400);
      // other people's preferences are separate
      expect((await http().get('/api/v1/notifications/preferences').set(carol.auth).expect(200)).body.emailMode).toBe('INSTANT');
    });

    it('only keeps mutes for projects the person can see', async () => {
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      const res = (await setPrefs(bob, { mutedProjectIds: [project.id, hidden.id, 'bogus'] }).expect(200)).body;
      expect(res.mutedProjectIds).toEqual([project.id]);
    });
  });

  describe('email', () => {
    it('sends instant emails for the types that ask for attention, and not for the rest', async () => {
      const t = await mkTask({ assigneeIds: [bob.id] });
      await until(async () => mail.notifications.length === 1);
      expect(mail.notifications[0]).toEqual({ to: bob.email, items: [{ title: 'Alice assigned you SYN-1', body: 'Fix login', url: `/w/${ws}/tasks/SYN-1` }] });
      await http().post(api(`/tasks/${t.key}/comments`)).set(alice.auth).send({ body: 'just a comment' }).expect(201);
      await until(async () => (await types(bob)).includes('COMMENTED'));
      await quiet();
      expect(mail.notifications).toHaveLength(1);
      expect(await prisma.notification.count({ where: { userId: bob.id, emailState: 'SENT' } })).toBe(1);
    });

    it('can be switched off, and does not email what was already read', async () => {
      await setPrefs(bob, { emailMode: 'OFF' }).expect(200);
      await mkTask({ assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 1);
      await quiet();
      expect(mail.notifications).toEqual([]);
      await setPrefs(bob, { emailMode: 'DIGEST' }).expect(200);
      await mkTask({ title: 'Two', assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 2);
      const [fresh] = (await inbox(bob)).items;
      await http().post(`/api/v1/notifications/${fresh.id}/read`).set(bob.auth).expect(204);
      await service.flushEmails(new Date(Date.now() + 1000));
      expect(mail.notifications).toEqual([]);
    });

    it('batches digests to one email an hour', async () => {
      await setPrefs(bob, { emailMode: 'DIGEST' }).expect(200);
      await mkTask({ title: 'One', assigneeIds: [bob.id] });
      await mkTask({ title: 'Two', assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 2);
      expect(mail.notifications).toEqual([]);
      const now = new Date();
      expect(await service.flushEmails(now)).toBe(1);
      expect(mail.notifications).toHaveLength(1);
      expect(mail.notifications[0].items.map((i) => i.body).sort()).toEqual(['One', 'Two']);
      await mkTask({ title: 'Three', assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 3);
      expect(await service.flushEmails(new Date(now.getTime() + 30 * 60_000))).toBe(0);
      expect(await service.flushEmails(new Date(now.getTime() + 61 * 60_000))).toBe(1);
      expect(mail.notifications[1].items.map((i) => i.body)).toEqual(['Three']);
    });

    it('holds emails during quiet hours and sends them together afterwards', async () => {
      await setPrefs(bob, { quietHours: { enabled: true, start: '00:00', end: '23:59', timezone: 'UTC' } }).expect(200);
      await mkTask({ title: 'One', assigneeIds: [bob.id] });
      await mkTask({ title: 'Two', assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 2);
      expect(mail.notifications).toEqual([]); // held, though the inbox already has them
      expect(await service.flushEmails(new Date())).toBe(0);
      const afterQuiet = new Date(); afterQuiet.setUTCHours(23, 59, 30, 0);
      expect(await service.flushEmails(afterQuiet)).toBe(1);
      expect(mail.notifications).toHaveLength(1);
      expect(mail.notifications[0].items).toHaveLength(2);
    });

    it('keeps emails queued when sending fails and retries', async () => {
      mail.failNotifications = true;
      await mkTask({ assigneeIds: [bob.id] });
      await until(async () => (await types(bob)).length === 1);
      expect(await prisma.notification.count({ where: { userId: bob.id, emailState: 'PENDING' } })).toBe(1);
      mail.failNotifications = false;
      expect(await service.flushEmails()).toBe(1);
      expect(mail.notifications).toHaveLength(1);
      expect(await service.flushEmails()).toBe(0);
    });

    it('can send an email without showing it in the inbox', async () => {
      await setPrefs(bob, { types: [{ type: 'ASSIGNED', inApp: false, email: true }] }).expect(200);
      await mkTask({ assigneeIds: [bob.id] });
      await until(async () => mail.notifications.length === 1);
      expect(await types(bob)).toEqual([]);
      expect((await unread(bob)).count).toBe(0);
    });
  });

  describe('reminders', () => {
    const due = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

    it('announces tasks that are due soon or overdue once per due date', async () => {
      const soon = await mkTask({ title: 'Soon', assigneeIds: [bob.id], dueDate: new Date(Date.now() + 6 * 3600_000).toISOString() });
      const late = await mkTask({ title: 'Late', assigneeIds: [bob.id], dueDate: due(-2) });
      await mkTask({ title: 'Far', assigneeIds: [bob.id], dueDate: due(5) });
      await mkTask({ title: 'Ancient', assigneeIds: [bob.id], dueDate: due(-30) });
      await mkTask({ title: 'Nobody', dueDate: due(0.2) });
      const doneTask = await mkTask({ title: 'Finished', assigneeIds: [bob.id], dueDate: due(-1) });
      await http().patch(api(`/tasks/${doneTask.key}`)).set(alice.auth).send({ statusId: statusId('Done') }).expect(200);
      await until(async () => (await types(bob)).filter((x) => x === 'ASSIGNED').length === 5);
      expect(await reminders.remindDue()).toBe(2);
      expect(await reminders.remindDue()).toBe(0);
      const items = (await inbox(bob)).items.filter((i) => i.type === 'DUE_SOON' || i.type === 'OVERDUE');
      expect(items.map((i) => `${i.type}:${i.taskKey}`).sort()).toEqual([`DUE_SOON:${soon.key}`, `OVERDUE:${late.key}`].sort());
      expect(items.find((i) => i.type === 'OVERDUE')).toMatchObject({ title: `${late.key} is overdue` });
      // a new due date is a new reminder
      await http().patch(api(`/tasks/${soon.key}`)).set(alice.auth).send({ dueDate: new Date(Date.now() + 10 * 3600_000).toISOString() }).expect(200);
      expect(await reminders.remindDue()).toBe(1);
      // due reminders are emailed by default
      expect(mail.notifications.some((m) => m.items.some((i) => i.title.endsWith('is due soon')))).toBe(true);
    });
  });

  describe('sprints, chat and realtime', () => {
    it('tells the people in a sprint when it starts and completes', async () => {
      const a = await mkTask({ title: 'A', assigneeIds: [bob.id] });
      const sprint = (await http().post(api(`/projects/${project.id}/sprints`)).set(alice.auth).send({}).expect(201)).body;
      await http().post(api(`/projects/${project.id}/sprints/${sprint.id}/tasks`)).set(alice.auth).send({ taskIds: [a.id] }).expect(200);
      await until(async () => (await types(bob)).includes('ASSIGNED'));
      await http().post(api(`/projects/${project.id}/sprints/${sprint.id}/start`)).set(alice.auth).send({}).expect(200);
      await until(async () => (await types(bob)).includes('SPRINT_STARTED'));
      expect((await inbox(bob)).items.find((i) => i.type === 'SPRINT_STARTED')).toMatchObject({ title: 'Sprint 1 started', body: 'Synqonix', url: `/w/${ws}/projects/${project.id}` });
      expect(await types(carol)).toEqual([]);
      await http().post(api(`/projects/${project.id}/sprints/${sprint.id}/complete`)).set(alice.auth).send({ carryOver: 'BACKLOG' }).expect(200);
      await until(async () => (await types(bob)).includes('SPRINT_COMPLETED'));
    });

    it('notifies chat mentions with the channel and a link, once', async () => {
      const ch = (await http().post(api('/channels')).set(alice.auth).send({ name: 'dev', type: 'PUBLIC' }).expect(201)).body;
      await http().post(api(`/channels/${ch.id}/messages`)).set(alice.auth).send({ body: `ping [@Bob](mention:${bob.id}) about the release` }).expect(201);
      await until(async () => (await types(bob)).includes('CHAT_MENTION'));
      expect((await inbox(bob)).items[0]).toMatchObject({ title: 'Alice mentioned you in #dev', body: 'ping @Bob about the release', url: `/w/${ws}/chat?c=${ch.id}` });
      const dm = (await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [bob.id] }).expect(200)).body;
      await http().post(api(`/channels/${dm.id}/messages`)).set(alice.auth).send({ body: `psst [@Bob](mention:${bob.id})` }).expect(201);
      await until(async () => (await inbox(bob)).items.length === 2);
      expect((await inbox(bob)).items[0].title).toBe('Alice mentioned you in a direct message');
    });

    it('tells open tabs to refresh', async () => {
      const s = io(url, { auth: { token: bob.token }, transports: ['websocket'], reconnection: false });
      sockets.push(s);
      let pings = 0;
      s.on('notification', () => pings++);
      await new Promise<void>((resolve, reject) => { s.on('connect', resolve); s.on('connect_error', reject); });
      await quiet(100);
      const other = io(url, { auth: { token: carol.token }, transports: ['websocket'], reconnection: false });
      sockets.push(other);
      let otherPings = 0;
      other.on('notification', () => otherPings++);
      await new Promise<void>((resolve) => other.on('connect', () => resolve()));
      await quiet(100);
      await mkTask({ assigneeIds: [bob.id] });
      await until(async () => pings > 0);
      const before = pings;
      const n = (await inbox(bob)).items[0];
      await http().post(`/api/v1/notifications/${n.id}/read`).set(bob.auth).expect(204);
      await until(async () => pings > before);
      expect(otherPings).toBe(0);
    });
  });
});
