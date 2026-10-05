import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const uploadDir = process.env.UPLOAD_DIR!; // set in vitest.config.e2e.ts

import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { downloadFile, uploadFile } from './files.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

describe('Tasks (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, vic: TestUser, eve: TestUser, admin: TestUser;
  let ws: string;
  let syn: { id: string; statuses: { id: string; name: string; category: string }[]; labels: { id: string; name: string }[] };
  let emitted: { name: string; payload: Record<string, unknown> }[];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => {
    ({ app, mail, prisma } = await createTestApp());
    app.get(EventEmitter2).onAny((name, payload) => emitted.push({ name: String(name), payload }));
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    emitted = [];
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, vic, eve, admin] = [
      await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Vic'),
      await signUp(app, 'Eve'), await signUp(app, 'Adm'),
    ];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [vic, 'VIEWER'], [admin, 'ADMIN']]);
    const p = await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201);
    syn = p.body;
    emitted = [];
  });

  const status = (name: string) => syn.statuses.find((s) => s.name === name)!.id;
  const label = (name: string) => syn.labels.find((l) => l.name === name)!.id;
  const mk = (user: TestUser, body: Record<string, unknown> = {}, project = syn.id) =>
    http().post(api(`/projects/${project}/tasks`)).set(user.auth).send({ title: 'A task', ...body });
  const task = (ref: string, user = alice) => http().get(api(`/tasks/${ref}`)).set(user.auth);
  const patch = (ref: string, body: Record<string, unknown>, user = alice) =>
    http().patch(api(`/tasks/${ref}`)).set(user.auth).send(body);
  const activityOf = async (ref: string) => (await http().get(api(`/tasks/${ref}/activity`)).set(alice.auth).expect(200)).body as
    { type: string; field: string | null; from: unknown; to: unknown }[];

  describe('creating', () => {
    it('creates tasks with sequential keys, defaults and a created activity', async () => {
      const a = await mk(alice, { title: '  First  ' }).expect(201);
      expect(a.body).toMatchObject({
        key: 'SYN-1', number: 1, title: 'First', type: 'TASK', priority: 'NONE', reporterId: alice.id,
        status: { name: 'To Do', category: 'TODO' }, canEdit: true, isWatching: true,
      });
      const b = await mk(bob).expect(201);
      expect(b.body.key).toBe('SYN-2');
      expect((await task('SYN-1')).body.id).toBe(a.body.id);
      expect((await task('syn-2')).body.id).toBe(b.body.id); // keys are case-insensitive
      expect((await task(a.body.id)).body.key).toBe('SYN-1');
      await task('SYN-99').expect(404);
      expect((await activityOf('SYN-1')).map((x) => x.type)).toEqual(['created']);
    });

    it('allocates distinct keys under concurrency', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => mk(alice, { title: `T${i}` })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => r.body.number).sort((x, y) => x - y);
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it('stores all fields, assignees, labels and a due date', async () => {
      const t = await mk(alice, {
        title: 'Rich', type: 'BUG', priority: 'HIGH', estimate: 5, dueDate: '2026-12-31',
        description: 'Steps:\n```js\nconsole.log(1)\n```', assigneeIds: [bob.id], labelIds: [label('bug')],
      }).expect(201);
      expect(t.body).toMatchObject({ type: 'BUG', priority: 'HIGH', estimate: 5 });
      expect(t.body.assignees).toEqual([{ userId: bob.id, name: 'Bob' }]);
      expect(t.body.labels.map((l: { name: string }) => l.name)).toEqual(['bug']);
      expect(t.body.watchers.map((w: { userId: string }) => w.userId).sort()).toEqual([alice.id, bob.id].sort());
      expect(new Date(t.body.dueDate).toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(t.body.description).toContain('console.log');
    });

    it('validates input and permissions', async () => {
      await mk(alice, { title: '' }).expect(400);
      await mk(alice, { estimate: -1 }).expect(400);
      await mk(alice, { priority: 'WHENEVER' }).expect(400);
      await mk(alice, { statusId: 'nope' }).expect(400);
      await mk(alice, { labelIds: ['nope'] }).expect(400);
      await mk(alice, { assigneeIds: [eve.id] }).expect(400); // not in the workspace
      await mk(vic).expect(403); // viewers cannot create
      await mk(eve).expect(404); // outsiders cannot even see the workspace
      await http().post(api(`/projects/${syn.id}/tasks`)).send({ title: 'x' }).expect(401);
    });

    it('refuses new tasks in archived projects', async () => {
      await http().post(api(`/projects/${syn.id}/archive`)).set(alice.auth).expect(200);
      await mk(alice).expect(400);
    });
  });

  describe('updating & activity', () => {
    it('records one activity row per changed field and none for no-ops', async () => {
      await mk(alice, { title: 'Old', priority: 'LOW' }).expect(201);
      await patch('SYN-1', { title: 'Old', priority: 'LOW' }).expect(200); // unchanged
      expect(await activityOf('SYN-1')).toHaveLength(1);

      await patch('SYN-1', {
        title: 'New', priority: 'URGENT', estimate: 8, dueDate: '2026-01-15', description: 'desc',
        statusId: status('In Progress'), assigneeIds: [bob.id], labelIds: [label('feature')],
      }).expect(200);

      const acts = (await activityOf('SYN-1')).filter((a) => a.type === 'updated');
      expect(acts.map((a) => a.field).sort()).toEqual(['assignees', 'description', 'dueDate', 'estimate', 'labels', 'priority', 'status', 'title']);
      expect(acts.find((a) => a.field === 'title')).toMatchObject({ from: 'Old', to: 'New' });
      expect(acts.find((a) => a.field === 'status')).toMatchObject({ from: 'To Do', to: 'In Progress' });
      expect(acts.find((a) => a.field === 'priority')).toMatchObject({ from: 'LOW', to: 'URGENT' });
      expect(acts.find((a) => a.field === 'assignees')).toMatchObject({ from: [], to: [bob.id] });
      expect(acts.find((a) => a.field === 'labels')).toMatchObject({ from: [], to: ['feature'] });
    });

    it('tracks started/completed timestamps through the workflow', async () => {
      await mk(alice).expect(201);
      expect((await task('SYN-1')).body).toMatchObject({ startedAt: null, completedAt: null });
      const started = await patch('SYN-1', { statusId: status('In Progress') });
      expect(started.body.startedAt).toBeTruthy();
      expect(started.body.completedAt).toBeNull();
      const done = await patch('SYN-1', { statusId: status('Done') });
      expect(done.body.completedAt).toBeTruthy();
      const reopened = await patch('SYN-1', { statusId: status('In Progress') });
      expect(reopened.body.completedAt).toBeNull();
      expect(reopened.body.startedAt).toBe(started.body.startedAt);
    });

    it('clears nullable fields and replaces lists', async () => {
      await mk(alice, { description: 'x', estimate: 3, dueDate: '2026-05-05', assigneeIds: [bob.id], labelIds: [label('bug')] }).expect(201);
      const r = await patch('SYN-1', { description: null, estimate: null, dueDate: null, assigneeIds: [], labelIds: [] }).expect(200);
      expect(r.body).toMatchObject({ description: null, estimate: null, dueDate: null, assignees: [], labels: [] });
    });

    it('enforces write access and rejects bad references', async () => {
      await mk(alice).expect(201);
      await patch('SYN-1', { title: 'x' }, vic).expect(403);
      await patch('SYN-1', { title: 'x' }, eve).expect(404);
      await patch('SYN-1', { statusId: 'other' }).expect(400);
      await patch('SYN-1', { assigneeIds: [eve.id] }).expect(400);
      await patch('SYN-1', { parentId: '00000000-0000-7000-8000-000000000000' }).expect(400);
    });

    it('emits domain events', async () => {
      await mk(alice, { assigneeIds: [bob.id] }).expect(201);
      expect(emitted.map((e) => e.name)).toEqual(expect.arrayContaining(['task.created', 'task.assigned']));
      emitted = [];
      await patch('SYN-1', { statusId: status('Done') }).expect(200);
      const changed = emitted.find((e) => e.name === 'task.status_changed')!;
      expect(changed.payload).toMatchObject({ taskKey: 'SYN-1', from: 'To Do', to: 'Done', actorId: alice.id });
      expect(emitted.some((e) => e.name === 'task.updated')).toBe(true);
    });
  });

  describe('hierarchy', () => {
    it('supports epic > story > subtask and rolls up subtask counts', async () => {
      const epic = (await mk(alice, { type: 'EPIC', title: 'Epic' }).expect(201)).body;
      const story = (await mk(alice, { type: 'STORY', parentId: epic.id }).expect(201)).body;
      const s1 = (await mk(alice, { type: 'SUBTASK', parentId: story.id, title: 's1' }).expect(201)).body;
      await mk(alice, { type: 'SUBTASK', parentId: story.id, title: 's2' }).expect(201);
      await patch(s1.id, { statusId: status('Done') }).expect(200);

      const detail = (await task(story.id)).body;
      expect(detail).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1, parent: { key: epic.key } });
      expect(detail.subtasks.map((s: { title: string }) => s.title)).toEqual(['s1', 's2']);
    });

    it('rejects invalid nesting', async () => {
      const epic = (await mk(alice, { type: 'EPIC' }).expect(201)).body;
      const story = (await mk(alice, { type: 'STORY' }).expect(201)).body;
      const sub = (await mk(alice, { type: 'SUBTASK', parentId: story.id }).expect(201)).body;
      await mk(alice, { type: 'SUBTASK' }).expect(400); // needs a parent
      await mk(alice, { type: 'SUBTASK', parentId: epic.id }).expect(400);
      await mk(alice, { type: 'EPIC', parentId: epic.id }).expect(400);
      await mk(alice, { type: 'STORY', parentId: story.id }).expect(400);
      await mk(alice, { type: 'TASK', parentId: sub.id }).expect(400);
      await patch(story.id, { type: 'EPIC' }).expect(400); // has sub-tasks
      await patch(story.id, { parentId: story.id }).expect(400);
      await patch(story.id, { parentId: epic.id }).expect(200);
      await patch(epic.id, { type: 'TASK' }).expect(400); // has a child story
      await patch(story.id, { parentId: null }).expect(200);
    });

    it('does not accept parents from another project', async () => {
      const other = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
      const epic = (await mk(alice, { type: 'EPIC' }, other.id).expect(201)).body;
      await mk(alice, { type: 'STORY', parentId: epic.id }).expect(400);
    });
  });

  describe('comments & mentions', () => {
    const mention = (u: TestUser) => `[@${u.email.split('@')[0]}](mention:${u.id})`;

    it('adds, edits and deletes comments with the right permissions', async () => {
      await mk(alice).expect(201);
      const c = await http().post(api('/tasks/SYN-1/comments')).set(bob.auth).send({ body: 'Looks **good**' }).expect(201);
      expect(c.body).toMatchObject({ authorId: bob.id, body: 'Looks **good**', edited: false });
      await http().post(api('/tasks/SYN-1/comments')).set(vic.auth).send({ body: 'hi' }).expect(403);
      await http().post(api('/tasks/SYN-1/comments')).set(bob.auth).send({ body: '' }).expect(400);

      await http().patch(api(`/tasks/SYN-1/comments/${c.body.id}`)).set(alice.auth).send({ body: 'hijack' }).expect(403);
      const edited = await http().patch(api(`/tasks/SYN-1/comments/${c.body.id}`)).set(bob.auth).send({ body: 'Edited' }).expect(200);
      expect(edited.body).toMatchObject({ body: 'Edited', edited: true });

      const list = await http().get(api('/tasks/SYN-1/comments')).set(vic.auth).expect(200);
      expect(list.body).toHaveLength(1);
      expect((await task('SYN-1')).body.commentCount).toBe(1);

      await http().delete(api(`/tasks/SYN-1/comments/${c.body.id}`)).set(vic.auth).expect(403);
      await http().delete(api(`/tasks/SYN-1/comments/${c.body.id}`)).set(admin.auth).expect(204); // project admin
      expect((await http().get(api('/tasks/SYN-1/comments')).set(alice.auth)).body).toEqual([]);
    });

    it('emits mention events only for visible members, and only for new mentions on edit', async () => {
      await mk(alice).expect(201);
      emitted = [];
      const c = await http().post(api('/tasks/SYN-1/comments')).set(alice.auth)
        .send({ body: `ping ${mention(bob)} and ${mention(alice)} and [@Eve](mention:${eve.id})` }).expect(201);
      const first = emitted.find((e) => e.name === 'task.mentioned')!;
      // self-mentions and non-members are dropped
      expect(first.payload).toMatchObject({ mentionedUserIds: [bob.id], source: 'comment', commentId: c.body.id, taskKey: 'SYN-1' });
      expect(emitted.some((e) => e.name === 'task.commented')).toBe(true);

      emitted = [];
      await http().patch(api(`/tasks/SYN-1/comments/${c.body.id}`)).set(alice.auth)
        .send({ body: `ping ${mention(bob)} again, plus ${mention(vic)}` }).expect(200);
      const second = emitted.find((e) => e.name === 'task.mentioned')!;
      expect(second.payload.mentionedUserIds).toEqual([vic.id]); // bob was already notified
    });

    it('emits mention events for descriptions, not for private-project outsiders', async () => {
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      emitted = [];
      await mk(alice, { description: `fyi ${mention(bob)}` }, priv.id).expect(201);
      expect(emitted.some((e) => e.name === 'task.mentioned')).toBe(false); // bob cannot see SEC

      emitted = [];
      await mk(alice, { description: `fyi ${mention(bob)}` }).expect(201);
      expect(emitted.find((e) => e.name === 'task.mentioned')!.payload).toMatchObject({ source: 'description', mentionedUserIds: [bob.id] });
      emitted = [];
      await patch('SYN-1', { description: `fyi ${mention(bob)} and ${mention(vic)}` }).expect(200);
      expect(emitted.find((e) => e.name === 'task.mentioned')!.payload.mentionedUserIds).toEqual([vic.id]);
    });
  });

  describe('checklists', () => {
    it('manages checklists and items', async () => {
      await mk(alice).expect(201);
      const cl = (await http().post(api('/tasks/SYN-1/checklists')).set(bob.auth).send({ title: 'Definition of done' }).expect(201)).body;
      let r = await http().post(api(`/tasks/SYN-1/checklists/${cl.id}/items`)).set(bob.auth).send({ text: 'Write tests' }).expect(201);
      await http().post(api(`/tasks/SYN-1/checklists/${cl.id}/items`)).set(bob.auth).send({ text: 'Ship' }).expect(201);
      const itemId = r.body.items[0].id;
      r = await http().patch(api(`/tasks/SYN-1/checklists/${cl.id}/items/${itemId}`)).set(bob.auth).send({ done: true }).expect(200);
      expect(r.body.items.map((i: { done: boolean }) => i.done)).toEqual([true, false]);
      await http().patch(api(`/tasks/SYN-1/checklists/${cl.id}`)).set(bob.auth).send({ title: 'DoD' }).expect(200);
      await http().post(api(`/tasks/SYN-1/checklists/${cl.id}/items`)).set(vic.auth).send({ text: 'no' }).expect(403);

      expect((await task('SYN-1')).body.checklists).toEqual([
        expect.objectContaining({ title: 'DoD', items: [expect.objectContaining({ text: 'Write tests', done: true }), expect.objectContaining({ text: 'Ship', done: false })] }),
      ]);
      await http().delete(api(`/tasks/SYN-1/checklists/${cl.id}/items/${itemId}`)).set(bob.auth).expect(200);
      await http().delete(api(`/tasks/SYN-1/checklists/${cl.id}/items/${itemId}`)).set(bob.auth).expect(404);
      await http().delete(api(`/tasks/SYN-1/checklists/${cl.id}`)).set(bob.auth).expect(204);
      expect((await task('SYN-1')).body.checklists).toEqual([]);
    });
  });

  describe('relations', () => {
    it('links tasks in both directions and prevents contradictions', async () => {
      await mk(alice, { title: 'A' }).expect(201);
      await mk(alice, { title: 'B' }).expect(201);
      await http().post(api('/tasks/SYN-1/relations')).set(alice.auth).send({ type: 'BLOCKS', targetTask: 'SYN-2' }).expect(204);
      expect((await task('SYN-1')).body.relations).toEqual([expect.objectContaining({ kind: 'blocks', task: expect.objectContaining({ key: 'SYN-2' }) })]);
      expect((await task('SYN-2')).body.relations).toEqual([expect.objectContaining({ kind: 'blocked_by', task: expect.objectContaining({ key: 'SYN-1' }) })]);

      await http().post(api('/tasks/SYN-1/relations')).set(alice.auth).send({ type: 'BLOCKS', targetTask: 'SYN-2' }).expect(409);
      await http().post(api('/tasks/SYN-2/relations')).set(alice.auth).send({ type: 'BLOCKS', targetTask: 'SYN-1' }).expect(409); // reverse
      await http().post(api('/tasks/SYN-1/relations')).set(alice.auth).send({ type: 'BLOCKS', targetTask: 'SYN-1' }).expect(400);
      await http().post(api('/tasks/SYN-1/relations')).set(alice.auth).send({ type: 'RELATES', targetTask: 'SYN-2' }).expect(204);
      await http().post(api('/tasks/SYN-2/relations')).set(alice.auth).send({ type: 'RELATES', targetTask: 'SYN-1' }).expect(409); // symmetric
      await http().post(api('/tasks/SYN-1/relations')).set(vic.auth).send({ type: 'RELATES', targetTask: 'SYN-2' }).expect(403);

      const rel = (await task('SYN-1')).body.relations.find((r: { kind: string }) => r.kind === 'blocks');
      await http().delete(api(`/tasks/SYN-1/relations/${rel.id}`)).set(alice.auth).expect(204);
      expect((await task('SYN-2')).body.relations.map((r: { kind: string }) => r.kind)).toEqual(['relates_to']);
    });

    it('hides related tasks from projects the viewer cannot see', async () => {
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      await mk(alice, { title: 'Public' }).expect(201);
      await mk(alice, { title: 'Hidden' }, priv.id).expect(201);
      await http().post(api('/tasks/SYN-1/relations')).set(alice.auth).send({ type: 'RELATES', targetTask: 'SEC-1' }).expect(204);
      expect((await task('SYN-1', alice)).body.relations).toHaveLength(1);
      expect((await task('SYN-1', bob)).body.relations).toEqual([]);
      await http().post(api('/tasks/SYN-1/relations')).set(bob.auth).send({ type: 'BLOCKS', targetTask: 'SEC-1' }).expect(404);
    });
  });

  describe('watchers', () => {
    it('lets anyone who can see the task follow it', async () => {
      await mk(alice).expect(201);
      expect((await task('SYN-1', vic)).body.isWatching).toBe(false);
      await http().put(api('/tasks/SYN-1/watch')).set(vic.auth).expect(204);
      await http().put(api('/tasks/SYN-1/watch')).set(vic.auth).expect(204); // idempotent
      const t = (await task('SYN-1', vic)).body;
      expect(t.isWatching).toBe(true);
      expect(t.watchers.map((w: { userId: string }) => w.userId)).toContain(vic.id);
      await http().delete(api('/tasks/SYN-1/watch')).set(vic.auth).expect(204);
      expect((await task('SYN-1', vic)).body.isWatching).toBe(false);
      await http().put(api('/tasks/SYN-1/watch')).set(eve.auth).expect(404);
    });

    it('auto-watches commenters and new assignees', async () => {
      await mk(alice).expect(201);
      await http().post(api('/tasks/SYN-1/comments')).set(bob.auth).send({ body: 'hi' }).expect(201);
      await patch('SYN-1', { assigneeIds: [admin.id] }).expect(200);
      const ids = (await task('SYN-1')).body.watchers.map((w: { userId: string }) => w.userId);
      expect(ids).toEqual(expect.arrayContaining([alice.id, bob.id, admin.id]));
    });
  });

  describe('attachments', () => {
    it('uploads and downloads through presigned links, and deletes the stored file', async () => {
      await mk(alice).expect(201);
      const att = api('/tasks/SYN-1/attachments');
      const { confirm, target } = await uploadFile(app, att, bob.auth, Buffer.from('hello world'), '../../evil/notes.txt', { mimeType: 'text/html' });
      // The link, not the API route, receives the bytes, and only accepts the announced size and type.
      expect(target.uploadUrl).toContain('/storage/local/upload');
      expect(target.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
      const up = await confirm().expect(201);
      expect(up.body).toMatchObject({ filename: 'notes.txt', size: 11, uploaderId: bob.id });

      const dl = await downloadFile(app, api(`/tasks/SYN-1/attachments/${up.body.id}/download-url`), vic.auth);
      expect(dl.body.toString()).toBe('hello world');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-type']).toBe('application/octet-stream');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect((await task('SYN-1')).body.attachments).toHaveLength(1);

      const files = () => readdirSync(join(uploadDir, ws), { recursive: true }).length;
      expect(files()).toBeGreaterThan(0);
      await http().delete(api(`/tasks/SYN-1/attachments/${up.body.id}`)).set(vic.auth).expect(403);
      await http().delete(api(`/tasks/SYN-1/attachments/${up.body.id}`)).set(bob.auth).expect(204);
      expect((await task('SYN-1')).body.attachments).toEqual([]);
      const leftovers = readdirSync(join(uploadDir, ws), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
      expect(leftovers).toHaveLength(0);
    });

    it('there is no way to send or fetch file bytes through the API itself', async () => {
      await mk(alice).expect(201);
      await http().post(api('/tasks/SYN-1/attachments')).set(bob.auth).attach('file', Buffer.from('x'), 'x.txt').expect(400);
      await http().get(api('/tasks/SYN-1/attachments/anything/download')).set(bob.auth).expect(404);
    });

    it('rejects oversized, unauthorised and mismatched uploads', async () => {
      await mk(alice).expect(201);
      const att = api('/tasks/SYN-1/attachments');
      await http().post(`${att}/upload-url`).set(bob.auth).send({ filename: 'big.bin', size: 2 * 1024 * 1024 }).expect(413);
      await http().post(`${att}/upload-url`).set(bob.auth).send({ filename: 'x.txt', size: 0 }).expect(400);
      await http().post(`${att}/upload-url`).set(vic.auth).send({ filename: 'x.txt', size: 1 }).expect(403);
      await http().get(api('/tasks/SYN-1/attachments/nope/download-url')).set(bob.auth).expect(404);

      // Confirming without uploading, with a forged token, or as someone else fails.
      const target = (await http().post(`${att}/upload-url`).set(bob.auth).send({ filename: 'a.txt', size: 3 }).expect(201)).body;
      await http().post(att).set(bob.auth).send({ uploadToken: target.uploadToken }).expect(400);
      await http().post(att).set(bob.auth).send({ uploadToken: `${target.uploadToken}x` }).expect(401);
      const url = new URL(target.uploadUrl);
      await http().put(url.pathname + url.search).set(target.headers).send(Buffer.from('abc')).expect(200);
      await http().post(att).set(alice.auth).send({ uploadToken: target.uploadToken }).expect(400);

      // A different size than announced is refused by the upload link itself.
      const small = (await http().post(`${att}/upload-url`).set(bob.auth).send({ filename: 'b.txt', size: 5 }).expect(201)).body;
      const u2 = new URL(small.uploadUrl);
      await http().put(u2.pathname + u2.search).set(small.headers).send(Buffer.from('toolong')).expect(400);
      // A link only works for what it was issued for.
      await http().put(`/api/v1/storage/local/upload?token=${target.uploadToken}`).send(Buffer.from('abc')).expect(400);
    });

    it('a download link expires with the token and is refused when tampered with', async () => {
      await mk(alice).expect(201);
      const { confirm } = await uploadFile(app, api('/tasks/SYN-1/attachments'), bob.auth, Buffer.from('data'), 'd.txt');
      const att = (await confirm().expect(201)).body;
      const link = (await http().get(api(`/tasks/SYN-1/attachments/${att.id}/download-url`)).set(bob.auth).expect(200)).body as { url: string };
      const u = new URL(link.url);
      await http().get(u.pathname + u.search.slice(0, -2) + 'zz').expect(401);
      await http().get('/api/v1/storage/local/download').expect(401);
    });

    it('deletes stored files when the task is deleted', async () => {
      await mk(alice).expect(201);
      const { confirm } = await uploadFile(app, api('/tasks/SYN-1/attachments'), alice.auth, Buffer.from('bye'), 'b.txt');
      await confirm().expect(201);
      await http().delete(api('/tasks/SYN-1')).set(alice.auth).expect(204);
      const left = existsSync(join(uploadDir, ws)) ? readdirSync(join(uploadDir, ws), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()) : [];
      expect(left).toHaveLength(0);
    });
  });

  describe('custom fields', () => {
    it('defines fields and stores validated values', async () => {
      const url = api(`/projects/${syn.id}/custom-fields`);
      const mkField = (body: Record<string, unknown>, user = alice) => http().post(url).set(user.auth).send(body);
      const sp = (await mkField({ name: 'Story points', type: 'NUMBER' }).expect(201)).body;
      const env = (await mkField({ name: 'Env', type: 'SELECT', options: ['dev', 'prod'] }).expect(201)).body;
      const note = (await mkField({ name: 'Note', type: 'TEXT' }).expect(201)).body;
      const ok = (await mkField({ name: 'Reviewed', type: 'CHECKBOX' }).expect(201)).body;
      await mkField({ name: 'Env', type: 'TEXT' }).expect(409);
      await mkField({ name: 'Bad', type: 'SELECT' }).expect(400);
      await mkField({ name: 'Bad', type: 'TEXT', options: ['x'] }).expect(400);
      await mkField({ name: 'Nope', type: 'TEXT' }, bob).expect(403); // members cannot define fields
      expect((await http().get(url).set(vic.auth).expect(200)).body).toHaveLength(4);

      await mk(alice, { customFields: { [sp.id]: 5, [env.id]: 'prod' } }).expect(201);
      await mk(alice, { customFields: { [sp.id]: 'five' } }).expect(400);
      await mk(alice, { customFields: { [env.id]: 'staging' } }).expect(400);
      await mk(alice, { customFields: { nope: 1 } }).expect(400);

      const t = (await patch('SYN-1', { customFields: { [note.id]: 'hello', [ok.id]: true, [sp.id]: 8 } }).expect(200)).body;
      expect(t.customFields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Story points', value: 8 }),
        expect.objectContaining({ name: 'Env', value: 'prod' }),
        expect.objectContaining({ name: 'Note', value: 'hello' }),
        expect.objectContaining({ name: 'Reviewed', value: true }),
      ]));
      const acts = await activityOf('SYN-1');
      expect(acts.find((a) => a.field === 'custom:Story points')).toMatchObject({ from: 5, to: 8 });

      const cleared = (await patch('SYN-1', { customFields: { [note.id]: null } }).expect(200)).body;
      expect(cleared.customFields.map((f: { name: string }) => f.name)).not.toContain('Note');

      await http().patch(`${url}/${env.id}`).set(alice.auth).send({ options: ['dev', 'staging', 'prod'] }).expect(200);
      await http().patch(`${url}/${note.id}`).set(alice.auth).send({ options: ['x'] }).expect(400);
      await http().delete(`${url}/${ok.id}`).set(alice.auth).expect(204);
      expect((await task('SYN-1')).body.customFields.map((f: { name: string }) => f.name)).not.toContain('Reviewed');
    });
  });

  describe('listing & filtering', () => {
    beforeEach(async () => {
      await mk(alice, { title: 'Login page', type: 'STORY', priority: 'HIGH', assigneeIds: [bob.id], labelIds: [label('feature')], dueDate: '2026-03-01' }).expect(201);
      await mk(alice, { title: 'Crash on save', type: 'BUG', priority: 'URGENT', assigneeIds: [alice.id], labelIds: [label('bug')], dueDate: '2026-02-01' }).expect(201);
      await mk(alice, { title: 'Write docs', type: 'TASK', priority: 'LOW', statusId: status('Done') }).expect(201);
      await mk(alice, { title: 'Subtask of login', type: 'SUBTASK', parentId: (await task('SYN-1')).body.id }).expect(201);
    });
    const list = (qs: string, user = alice) => http().get(api(`/tasks?${qs}`)).set(user.auth).expect(200);
    const keys = (r: { body: { items: { key: string }[] } }) => r.body.items.map((i) => i.key);

    it('filters by assignee, status, type, priority, label and parent', async () => {
      expect(keys(await list('assignee=me', bob))).toEqual(['SYN-1']);
      expect(keys(await list('assignee=none&sort=number'))).toEqual(['SYN-3', 'SYN-4']);
      expect(keys(await list(`assignee=${alice.id}`))).toEqual(['SYN-2']);
      expect(keys(await list(`statusId=${status('Done')}`))).toEqual(['SYN-3']);
      expect(keys(await list('statusCategory=TODO&sort=number'))).toEqual(['SYN-1', 'SYN-2', 'SYN-4']);
      expect(keys(await list('type=BUG'))).toEqual(['SYN-2']);
      expect(keys(await list('priority=HIGH'))).toEqual(['SYN-1']);
      expect(keys(await list(`labelId=${label('bug')}`))).toEqual(['SYN-2']);
      expect(keys(await list('parent=none&sort=number'))).toEqual(['SYN-1', 'SYN-2', 'SYN-3']);
      expect(keys(await list(`parent=${(await task('SYN-1')).body.id}`))).toEqual(['SYN-4']);
      expect(keys(await list('reporter=me&sort=number&limit=1'))).toEqual(['SYN-1']);
    });

    it('searches by title, key and number', async () => {
      expect(keys(await list('q=crash'))).toEqual(['SYN-2']);
      expect(keys(await list('q=SYN-3'))).toEqual(['SYN-3']);
      expect(keys(await list('q=syn-3'))).toEqual(['SYN-3']);
      expect(keys(await list('q=2'))).toEqual(['SYN-2']);
      expect(keys(await list('q=nothing-matches'))).toEqual([]);
    });

    it('sorts, paginates and filters by due date', async () => {
      expect(keys(await list('sort=priority&order=asc&limit=2'))).toEqual(['SYN-2', 'SYN-1']);
      expect(keys(await list('sort=dueDate&order=asc'))).toEqual(['SYN-2', 'SYN-1', 'SYN-3', 'SYN-4']); // nulls last
      expect(keys(await list('sort=title&order=asc'))).toEqual(['SYN-2', 'SYN-1', 'SYN-4', 'SYN-3']);
      const page = await list('sort=number&limit=2&offset=1');
      expect(keys(page)).toEqual(['SYN-2', 'SYN-3']);
      expect(page.body.total).toBe(4);
      expect(keys(await list('dueBefore=2026-02-15'))).toEqual(['SYN-2']);
      expect(keys(await list('dueAfter=2026-02-15'))).toEqual(['SYN-1']);
      await http().get(api('/tasks?limit=500')).set(alice.auth).expect(400);
      await http().get(api('/tasks?sort=bogus')).set(alice.auth).expect(400);
    });

    it('hides archived tasks unless asked, and scopes by project', async () => {
      await http().post(api('/tasks/SYN-3/archive')).set(alice.auth).expect(200);
      expect(keys(await list('sort=number'))).toEqual(['SYN-1', 'SYN-2', 'SYN-4']);
      expect(keys(await list('sort=number&includeArchived=true'))).toEqual(['SYN-1', 'SYN-2', 'SYN-3', 'SYN-4']);
      expect((await list(`projectId=${syn.id}`)).body.total).toBe(3);
      await http().get(api('/tasks?projectId=missing')).set(alice.auth).expect(404);
      const summary = (await list('q=Login&sort=number')).body.items[0];
      expect(summary).toMatchObject({ key: 'SYN-1', subtaskCount: 1, subtaskDoneCount: 0, assignees: [{ name: 'Bob' }] });
    });

    it('never lists tasks from private projects the caller cannot see', async () => {
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      await mk(alice, { title: 'Classified' }, priv.id).expect(201);
      expect(keys(await list('q=Classified', alice))).toEqual(['SEC-1']);
      expect(keys(await list('q=Classified', bob))).toEqual([]);
      await task('SEC-1', bob).expect(404);
      await http().get(api(`/tasks?projectId=${priv.id}`)).set(bob.auth).expect(404);
      await patch('SEC-1', { title: 'x' }, bob).expect(404);
      await http().post(api('/tasks/SEC-1/comments')).set(bob.auth).send({ body: 'x' }).expect(404);
      // adding bob to the project reveals it
      await http().put(api(`/projects/${priv.id}/members`)).set(alice.auth).send({ userId: bob.id, role: 'MEMBER' }).expect(200);
      expect(keys(await list('q=Classified', bob))).toEqual(['SEC-1']);
    });
  });

  describe('bulk edit', () => {
    it('updates many tasks atomically', async () => {
      for (let i = 0; i < 3; i++) await mk(alice, { labelIds: i === 0 ? [label('bug')] : [] }).expect(201);
      const ids = (await http().get(api('/tasks?sort=number')).set(alice.auth)).body.items.map((t: { id: string }) => t.id);
      const res = await http().patch(api('/tasks/bulk')).set(bob.auth).send({
        taskIds: ids,
        changes: { statusId: status('In Progress'), priority: 'HIGH', assigneeIds: [bob.id], addLabelIds: [label('feature')], removeLabelIds: [label('bug')] },
      }).expect(200);
      expect(res.body).toEqual({ updated: 3 });
      for (const k of ['SYN-1', 'SYN-2', 'SYN-3']) {
        expect((await task(k)).body).toMatchObject({
          status: { name: 'In Progress' }, priority: 'HIGH', assignees: [{ userId: bob.id, name: 'Bob' }],
          labels: [expect.objectContaining({ name: 'feature' })],
        });
      }
      expect((await activityOf('SYN-1')).some((a) => a.field === 'status')).toBe(true);

      await http().patch(api('/tasks/bulk')).set(bob.auth).send({ taskIds: ids, changes: { archived: true } }).expect(200);
      expect((await http().get(api('/tasks')).set(bob.auth)).body.total).toBe(0);
    });

    it('is all-or-nothing and permission-checked', async () => {
      await mk(alice).expect(201);
      await mk(alice).expect(201);
      const ids = (await http().get(api('/tasks')).set(alice.auth)).body.items.map((t: { id: string }) => t.id);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: [...ids, 'ghost'], changes: { priority: 'LOW' } }).expect(404);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: ids, changes: { priority: 'LOW', labelIds: 1 } }).expect(400);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: ids, changes: { priority: 'LOW', addLabelIds: ['nope'] } }).expect(400);
      expect((await task('SYN-1')).body.priority).toBe('NONE'); // rolled back
      await http().patch(api('/tasks/bulk')).set(vic.auth).send({ taskIds: ids, changes: { priority: 'LOW' } }).expect(403);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: [], changes: {} }).expect(400);

      const other = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
      await mk(alice, {}, other.id).expect(201);
      const mixed = (await http().get(api('/tasks')).set(alice.auth)).body.items.map((t: { id: string }) => t.id);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: mixed, changes: { statusId: status('Done') } }).expect(400);
      await http().patch(api('/tasks/bulk')).set(alice.auth).send({ taskIds: mixed, changes: { priority: 'LOW' } }).expect(200);
    });
  });

  describe('duplicate, archive, delete', () => {
    it('duplicates a task without its comments, relations or progress', async () => {
      const src = (await mk(alice, {
        title: 'Original', type: 'BUG', priority: 'HIGH', estimate: 2, assigneeIds: [bob.id], labelIds: [label('bug')], statusId: status('Done'),
      }).expect(201)).body;
      const cl = (await http().post(api('/tasks/SYN-1/checklists')).set(alice.auth).send({ title: 'Steps' })).body;
      await http().post(api(`/tasks/SYN-1/checklists/${cl.id}/items`)).set(alice.auth).send({ text: 'one' });
      await http().patch(api(`/tasks/SYN-1/checklists/${cl.id}/items/${(await task('SYN-1')).body.checklists[0].items[0].id}`)).set(alice.auth).send({ done: true });
      await http().post(api('/tasks/SYN-1/comments')).set(alice.auth).send({ body: 'c' });

      const copy = (await http().post(api('/tasks/SYN-1/duplicate')).set(bob.auth).expect(201)).body;
      expect(copy).toMatchObject({
        key: 'SYN-2', title: 'Original', type: 'BUG', priority: 'HIGH', estimate: 2, reporterId: bob.id,
        status: { name: 'To Do' }, completedAt: null, commentCount: 0, relations: [],
      });
      expect(copy.id).not.toBe(src.id);
      expect(copy.assignees.map((a: { name: string }) => a.name)).toEqual(['Bob']);
      expect(copy.labels.map((l: { name: string }) => l.name)).toEqual(['bug']);
      expect(copy.checklists[0].items).toEqual([expect.objectContaining({ text: 'one', done: false })]);
      expect((await activityOf('SYN-2')).map((a) => a.type)).toEqual(expect.arrayContaining(['created', 'duplicated_from']));
      await http().post(api('/tasks/SYN-1/duplicate')).set(vic.auth).expect(403);
    });

    it('archives and restores', async () => {
      await mk(alice).expect(201);
      expect((await http().post(api('/tasks/SYN-1/archive')).set(bob.auth).expect(200)).body.archived).toBe(true);
      expect((await task('SYN-1')).body.archived).toBe(true); // still readable by key
      expect((await http().post(api('/tasks/SYN-1/restore')).set(bob.auth).expect(200)).body.archived).toBe(false);
      expect((await activityOf('SYN-1')).map((a) => a.type)).toEqual(expect.arrayContaining(['archived', 'restored']));
      await http().post(api('/tasks/SYN-1/archive')).set(vic.auth).expect(403);
    });

    it('lets only the reporter or a project admin delete', async () => {
      await mk(alice).expect(201);
      await mk(bob).expect(201);
      await http().delete(api('/tasks/SYN-1')).set(bob.auth).expect(403); // bob did not report it
      await http().delete(api('/tasks/SYN-2')).set(vic.auth).expect(403);
      await http().delete(api('/tasks/SYN-2')).set(bob.auth).expect(204); // own task
      await http().delete(api('/tasks/SYN-1')).set(admin.auth).expect(204); // workspace admin
      await task('SYN-1').expect(404);
      const next = await mk(alice).expect(201);
      expect(next.body.key).toBe('SYN-3'); // numbers are never reused
    });
  });

  describe('moving between projects', () => {
    it('moves a task with its subtasks, remapping keys, statuses and labels', async () => {
      const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS', template: 'KANBAN' }).expect(201)).body;
      await mk(alice, {}, ops.id).expect(201); // OPS-1 so numbering is visibly independent
      const parent = (await mk(alice, { title: 'Parent', type: 'STORY', statusId: status('In Review'), labelIds: [label('bug'), label('feature')], assigneeIds: [bob.id] }).expect(201)).body;
      await mk(alice, { title: 'Child', type: 'SUBTASK', parentId: parent.id, statusId: status('Done') }).expect(201);
      const fieldUrl = api(`/projects/${syn.id}/custom-fields`);
      const f = (await http().post(fieldUrl).set(alice.auth).send({ name: 'Points', type: 'NUMBER' })).body;
      await patch(parent.key, { customFields: { [f.id]: 3 } });

      const moved = (await http().post(api(`/tasks/${parent.key}/move`)).set(alice.auth).send({ projectId: ops.id }).expect(200)).body;
      expect(moved).toMatchObject({ projectKey: 'OPS', key: 'OPS-2', id: parent.id });
      // "In Review" does not exist in OPS, so it falls back to the first status of the same category
      expect(moved.status).toMatchObject({ name: 'In Progress', category: 'IN_PROGRESS' });
      expect(moved.labels.map((l: { name: string }) => l.name).sort()).toEqual(['bug', 'feature']); // same names exist in OPS
      expect(moved.assignees.map((a: { name: string }) => a.name)).toEqual(['Bob']);
      expect(moved.customFields).toEqual([]); // OPS has no matching field
      expect(moved.subtasks).toEqual([expect.objectContaining({ key: 'OPS-3', title: 'Child' })]);
      expect((await task('OPS-3')).body.status).toMatchObject({ name: 'Done', category: 'DONE' });
      expect((await task('OPS-3')).body.completedAt).toBeTruthy();
      await task('SYN-1').expect(404); // old key is gone
      expect((await activityOf('OPS-2')).find((a) => a.type === 'moved')).toMatchObject({ from: 'SYN-1', to: 'OPS-2' });

      // numbering continues independently in the source project
      expect((await mk(alice).expect(201)).body.key).toBe('SYN-3');
    });

    it('validates the move', async () => {
      const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
      const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
      const parent = (await mk(alice, { type: 'STORY' }).expect(201)).body;
      const sub = (await mk(alice, { type: 'SUBTASK', parentId: parent.id }).expect(201)).body;
      const mv = (ref: string, projectId: string, user = alice) => http().post(api(`/tasks/${ref}/move`)).set(user.auth).send({ projectId });
      await mv(sub.key, ops.id).expect(400); // sub-tasks move with their parent
      await mv(parent.key, syn.id).expect(400); // same project
      await mv(parent.key, 'missing').expect(404);
      await mv(parent.key, priv.id, bob).expect(404); // bob cannot see the target
      await mv(parent.key, ops.id, vic).expect(403);
      await http().post(api(`/projects/${ops.id}/archive`)).set(alice.auth).expect(200);
      await mv(parent.key, ops.id).expect(400); // archived target
    });
  });

  describe('workflow changes', () => {
    it('blocks deleting a status that has tasks unless they are moved', async () => {
      await mk(alice, { statusId: status('In Review') }).expect(201);
      const url = api(`/projects/${syn.id}/statuses/${status('In Review')}`);
      await http().delete(url).set(alice.auth).expect(409);
      await http().delete(`${url}?moveTo=${status('In Review')}`).set(alice.auth).expect(400);
      await http().delete(`${url}?moveTo=${status('Done')}`).set(alice.auth).expect(204);
      const t = (await task('SYN-1')).body;
      expect(t.status.name).toBe('Done');
      expect(t.completedAt).toBeTruthy();
      expect((await activityOf('SYN-1')).find((a) => a.field === 'status' && a.to === 'Done')).toMatchObject({ from: 'In Review' });
      // unused statuses delete without a target
      await http().delete(api(`/projects/${syn.id}/statuses/${status('In Progress')}`)).set(alice.auth).expect(204);
    });
  });
});
