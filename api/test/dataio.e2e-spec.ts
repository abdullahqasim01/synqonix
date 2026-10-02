import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/dataio/csv.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

interface Result {
  dryRun: boolean; total: number; created: number; skipped: number; failed: number; warnings: number; truncated: boolean;
  columns: { column: string; field: string }[];
  rows: { row: number; status: string; key: string | null; messages: { level: string; text: string }[] }[];
}

describe('Import and export (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  let src: { id: string; statuses: { id: string; name: string }[] };
  let dst: { id: string; statuses: { id: string; name: string }[] };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const sid = (p: typeof src, n: string) => p.statuses.find((s) => s.name === n)!.id;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, viv, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER']]);
    src = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Source', key: 'SRC', template: 'SCRUM' }).expect(201)).body;
    dst = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Target', key: 'DST', template: 'SCRUM' }).expect(201)).body;
  });

  const mk = async (body: Record<string, unknown>, pid = src.id) => (await http().post(api(`/projects/${pid}/tasks`)).set(alice.auth).send(body).expect(201)).body as { id: string; key: string };
  const upload = (pid: string, content: string, opts: { name?: string; fields?: Record<string, string>; user?: TestUser } = {}) => {
    let req = http().post(api(`/projects/${pid}/import`)).set((opts.user ?? alice).auth).attach('file', Buffer.from(content), opts.name ?? 'tasks.csv');
    for (const [k, v] of Object.entries(opts.fields ?? {})) req = req.field(k, v);
    return req;
  };
  const run = async (pid: string, content: string, opts: Parameters<typeof upload>[2] = {}) => (await upload(pid, content, opts).expect(200)).body as Result;
  const tasksOf = async (pid: string) => (await http().get(api(`/tasks?projectId=${pid}&limit=200`)).set(alice.auth).expect(200)).body.items as {
    key: string; title: string; status: { name: string }; priority: string; type: string; assignees: { name: string }[]; labels: { name: string }[]; estimate: number | null; dueDate: string | null; parentId?: string | null; description?: string;
  }[];

  describe('export', () => {
    it('writes a CSV with every field and defuses formulas', async () => {
      await mk({ title: '=HYPERLINK("http://evil")', description: 'multi\nline, with comma', assigneeIds: [bob.id], estimate: 3, priority: 'HIGH', dueDate: '2026-05-05T00:00:00.000Z', timeEstimateMinutes: 90 });
      await mk({ title: 'Plain', statusId: sid(src, 'Done') });
      const res = await http().get(api(`/projects/${src.id}/export`)).set(viv.auth).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe('attachment; filename="src-tasks.csv"');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const rows = parseCsv(res.text);
      expect(rows[0]).toEqual(expect.arrayContaining(['Key', 'Title', 'Status', 'Assignees', 'Time estimate minutes']));
      const col = (name: string) => rows[0].indexOf(name);
      expect(rows).toHaveLength(3);
      expect(rows[1][col('Key')]).toBe('SRC-1');
      expect(rows[1][col('Title')]).toBe(`'=HYPERLINK("http://evil")`); // apostrophe keeps spreadsheets from running it
      expect(rows[1][col('Description')]).toBe('multi\nline, with comma');
      expect(rows[1][col('Assignees')]).toBe('Bob');
      expect(rows[1][col('Estimate')]).toBe('3');
      expect(rows[1][col('Priority')]).toBe('HIGH');
      expect(rows[1][col('Time estimate minutes')]).toBe('90');
      expect(rows[2][col('Status')]).toBe('Done');
      for (const row of rows.slice(1)) expect(row[col('Created')]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('writes JSON, skips archived tasks, and respects visibility', async () => {
      const a = await mk({ title: 'Keep' });
      const b = await mk({ title: 'Archive me' });
      await http().post(api(`/tasks/${b.key}/archive`)).set(alice.auth).expect(200);
      const res = await http().get(api(`/projects/${src.id}/export?format=json`)).set(bob.auth).expect(200);
      expect(res.headers['content-disposition']).toContain('src-tasks.json');
      expect(JSON.parse(res.text)).toMatchObject({ project: { key: 'SRC' }, tasks: [{ key: a.key, title: 'Keep', status: 'To Do' }] });
      await http().get(api(`/projects/${src.id}/export?format=xml`)).set(bob.auth).expect(400);
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await http().get(api(`/projects/${hidden.id}/export`)).set(bob.auth).expect(404);
      await http().get(api(`/projects/${src.id}/export`)).set(eve.auth).expect(404);
    });
  });

  describe('round trip', () => {
    it('re-imports an export into another project, keeping fields and parents, and is idempotent', async () => {
      const epic = await mk({ title: 'Epic one', type: 'EPIC' });
      const story = await mk({ title: '=Danger, "quoted"', type: 'STORY', parentId: epic.id, assigneeIds: [bob.id], estimate: 5, priority: 'URGENT', statusId: sid(src, 'In Progress') });
      await mk({ title: 'Third', description: 'Some\ntext', dueDate: '2026-06-01T00:00:00.000Z', statusId: sid(src, 'Done') });
      const labels = (await http().get(api(`/projects/${src.id}`)).set(alice.auth).expect(200)).body.labels as { id: string; name: string }[];
      await http().patch(api(`/tasks/${story.key}`)).set(alice.auth).send({ labelIds: [labels.find((l) => l.name === 'bug')!.id] }).expect(200);
      const csv = (await http().get(api(`/projects/${src.id}/export`)).set(alice.auth).expect(200)).text;

      const first = await run(dst.id, csv, { fields: { source: 'synqonix' } });
      expect(first).toMatchObject({ total: 3, created: 3, skipped: 0, failed: 0, dryRun: false });
      const got = await tasksOf(dst.id);
      expect(got.map((t) => t.title)).toEqual(['Epic one', '=Danger, "quoted"', 'Third']);
      const s = got.find((t) => t.title.startsWith('=Danger'))!;
      expect(s).toMatchObject({ type: 'STORY', priority: 'URGENT', estimate: 5, status: { name: 'In Progress' }, assignees: [{ name: 'Bob' }], labels: [{ name: 'bug' }] });
      expect(got.find((t) => t.title === 'Third')).toMatchObject({ status: { name: 'Done' }, dueDate: '2026-06-01T00:00:00.000Z' });
      const detail = (await http().get(api(`/tasks/${s.key}`)).set(alice.auth).expect(200)).body;
      expect(detail.parent.title).toBe('Epic one');

      const again = await run(dst.id, csv, { fields: { source: 'synqonix' } });
      expect(again).toMatchObject({ created: 0, skipped: 3, failed: 0 });
      expect((await tasksOf(dst.id)).length).toBe(3);
      // a different source name is a different import
      expect((await run(dst.id, csv, { fields: { source: 'csv' } })).created).toBe(3);
    });

    it('imports the JSON export too', async () => {
      await mk({ title: 'From JSON', priority: 'LOW', assigneeIds: [bob.id] });
      const json = (await http().get(api(`/projects/${src.id}/export?format=json`)).set(alice.auth).expect(200)).text;
      const r = await run(dst.id, json, { name: 'tasks.json', fields: { source: 'synqonix' } });
      expect(r).toMatchObject({ created: 1, failed: 0 });
      expect((await tasksOf(dst.id))[0]).toMatchObject({ title: 'From JSON', priority: 'LOW', assignees: [{ name: 'Bob' }] });
      await upload(dst.id, '{ nope', { name: 'x.json' }).expect(400);
      await upload(dst.id, '{"hello":1}', { name: 'x.json' }).expect(400);
    });
  });

  describe('Jira and GitHub files', () => {
    const jira = [
      'Summary,Issue key,Issue Type,Status,Priority,Assignee,Labels,Labels,Custom field (Story Points),Due Date,Epic Link,Description',
      'Checkout flow,JRA-1,Epic,In Progress,High,Bob,payments,web,,,,"Everything about checkout"',
      'Card form,JRA-2,Story,Closed,Highest,Bob,payments,,5,21/Mar/24 9:30 AM,JRA-1,',
      'Spike,JRA-3,Spike,Waiting for info,Weird,Nobody Known,,,,,,',
      ',JRA-4,Task,To Do,,,,,,,,',
      'Bad date,JRA-5,Task,To Do,,,,,,someday,,',
      'Bad points,JRA-6,Task,To Do,,,,,lots,,,',
      'Orphan sub,JRA-7,Sub-task,To Do,,,,,,,JRA-404,',
      'Duplicate id,JRA-2,Task,To Do,,,,,,,,',
    ].join('\n');

    it('maps columns, statuses and values, and reports each problem on its row', async () => {
      const r = await run(dst.id, jira, { fields: { source: 'jira' } });
      expect(r).toMatchObject({ total: 8, created: 4, failed: 4, skipped: 0 });
      expect(r.columns.filter((c) => c.field === 'labels')).toHaveLength(2);
      const row = (n: number) => r.rows.find((x) => x.row === n);
      expect(row(2)).toBeUndefined(); // clean row, nothing to report
      expect(row(4)!.messages.map((x) => x.text)).toEqual(expect.arrayContaining([
        'Unknown type "Spike"; imported as a task', 'Unknown priority "Weird"; left empty', 'No workspace member matches "Nobody Known"',
        expect.stringContaining('Status "Waiting for info" does not exist here'),
      ]));
      expect(row(5)).toMatchObject({ status: 'error', messages: [{ level: 'error', text: 'Title is empty' }] });
      expect(row(6)).toMatchObject({ status: 'error', messages: [{ text: 'Due date "someday" is not a date' }] });
      expect(row(7)).toMatchObject({ status: 'error', messages: [{ text: 'Estimate "lots" is not a number' }] });
      expect(row(8)).toMatchObject({ status: 'created' });
      expect(row(8)!.messages.map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringContaining('Parent "JRA-404" not found'), 'A sub-task needs a parent; imported as a task']));
      expect(row(9)).toMatchObject({ status: 'error', messages: [{ text: 'The same id appears more than once in this file' }] });

      const got = await tasksOf(dst.id);
      expect(got.map((t) => t.title)).toEqual(['Checkout flow', 'Card form', 'Spike', 'Orphan sub']);
      const [epic, card, spike] = got;
      expect(epic).toMatchObject({ type: 'EPIC', status: { name: 'In Progress' }, priority: 'HIGH', assignees: [{ name: 'Bob' }] });
      expect(epic.labels.map((l) => l.name).sort()).toEqual(['payments', 'web']);
      expect(card).toMatchObject({ type: 'STORY', status: { name: 'Done' }, priority: 'URGENT', estimate: 5, dueDate: '2024-03-21T09:30:00.000Z' });
      expect(spike).toMatchObject({ type: 'TASK', status: { name: 'To Do' }, priority: 'NONE' });
      const cardDetail = (await http().get(api(`/tasks/${card.key}`)).set(alice.auth).expect(200)).body;
      expect(cardDetail.parent.title).toBe('Checkout flow');
    });

    it('can check a file without importing, and importing twice adds nothing', async () => {
      const dry = await run(dst.id, jira, { fields: { source: 'jira', dryRun: 'true' } });
      expect(dry).toMatchObject({ dryRun: true, created: 4, failed: 4 });
      expect(await prisma.task.count({ where: { projectId: dst.id } })).toBe(0);
      expect(await prisma.label.count({ where: { projectId: dst.id, name: 'payments' } })).toBe(0);
      await run(dst.id, jira, { fields: { source: 'jira' } });
      const again = await run(dst.id, jira, { fields: { source: 'jira' } });
      expect(again).toMatchObject({ created: 0, skipped: 4, failed: 4 });
      expect(again.rows.filter((r) => r.status === 'skipped').map((r) => r.key)).toEqual(['DST-1', 'DST-2', 'DST-3', 'DST-4']);
      expect(await prisma.task.count({ where: { projectId: dst.id } })).toBe(4);
    });

    it('creates parents that come later in the file first, and does not notify anyone', async () => {
      const csv = 'Key,Title,Type,Parent,Assignee\nB,Child story,Story,A,Bob\nA,Parent epic,Epic,,Bob\n';
      const r = await run(dst.id, csv);
      expect(r).toMatchObject({ created: 2, failed: 0 });
      const child = (await tasksOf(dst.id)).find((t) => t.title === 'Child story')!;
      expect((await http().get(api(`/tasks/${child.key}`)).set(alice.auth).expect(200)).body.parent.title).toBe('Parent epic');
      await new Promise((res) => setTimeout(res, 400));
      expect(await prisma.notification.count({ where: { userId: bob.id } })).toBe(0); // imports are silent
    });

    it('reads GitHub issue exports (open and closed)', async () => {
      const csv = 'number,title,body,state,labels,assignees\n12,Crash on save,Steps...,open,"bug,ui",bob\n13,Old issue,,closed,bug,\n';
      const r = await run(dst.id, csv, { fields: { source: 'github' } });
      expect(r).toMatchObject({ created: 2, failed: 0 });
      const got = await tasksOf(dst.id);
      expect(got[0]).toMatchObject({ title: 'Crash on save', status: { name: 'To Do' }, assignees: [{ name: 'Bob' }] });
      expect(got[0].labels.map((l) => l.name).sort()).toEqual(['bug', 'ui']);
      expect(got[1].status.name).toBe('Done');
      expect(r.rows.some((x) => x.messages.some((m) => m.text.includes('Status')))).toBe(false); // open/closed are understood
    });
  });

  describe('other inputs and limits', () => {
    it('imports files without an id column once, by content', async () => {
      const csv = 'Title,Description\nSame,one\nOther,two\n';
      expect(await run(dst.id, csv)).toMatchObject({ created: 2 });
      expect(await run(dst.id, csv)).toMatchObject({ created: 0, skipped: 2 });
      expect(await run(dst.id, 'Title,Description\nSame,changed\n')).toMatchObject({ created: 1 });
    });

    it('accepts explicit column mapping and semicolon files', async () => {
      const r = await run(dst.id, 'Aufgabe;Notiz\nEins;hallo\n', { fields: { mapping: JSON.stringify({ Aufgabe: 'title', Notiz: 'description' }) } });
      expect(r).toMatchObject({ created: 1 });
      expect((await tasksOf(dst.id))[0]).toMatchObject({ title: 'Eins' });
      await upload(dst.id, 'Aufgabe\nEins\n').expect(400); // no title column and no mapping
      await upload(dst.id, 'Title\nx\n', { fields: { mapping: '{bad' } }).expect(400);
    });

    it('rejects empty files, missing files, huge files and unknown sources', async () => {
      await upload(dst.id, '').expect(400);
      await upload(dst.id, 'Title\n').expect(400);
      await http().post(api(`/projects/${dst.id}/import`)).set(alice.auth).expect(400);
      await upload(dst.id, 'Title\nx\n', { fields: { source: 'trello' } }).expect(400);
      await upload(dst.id, `Title\n${'x'.repeat(6 * 1024 * 1024)}\n`).expect(413);
      await upload(dst.id, `Title\n${Array.from({ length: 5001 }, (_, i) => `t${i}`).join('\n')}\n`).expect(400);
    });

    it('shortens very long titles with a warning and needs write access', async () => {
      const r = await run(dst.id, `Title\n${'a'.repeat(400)}\n`);
      expect(r.created).toBe(1);
      expect(r.rows[0].messages[0].text).toContain('shortened');
      expect((await tasksOf(dst.id))[0].title).toHaveLength(300);
      await upload(dst.id, 'Title\nx\n', { user: viv }).expect(403);
      await upload(dst.id, 'Title\nx\n', { user: eve }).expect(404);
      await http().post(api(`/projects/${dst.id}/archive`)).set(alice.auth).expect(200);
      await upload(dst.id, 'Title\nx\n').expect(400);
    });
  });
});
