import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { downloadFile, uploadFile } from './files.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

describe('Channels and messages (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, carol: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, carol, viv, eve] = [
      await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Carol'), await signUp(app, 'Viv'), await signUp(app, 'Eve'),
    ];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [carol, 'ADMIN'], [viv, 'VIEWER']]);
  });

  const mkChannel = async (u: TestUser, body: Record<string, unknown>) => (await http().post(api('/channels')).set(u.auth).send(body).expect(201)).body;
  const post = (u: TestUser, ch: string, body: Record<string, unknown>) => http().post(api(`/channels/${ch}/messages`)).set(u.auth).send(body);
  const list = async (u: TestUser) => (await http().get(api('/channels')).set(u.auth).expect(200)).body as { id: string; name: string | null; type: string; unreadCount: number; mentionCount: number; projectId: string | null }[];
  const mkProject = async (u: TestUser, key: string, extra: Record<string, unknown> = {}) =>
    (await http().post(api('/projects')).set(u.auth).send({ name: `Project ${key}`, key, template: 'SCRUM', ...extra }).expect(201)).body;

  describe('channel visibility', () => {
    it('keeps private channels hidden from non-members, including workspace admins and owners', async () => {
      const secret = await mkChannel(bob, { name: 'secret', type: 'PRIVATE', memberIds: [viv.id] });
      expect((await list(bob)).map((c) => c.id)).toContain(secret.id);
      expect((await list(viv)).map((c) => c.id)).toContain(secret.id);
      for (const outsider of [alice, carol, eve]) {
        if (outsider !== eve) expect((await list(outsider)).map((c) => c.id)).not.toContain(secret.id);
        await http().get(api(`/channels/${secret.id}`)).set(outsider.auth).expect(404);
        await http().get(api(`/channels/${secret.id}/messages`)).set(outsider.auth).expect(404);
        await post(outsider, secret.id, { body: 'hi' }).expect(404);
        await http().post(api(`/channels/${secret.id}/join`)).set(outsider.auth).expect(404);
      }
    });

    it('lets everyone in the workspace see public channels, and joining follows them', async () => {
      const ch = await mkChannel(alice, { name: 'General Chat', type: 'PUBLIC', topic: 'hello' });
      expect(ch).toMatchObject({ name: 'General Chat', topic: 'hello', isMember: true, isAdmin: true });
      const seen = (await list(bob)).find((c) => c.id === ch.id)!;
      expect(seen).toMatchObject({ isMember: false });
      const joined = (await http().post(api(`/channels/${ch.id}/join`)).set(bob.auth).expect(200)).body;
      expect(joined.isMember).toBe(true);
      await http().post(api(`/channels/${ch.id}/leave`)).set(bob.auth).expect(204);
      expect((await http().get(api(`/channels/${ch.id}`)).set(bob.auth).expect(200)).body.isMember).toBe(false);
      // Not a workspace member at all
      await http().get(api(`/channels/${ch.id}`)).set(eve.auth).expect(404);
    });

    it('creates a channel per project and follows project visibility', async () => {
      const open = await mkProject(alice, 'OPN');
      const hidden = await mkProject(alice, 'HID', { visibility: 'PRIVATE' });
      const channels = await list(bob);
      expect(channels.find((c) => c.projectId === open.id)).toMatchObject({ name: 'opn', type: 'PUBLIC' });
      expect(channels.find((c) => c.projectId === hidden.id)).toBeUndefined();
      expect((await list(alice)).find((c) => c.projectId === hidden.id)).toMatchObject({ type: 'PRIVATE' });
      // A project admin who is not a workspace admin sees and manages it once added.
      await http().put(api(`/projects/${hidden.id}/members`)).set(alice.auth).send({ userId: bob.id, role: 'MEMBER' }).expect(200);
      expect((await list(bob)).find((c) => c.projectId === hidden.id)).toMatchObject({ isMember: true, canPost: true });
      await http().delete(api(`/projects/${hidden.id}/members/${bob.id}`)).set(alice.auth).expect(204);
      expect((await list(bob)).find((c) => c.projectId === hidden.id)).toBeUndefined();
    });

    it('hides a project channel when its project becomes private', async () => {
      const p = await mkProject(alice, 'FLP');
      const chId = (await list(bob)).find((c) => c.projectId === p.id)!.id;
      await http().get(api(`/channels/${chId}`)).set(bob.auth).expect(200);
      await http().patch(api(`/projects/${p.id}`)).set(alice.auth).send({ visibility: 'PRIVATE' }).expect(200);
      await http().get(api(`/channels/${chId}`)).set(bob.auth).expect(404);
      await http().get(api(`/channels/${chId}`)).set(alice.auth).expect(200);
    });

    it('only lets admins rename, archive and manage members', async () => {
      const ch = await mkChannel(alice, { name: 'team', type: 'PUBLIC' });
      await http().patch(api(`/channels/${ch.id}`)).set(bob.auth).send({ topic: 'x' }).expect(403);
      await http().post(api(`/channels/${ch.id}/members`)).set(bob.auth).send({ userId: carol.id }).expect(403);
      const renamed = (await http().patch(api(`/channels/${ch.id}`)).set(alice.auth).send({ name: 'crew', topic: 'planning' }).expect(200)).body;
      expect(renamed).toMatchObject({ name: 'crew', topic: 'planning' });
      // workspace admins moderate public channels
      await http().patch(api(`/channels/${ch.id}`)).set(carol.auth).send({ topic: 'by carol' }).expect(200);
      const priv = await mkChannel(alice, { name: 'inner', type: 'PRIVATE' });
      await http().post(api(`/channels/${priv.id}/members`)).set(alice.auth).send({ userId: bob.id }).expect(201);
      await http().post(api(`/channels/${priv.id}/members`)).set(alice.auth).send({ userId: eve.id }).expect(400); // not in workspace
      expect((await http().get(api(`/channels/${priv.id}/members`)).set(bob.auth).expect(200)).body).toHaveLength(2);
      await http().delete(api(`/channels/${priv.id}/members/${bob.id}`)).set(alice.auth).expect(204);
      await http().get(api(`/channels/${priv.id}`)).set(bob.auth).expect(404);
    });

    it('rejects project channels being renamed, and viewers creating channels', async () => {
      const p = await mkProject(alice, 'REN');
      const chId = (await list(alice)).find((c) => c.projectId === p.id)!.id;
      await http().patch(api(`/channels/${chId}`)).set(alice.auth).send({ name: 'nope' }).expect(400);
      await http().post(api('/channels')).set(viv.auth).send({ name: 'v', type: 'PUBLIC' }).expect(400);
    });
  });

  describe('direct messages', () => {
    it('finds or creates one conversation per set of people', async () => {
      const a = (await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [bob.id] }).expect(200)).body;
      const b = (await http().post(api('/channels/direct')).set(bob.auth).send({ userIds: [alice.id] }).expect(200)).body;
      expect(b.id).toBe(a.id);
      expect(a.type).toBe('DIRECT');
      expect(a.participants.map((p: { userId: string }) => p.userId).sort()).toEqual([alice.id, bob.id].sort());
      const group = (await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [bob.id, carol.id] }).expect(200)).body;
      expect(group.id).not.toBe(a.id);
      await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [alice.id] }).expect(400);
      await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [eve.id] }).expect(400);
    });

    it('is invisible to everyone else, admins included, and cannot be changed', async () => {
      const dm = (await http().post(api('/channels/direct')).set(alice.auth).send({ userIds: [bob.id] }).expect(200)).body;
      await post(alice, dm.id, { body: 'private words' }).expect(201);
      for (const outsider of [carol, viv, eve]) {
        await http().get(api(`/channels/${dm.id}/messages`)).set(outsider.auth).expect(404);
        if (outsider !== eve) expect((await list(outsider)).map((c) => c.id)).not.toContain(dm.id);
      }
      await http().patch(api(`/channels/${dm.id}`)).set(alice.auth).send({ topic: 'x' }).expect(403);
      await http().post(api(`/channels/${dm.id}/leave`)).set(alice.auth).expect(400);
    });

    it('lets viewers talk in direct messages but not in channels', async () => {
      const dm = (await http().post(api('/channels/direct')).set(viv.auth).send({ userIds: [alice.id] }).expect(200)).body;
      expect(dm.canPost).toBe(true);
      await post(viv, dm.id, { body: 'question' }).expect(201);
      const pub = await mkChannel(alice, { name: 'announce', type: 'PUBLIC' });
      expect((await http().get(api(`/channels/${pub.id}`)).set(viv.auth).expect(200)).body.canPost).toBe(false);
      await post(viv, pub.id, { body: 'nope' }).expect(403);
      await http().get(api(`/channels/${pub.id}/messages`)).set(viv.auth).expect(200);
    });
  });

  describe('messages', () => {
    let ch: { id: string };
    beforeEach(async () => { ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' }); });

    it('posts, lists in order and paginates by seq', async () => {
      for (let i = 1; i <= 5; i++) await post(alice, ch.id, { body: `m${i}` }).expect(201);
      const all = (await http().get(api(`/channels/${ch.id}/messages`)).set(bob.auth).expect(200)).body;
      expect(all.messages.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      expect(all.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(all.hasMore).toBe(false);
      const older = (await http().get(api(`/channels/${ch.id}/messages?limit=2&before=5`)).set(bob.auth).expect(200)).body;
      expect(older.messages.map((m: { body: string }) => m.body)).toEqual(['m3', 'm4']);
      expect(older.hasMore).toBe(true);
      const newer = (await http().get(api(`/channels/${ch.id}/messages?after=3`)).set(bob.auth).expect(200)).body;
      expect(newer.messages.map((m: { body: string }) => m.body)).toEqual(['m4', 'm5']);
      await post(alice, ch.id, { body: '   ' }).expect(400);
    });

    it('gives concurrent posts contiguous, unique sequence numbers', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post(i % 2 ? alice : bob, ch.id, { body: `c${i}` })));
      results.forEach((r) => expect(r.status).toBe(201));
      const seqs = results.map((r) => r.body.seq as number).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it('keeps replies in threads and includes them in catch-up when asked', async () => {
      const root = (await post(alice, ch.id, { body: 'root' }).expect(201)).body;
      const r1 = (await post(bob, ch.id, { body: 'reply 1', parentId: root.id }).expect(201)).body;
      await post(alice, ch.id, { body: 'reply 2', parentId: root.id }).expect(201);
      expect(r1.parentId).toBe(root.id);
      const top = (await http().get(api(`/channels/${ch.id}/messages`)).set(bob.auth).expect(200)).body.messages;
      expect(top).toHaveLength(1);
      expect(top[0]).toMatchObject({ replyCount: 2 });
      const thread = (await http().get(api(`/channels/${ch.id}/messages/${root.id}/replies`)).set(bob.auth).expect(200)).body.messages;
      expect(thread.map((m: { body: string }) => m.body)).toEqual(['reply 1', 'reply 2']);
      const stream = (await http().get(api(`/channels/${ch.id}/messages?after=0&threads=true`)).set(bob.auth).expect(200)).body.messages;
      expect(stream).toHaveLength(3);
      // replies of replies are not allowed
      await post(alice, ch.id, { body: 'deep', parentId: r1.id }).expect(400);
      await post(alice, ch.id, { body: 'x', parentId: 'nope' }).expect(404);
    });

    it('does not let a thread parent from another channel be used', async () => {
      const other = await mkChannel(alice, { name: 'other', type: 'PUBLIC' });
      const root = (await post(alice, other.id, { body: 'elsewhere' }).expect(201)).body;
      await post(alice, ch.id, { body: 'x', parentId: root.id }).expect(404);
    });

    it('lets only the author edit, and the author or an admin delete', async () => {
      const m = (await post(bob, ch.id, { body: 'first' }).expect(201)).body;
      await http().patch(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).send({ body: 'hack' }).expect(403);
      const edited = (await http().patch(api(`/channels/${ch.id}/messages/${m.id}`)).set(bob.auth).send({ body: 'second' }).expect(200)).body;
      expect(edited).toMatchObject({ body: 'second', edited: true });
      const other = (await post(bob, ch.id, { body: 'another' }).expect(201)).body;
      const third = (await post(carol, ch.id, { body: 'carol says' }).expect(201)).body;
      await http().delete(api(`/channels/${ch.id}/messages/${third.id}`)).set(bob.auth).expect(403);
      await http().delete(api(`/channels/${ch.id}/messages/${third.id}`)).set(bob.auth).expect(403);
      await http().delete(api(`/channels/${ch.id}/messages/${other.id}`)).set(alice.auth).expect(204); // channel admin
      await http().delete(api(`/channels/${ch.id}/messages/${third.id}`)).set(carol.auth).expect(204);
      const after = (await http().get(api(`/channels/${ch.id}/messages`)).set(bob.auth).expect(200)).body.messages;
      expect(after.find((x: { id: string }) => x.id === other.id)).toMatchObject({ deleted: true, body: '', author: expect.anything() });
      await http().patch(api(`/channels/${ch.id}/messages/${other.id}`)).set(bob.auth).send({ body: 'zombie' }).expect(404);
    });

    it('supports emoji reactions, once per user and emoji, and rejects non-emoji', async () => {
      const m = (await post(alice, ch.id, { body: 'ship it' }).expect(201)).body;
      const url = (e: string) => api(`/channels/${ch.id}/messages/${m.id}/reactions/${encodeURIComponent(e)}`);
      await http().put(url('👍')).set(bob.auth).expect(200);
      await http().put(url('👍')).set(bob.auth).expect(200);
      const r = (await http().put(url('👍')).set(carol.auth).expect(200)).body;
      expect(r.reactions).toEqual([{ emoji: '👍', count: 2, userIds: [bob.id, carol.id], reacted: true }]);
      const seen = (await http().get(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).expect(200)).body;
      expect(seen.reactions[0].reacted).toBe(false);
      await http().put(url('hello')).set(bob.auth).expect(400);
      await http().put(url('<script>')).set(bob.auth).expect(400);
      const gone = (await http().delete(url('👍')).set(bob.auth).expect(200)).body;
      expect(gone.reactions[0]).toMatchObject({ count: 1 });
      await http().put(url('🎉')).set(viv.auth).expect(403);
    });

    it('is read-only once archived', async () => {
      const m = (await post(alice, ch.id, { body: 'last words' }).expect(201)).body;
      await http().patch(api(`/channels/${ch.id}`)).set(alice.auth).send({ archived: true }).expect(200);
      await post(alice, ch.id, { body: 'more' }).expect(403);
      await http().patch(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).send({ body: 'edit' }).expect(403);
      await http().delete(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).expect(403);
      await http().get(api(`/channels/${ch.id}/messages`)).set(alice.auth).expect(200);
      expect((await list(alice)).map((c) => c.id)).not.toContain(ch.id);
      expect((await http().get(api('/channels?includeArchived=true')).set(alice.auth).expect(200)).body.map((c: { id: string }) => c.id)).toContain(ch.id);
    });
  });

  describe('read state', () => {
    it('counts unread messages and mentions per user and clears them when read', async () => {
      const ch = await mkChannel(alice, { name: 'news', type: 'PUBLIC' });
      await http().post(api(`/channels/${ch.id}/join`)).set(bob.auth).expect(200);
      await post(alice, ch.id, { body: 'one' }).expect(201);
      const root = (await post(alice, ch.id, { body: `hey [@Bob](mention:${bob.id})` }).expect(201)).body;
      await post(alice, ch.id, { body: 'a reply', parentId: root.id }).expect(201);
      await post(bob, ch.id, { body: 'mine' }).expect(201);
      const mine = (await list(bob)).find((c) => c.id === ch.id)!;
      // Posting marks the channel read, so Bob has nothing unread afterwards.
      expect(mine).toMatchObject({ unreadCount: 0, mentionCount: 0 });
      await post(alice, ch.id, { body: 'two' }).expect(201);
      await post(alice, ch.id, { body: `again [@Bob](mention:${bob.id})` }).expect(201);
      expect((await list(bob)).find((c) => c.id === ch.id)).toMatchObject({ unreadCount: 2, mentionCount: 1 });
      expect((await list(alice)).find((c) => c.id === ch.id)).toMatchObject({ unreadCount: 0 });
      const res = (await http().post(api(`/channels/${ch.id}/read`)).set(bob.auth).send({}).expect(200)).body;
      expect(res.lastReadSeq).toBe(6);
      expect((await list(bob)).find((c) => c.id === ch.id)).toMatchObject({ unreadCount: 0, mentionCount: 0 });
      // Never moves backwards
      expect((await http().post(api(`/channels/${ch.id}/read`)).set(bob.auth).send({ seq: 1 }).expect(200)).body.lastReadSeq).toBe(6);
    });

    it('starts a new follower at the latest message', async () => {
      const ch = await mkChannel(alice, { name: 'old', type: 'PUBLIC' });
      await post(alice, ch.id, { body: 'history' }).expect(201);
      const joined = (await http().post(api(`/channels/${ch.id}/join`)).set(bob.auth).expect(200)).body;
      expect(joined).toMatchObject({ unreadCount: 0, lastReadSeq: 1 });
    });
  });

  describe('mentions', () => {
    it('only records mentions for people who can see the channel', async () => {
      const priv = await mkChannel(alice, { name: 'core', type: 'PRIVATE', memberIds: [bob.id] });
      await post(alice, priv.id, { body: `[@Bob](mention:${bob.id}) [@Carol](mention:${carol.id}) [@Alice](mention:${alice.id})` }).expect(201);
      const rows = await prisma.messageMention.findMany();
      expect(rows.map((r) => r.userId)).toEqual([bob.id]);
    });
  });

  describe('task links', () => {
    let project: { id: string };
    let task: { id: string; key: string };
    beforeEach(async () => {
      project = await mkProject(alice, 'SYN');
      task = (await http().post(api(`/projects/${project.id}/tasks`)).set(alice.auth).send({ title: 'Fix login' }).expect(201)).body;
    });

    it('resolves keys in messages to cards, ignoring code spans', async () => {
      const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
      const m = (await post(alice, ch.id, { body: `Looking at ${task.key} and \`SYN-999\`` }).expect(201)).body;
      expect(m.taskKeys).toEqual([task.key]);
      expect(m.tasks).toHaveLength(1);
      expect(m.tasks[0]).toMatchObject({ key: task.key, title: 'Fix login' });
      const refs = (await http().get(api(`/task-refs?keys=${task.key},syn-404,bogus`)).set(bob.auth).expect(200)).body;
      expect(refs.map((r: { key: string }) => r.key)).toEqual([task.key]);
    });

    it('never shows task details to people who cannot see the project', async () => {
      const hidden = await mkProject(alice, 'SEC', { visibility: 'PRIVATE' });
      const secret = (await http().post(api(`/projects/${hidden.id}/tasks`)).set(alice.auth).send({ title: 'Layoffs' }).expect(201)).body;
      const ch = await mkChannel(alice, { name: 'gen', type: 'PUBLIC' });
      await post(alice, ch.id, { body: `see ${secret.key}` }).expect(201);
      const asBob = (await http().get(api(`/channels/${ch.id}/messages`)).set(bob.auth).expect(200)).body.messages[0];
      expect(asBob.tasks).toEqual([]);
      expect(JSON.stringify(asBob)).not.toContain('Layoffs');
      const asAlice = (await http().get(api(`/channels/${ch.id}/messages`)).set(alice.auth).expect(200)).body.messages[0];
      expect(asAlice.tasks[0].title).toBe('Layoffs');
      expect((await http().get(api(`/task-refs?keys=${secret.key}`)).set(bob.auth).expect(200)).body).toEqual([]);
      // Bob cannot link it by hand either
      const m = (await post(bob, ch.id, { body: 'hmm' }).expect(201)).body;
      await http().post(api(`/channels/${ch.id}/messages/${m.id}/tasks`)).set(bob.auth).send({ taskRef: secret.key }).expect(404);
    });

    it('links a message to a task and lists it under the task discussions', async () => {
      const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
      const priv = await mkChannel(bob, { name: 'bobs', type: 'PRIVATE' });
      const m = (await post(alice, ch.id, { body: 'Thoughts on the login bug' }).expect(201)).body;
      const hiddenMsg = (await post(bob, priv.id, { body: `private chat about ${task.key}` }).expect(201)).body;
      const linked = (await http().post(api(`/channels/${ch.id}/messages/${m.id}/tasks`)).set(bob.auth).send({ taskRef: task.key }).expect(200)).body;
      expect(linked.tasks.map((t: { key: string }) => t.key)).toEqual([task.key]);
      expect(linked.taskKeys).toEqual([]);
      const ds = (await http().get(api(`/tasks/${task.key}/discussions`)).set(alice.auth).expect(200)).body;
      expect(ds.map((d: { message: { id: string } }) => d.message.id)).toEqual([m.id]);
      expect(ds[0].source).toBe('LINKED');
      const asBob = (await http().get(api(`/tasks/${task.key}/discussions`)).set(bob.auth).expect(200)).body;
      expect(asBob.map((d: { message: { id: string } }) => d.message.id).sort()).toEqual([m.id, hiddenMsg.id].sort());
      const unlinked = (await http().delete(api(`/channels/${ch.id}/messages/${m.id}/tasks/${task.key}`)).set(alice.auth).expect(200)).body;
      expect(unlinked.tasks).toEqual([]);
    });

    it('creates a task from a message and links it', async () => {
      const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
      const m = (await post(bob, ch.id, { body: '## Crash on startup\nrepro: open the app' }).expect(201)).body;
      const res = (await http().post(api(`/channels/${ch.id}/messages/${m.id}/create-task`)).set(bob.auth).send({ projectId: project.id }).expect(200)).body;
      expect(res.tasks).toHaveLength(1);
      expect(res.tasks[0].title).toBe('Crash on startup');
      const created = (await http().get(api(`/tasks/${res.tasks[0].key}`)).set(bob.auth).expect(200)).body;
      expect(created.description).toContain('repro: open the app');
      expect((await http().get(api(`/tasks/${res.tasks[0].key}/discussions`)).set(bob.auth).expect(200)).body[0].source).toBe('CREATED');
      // A viewer cannot create tasks.
      await http().post(api(`/channels/${ch.id}/messages/${m.id}/create-task`)).set(viv.auth).send({ projectId: project.id }).expect(403);
    });

    it('drops links when the message is deleted or edited away', async () => {
      const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
      const m = (await post(alice, ch.id, { body: `fix ${task.key}` }).expect(201)).body;
      const edited = (await http().patch(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).send({ body: 'no keys now' }).expect(200)).body;
      expect(edited.tasks).toEqual([]);
      await http().patch(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).send({ body: `back to ${task.key}` }).expect(200);
      await http().delete(api(`/channels/${ch.id}/messages/${m.id}`)).set(alice.auth).expect(204);
      expect((await http().get(api(`/tasks/${task.key}/discussions`)).set(alice.auth).expect(200)).body).toEqual([]);
    });
  });

  describe('attachments', () => {
    it('uploads, attaches to a message and downloads as an attachment', async () => {
      const ch = await mkChannel(alice, { name: 'files', type: 'PUBLIC' });
      const att = api(`/channels/${ch.id}/attachments`);
      const { confirm } = await uploadFile(app, att, alice.auth, Buffer.from('hello world'), '../notes.txt');
      const up = (await confirm().expect(201)).body;
      expect(up).toMatchObject({ filename: 'notes.txt', size: 11 });
      // Unsent files are private to the uploader.
      await http().get(`${att}/${up.id}/download-url`).set(bob.auth).expect(404);
      await http().get(`${att}/${up.id}/download-url`).set(alice.auth).expect(200);
      // Someone else cannot attach it.
      await post(bob, ch.id, { body: 'stolen', attachmentIds: [up.id] }).expect(400);
      const m = (await post(alice, ch.id, { body: '', attachmentIds: [up.id] }).expect(201)).body;
      expect(m.attachments).toEqual([{ id: up.id, filename: 'notes.txt', mimeType: expect.any(String), size: 11 }]);
      const dl = await downloadFile(app, `${att}/${up.id}/download-url`, bob.auth);
      expect(dl.headers['content-disposition']).toContain('attachment');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.body.toString()).toBe('hello world');
      // Not reusable.
      await post(alice, ch.id, { body: 'again', attachmentIds: [up.id] }).expect(400);
    });

    it('enforces the size limit, access and the channel', async () => {
      const priv = await mkChannel(alice, { name: 'hush', type: 'PRIVATE' });
      const att = api(`/channels/${priv.id}/attachments`);
      await http().post(`${att}/upload-url`).set(bob.auth).send({ filename: 'x.txt', size: 1 }).expect(404);
      await http().post(`${att}/upload-url`).set(alice.auth).send({ filename: 'big.bin', size: 1024 * 1024 + 1 }).expect(413);
      await http().post(att).set(alice.auth).send({}).expect(400);
      const { confirm } = await uploadFile(app, att, alice.auth, Buffer.from('x'), 'x.txt');
      const up = (await confirm().expect(201)).body;
      const m = (await post(alice, priv.id, { body: 'file', attachmentIds: [up.id] }).expect(201)).body;
      expect(m.attachments).toHaveLength(1);
      await http().get(`${att}/${up.id}/download-url`).set(carol.auth).expect(404);
      // Deleting the message removes the file.
      await http().delete(api(`/channels/${priv.id}/messages/${m.id}`)).set(alice.auth).expect(204);
      await http().get(`${att}/${up.id}/download-url`).set(alice.auth).expect(404);
    });
  });

  describe('membership changes', () => {
    it('removes a member from every channel when they leave the workspace', async () => {
      const ch = await mkChannel(alice, { name: 'tmp', type: 'PRIVATE', memberIds: [bob.id] });
      await http().delete(api(`/members/${bob.id}`)).set(alice.auth).expect(204);
      expect(await prisma.channelMember.count({ where: { channelId: ch.id, userId: bob.id } })).toBe(0);
    });
  });
});
