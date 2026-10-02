import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

interface Result {
  query: { text: string; filters: Record<string, string[]> };
  tasks: { key: string; title: string; snippet: string | null }[];
  comments: { taskKey: string; snippet: string }[];
  projects: { key: string; name: string }[];
  channels: { name: string; type: string }[];
  messages: { channelName: string; snippet: string }[];
  people: { name: string; email: string }[];
}

describe('Search (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  let labels: { id: string; name: string }[];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());

  const find = async (u: TestUser, q: string, extra = '') => (await http().get(api(`/search?q=${encodeURIComponent(q)}${extra}`)).set(u.auth).expect(200)).body as Result;
  const keys = async (u: TestUser, q: string) => (await find(u, q)).tasks.map((t) => t.key);
  const mk = async (body: Record<string, unknown>, pid = project.id) => (await http().post(api(`/projects/${pid}/tasks`)).set(alice.auth).send(body).expect(201)).body as { key: string; id: string };
  const status = (n: string) => project.statuses.find((s) => s.name === n)!.id;
  const msg = (ch: string, u: TestUser, body: string) => http().post(api(`/channels/${ch}/messages`)).set(u.auth).send({ body }).expect(201);

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, viv, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
    labels = (await http().get(api(`/projects/${project.id}`)).set(alice.auth).expect(200)).body.labels;

    await mk({ title: 'Fix login redirect bug', description: 'Users get logged out when refreshing the page', type: 'BUG', priority: 'HIGH', assigneeIds: [bob.id], labelIds: [labels.find((l) => l.name === 'bug')!.id] });
    await mk({ title: 'Dashboard charts', description: 'Burndown chart rendering is slow on large sprints', type: 'STORY' });
    await mk({ title: 'Write release notes', statusId: status('Done') });
    const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
    await mk({ title: 'Secret merger plan', description: 'Acquisition of Initech by friday' }, hidden.id);
    await http().post(api('/tasks/SYN-1/comments')).set(bob.auth).send({ body: 'I reproduced the logout problem on Safari' }).expect(201);
    await http().post(api('/tasks/SEC-1/comments')).set(alice.auth).send({ body: 'Acquisition budget approved by the board' }).expect(201);

    const dev = (await http().post(api('/channels')).set(alice.auth).send({ name: 'dev-talk', type: 'PUBLIC' }).expect(201)).body;
    await msg(dev.id, alice, 'The login fix is scheduled for friday');
    const priv = (await http().post(api('/channels')).set(alice.auth).send({ name: 'compensation', type: 'PRIVATE', memberIds: [bob.id] }).expect(201)).body;
    await msg(priv.id, alice, 'Salary discussion after the login release');
    const dm = (await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [bob.id] }).expect(200)).body;
    await msg(dm.id, alice, 'lunch after the login standup?');
  });

  describe('tasks', () => {
    it('matches titles, descriptions (with a snippet) and stems words', async () => {
      expect(await keys(alice, 'login')).toEqual(['SYN-1']);
      expect(await keys(alice, 'logins')).toEqual(['SYN-1']); // stemming
      const burn = (await find(alice, 'burndown')).tasks;
      expect(burn.map((t) => t.key)).toEqual(['SYN-2']);
      expect(burn[0].snippet).toContain('Burndown chart rendering');
      expect((await find(alice, 'login')).tasks[0].snippet).toBeNull(); // matched in the title already
    });

    it('is forgiving about typos and case, and finds tasks by key', async () => {
      expect(await keys(alice, 'dashbord')).toEqual(['SYN-2']);
      expect(await keys(alice, 'RELEASE NOTES')).toEqual(['SYN-3']);
      expect((await keys(alice, 'syn-3'))[0]).toBe('SYN-3');
      expect(await keys(alice, 'nothing-matches-this')).toEqual([]);
    });

    it('ranks the best match first', async () => {
      await mk({ title: 'Login', description: 'short' });
      expect((await keys(alice, 'login'))[0]).toBe('SYN-4');
    });

    it('treats wildcards literally', async () => {
      expect(await keys(alice, '%')).toEqual([]);
      expect(await keys(alice, '_ogin')).toEqual([]);
    });

    it('supports filters, alone and with text', async () => {
      expect(await keys(bob, 'assignee:me')).toEqual(['SYN-1']);
      expect((await keys(alice, 'assignee:none')).sort()).toEqual(['SEC-1', 'SYN-2', 'SYN-3']);
      expect(await keys(alice, 'assignee:bo')).toEqual(['SYN-1']);
      expect((await keys(alice, 'status:open')).sort()).toEqual(['SEC-1', 'SYN-1', 'SYN-2']);
      expect(await keys(alice, 'status:done')).toEqual(['SYN-3']);
      expect(await keys(alice, 'is:done')).toEqual(['SYN-3']);
      expect(await keys(alice, 'status:"To Do" type:bug')).toEqual(['SYN-1']);
      expect(await keys(alice, 'label:bug')).toEqual(['SYN-1']);
      expect(await keys(alice, 'priority:high')).toEqual(['SYN-1']);
      expect((await keys(alice, 'project:syn')).sort()).toEqual(['SYN-1', 'SYN-2', 'SYN-3']);
      expect(await keys(alice, 'assignee:me chart')).toEqual([]);
      expect(await keys(bob, 'assignee:me login')).toEqual(['SYN-1']);
      expect(await keys(alice, 'reporter:me project:syn type:story')).toEqual(['SYN-2']);
      const r = await find(alice, 'assignee:me status:open label:bug login');
      expect(r.query).toEqual({ text: 'login', filters: { assignee: ['me'], status: ['open'], label: ['bug'] } });
    });

    it('finds overdue and archived tasks, and rejects nonsense values quietly', async () => {
      await http().patch(api('/tasks/SYN-2')).set(alice.auth).send({ dueDate: '2020-01-01T00:00:00.000Z' }).expect(200);
      await http().patch(api('/tasks/SYN-3')).set(alice.auth).send({ dueDate: '2020-01-01T00:00:00.000Z' }).expect(200);
      expect(await keys(alice, 'is:overdue')).toEqual(['SYN-2']); // finished work is not overdue
      await http().post(api('/tasks/SYN-2/archive')).set(alice.auth).expect(200);
      expect(await keys(alice, 'chart')).toEqual([]);
      expect(await keys(alice, 'is:archived')).toEqual(['SYN-2']);
      expect(await keys(alice, 'type:potato')).toEqual([]);
      expect(await keys(alice, 'is:whatever')).toEqual([]);
    });

    it('ignores other kinds of results when filters are used', async () => {
      const r = await find(alice, 'status:open login');
      expect(r.comments).toEqual([]);
      expect(r.messages).toEqual([]);
      expect(r.people).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('never reveals private projects through titles, descriptions, comments or filters', async () => {
      for (const q of ['secret', 'merger', 'initech', 'acquisition', 'SEC-1', 'project:sec', 'status:open secret']) {
        const r = await find(bob, q);
        expect(r.tasks.map((t) => t.key)).not.toContain('SEC-1');
        expect(r.comments.map((c) => c.taskKey)).not.toContain('SEC-1');
        const { query: _query, ...results } = r; // the query itself is echoed back
        expect(JSON.stringify(results)).not.toMatch(/Initech|Acquisition|merger/i);
      }
      expect((await find(bob, 'secret')).projects).toEqual([]);
      expect(await keys(alice, 'initech')).toEqual(['SEC-1']);
      expect((await find(alice, 'acquisition')).comments).toEqual([expect.objectContaining({ taskKey: 'SEC-1' })]);
      expect((await find(alice, 'secret')).projects).toEqual([expect.objectContaining({ key: 'SEC' })]);
    });

    it('limits messages and channels to what the person is in', async () => {
      const asAlice = await find(alice, 'login');
      expect(asAlice.messages.map((m) => m.channelName).sort()).toEqual(['Bob', 'compensation', 'dev-talk'].sort());
      const asViv = await find(viv, 'login');
      expect(asViv.messages.map((m) => m.channelName)).toEqual(['dev-talk']);
      expect((await find(viv, 'compensation')).channels).toEqual([]);
      expect((await find(alice, 'compensation')).channels).toEqual([expect.objectContaining({ name: 'compensation', type: 'PRIVATE' })]);
      // a DM is found by the other person's name, but only by its members
      expect((await find(alice, 'bob', '&types=channels')).channels).toEqual([expect.objectContaining({ name: 'Bob', type: 'DIRECT' })]);
      expect((await find(viv, 'bob', '&types=channels')).channels).toEqual([]);
    });

    it('drops deleted messages and comments of tasks the person cannot see', async () => {
      const dev = (await http().get(api('/channels')).set(alice.auth).expect(200)).body.find((c: { name: string }) => c.name === 'dev-talk');
      const m = (await http().get(api(`/channels/${dev.id}/messages`)).set(alice.auth).expect(200)).body.messages[0];
      await http().delete(api(`/channels/${dev.id}/messages/${m.id}`)).set(alice.auth).expect(204);
      expect((await find(alice, 'friday', '&types=messages')).messages).toEqual([]);
    });

    it('is closed to people outside the workspace and needs a login', async () => {
      await http().get(api('/search?q=login')).set(eve.auth).expect(404);
      await http().get(api('/search?q=login')).expect(401);
    });
  });

  describe('other kinds', () => {
    it('finds comments with a snippet around the match', async () => {
      const r = await find(alice, 'safari');
      expect(r.comments).toEqual([expect.objectContaining({ taskKey: 'SYN-1', snippet: 'I reproduced the logout problem on Safari' })]);
    });

    it('finds projects, channels and people', async () => {
      expect((await find(alice, 'synq')).projects).toEqual([expect.objectContaining({ key: 'SYN', name: 'Synqonix' })]);
      expect((await find(alice, 'syn')).projects.map((p) => p.key)).toEqual(['SYN']);
      expect((await find(alice, 'dev')).channels).toEqual([expect.objectContaining({ name: 'dev-talk' })]);
      expect((await find(bob, 'ali')).people).toEqual([expect.objectContaining({ name: 'Alice', email: alice.email })]);
      expect((await find(bob, 'eve')).people).toEqual([]); // not in this workspace
    });

    it('can be narrowed by kind and limited', async () => {
      const r = await find(alice, 'login', '&types=tasks,people');
      expect(r.comments).toEqual([]);
      expect(r.messages).toEqual([]);
      expect(r.tasks).toHaveLength(1);
      for (let i = 0; i < 5; i++) await mk({ title: `Login variant ${i}` });
      expect((await find(alice, 'login', '&types=tasks&limit=3')).tasks).toHaveLength(3);
      expect((await find(alice, '   ')).tasks).toEqual([]);
      await http().get(api('/search')).set(alice.auth).expect(400);
      await http().get(api('/search?q=a&limit=500')).set(alice.auth).expect(400);
    });
  });
});
