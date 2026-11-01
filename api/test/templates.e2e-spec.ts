import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RecurringService } from '../src/templates/recurring.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

describe('Templates and recurring tasks (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let recurring: RecurringService;
  let alice: TestUser, bob: TestUser, viv: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  let labels: { id: string; name: string }[];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;
  const pj = (p: string) => api(`/projects/${project.id}${p}`);

  beforeAll(async () => {
    ({ app, mail, prisma } = await createTestApp());
    recurring = app.get(RecurringService);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [alice, bob, viv, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
    labels = (await http().get(pj('')).set(alice.auth).expect(200)).body.labels;
  });

  describe('task templates', () => {
    const body = () => ({
      name: 'Bug report', title: 'Bug: ', description: '## Steps\n\n## Expected', type: 'BUG', priority: 'HIGH', labelIds: [labels.find((l) => l.name === 'bug')!.id],
      checklists: [{ title: 'Triage', items: ['Reproduce', 'Find owner'] }, { title: 'Fix', items: ['Patch', 'Test', 'Release'] }], estimate: 2, timeEstimateMinutes: 120,
    });

    it('lets project admins manage templates and everyone who can see the project list them', async () => {
      const t = (await http().post(pj('/templates')).set(alice.auth).send(body()).expect(201)).body;
      expect(t).toMatchObject({ name: 'Bug report', type: 'BUG', priority: 'HIGH', estimate: 2, timeEstimateMinutes: 120 });
      expect(t.checklists).toHaveLength(2);
      expect((await http().get(pj('/templates')).set(viv.auth).expect(200)).body).toHaveLength(1);
      await http().post(pj('/templates')).set(bob.auth).send(body()).expect(403);
      await http().patch(pj(`/templates/${t.id}`)).set(bob.auth).send({ title: 'x' }).expect(403);
      await http().delete(pj(`/templates/${t.id}`)).set(bob.auth).expect(403);
      await http().post(pj('/templates')).set(alice.auth).send(body()).expect(409);
      await http().post(pj('/templates')).set(alice.auth).send({ ...body(), name: 'Other', labelIds: ['nope'] }).expect(400);
      const upd = (await http().patch(pj(`/templates/${t.id}`)).set(alice.auth).send({ name: 'Defect', description: null, estimate: null, checklists: [] }).expect(200)).body;
      expect(upd).toMatchObject({ name: 'Defect', description: null, estimate: null, checklists: [] });
      await http().delete(pj(`/templates/${t.id}`)).set(alice.auth).expect(204);
      await http().delete(pj(`/templates/${t.id}`)).set(alice.auth).expect(404);
      await http().get(pj('/templates')).set(eve.auth).expect(404);
    });

    it('creates tasks from a template with its fields, labels and checklists', async () => {
      const t = (await http().post(pj('/templates')).set(alice.auth).send(body()).expect(201)).body;
      const created = (await http().post(pj(`/templates/${t.id}/create-task`)).set(bob.auth).send({ title: 'Bug: login fails', assigneeIds: [bob.id] }).expect(201)).body;
      expect(created).toMatchObject({ title: 'Bug: login fails', type: 'BUG', priority: 'HIGH', estimate: 2, timeEstimateMinutes: 120, description: '## Steps\n\n## Expected' });
      expect(created.labels.map((l: { name: string }) => l.name)).toEqual(['bug']);
      expect(created.assignees.map((a: { name: string }) => a.name)).toEqual(['Bob']);
      expect(created.checklists.map((c: { title: string; items: { text: string; done: boolean }[] }) => [c.title, c.items.map((i) => i.text), c.items.some((i) => i.done)])).toEqual([
        ['Triage', ['Reproduce', 'Find owner'], false], ['Fix', ['Patch', 'Test', 'Release'], false],
      ]);
      await http().post(pj(`/templates/${t.id}/create-task`)).set(viv.auth).send({}).expect(403);
      await http().post(pj('/templates/nope/create-task')).set(alice.auth).send({}).expect(404);
      // a label deleted later is simply left out
      await http().delete(pj(`/labels/${t.labelIds[0]}`)).set(alice.auth).expect(204);
      const again = (await http().post(pj(`/templates/${t.id}/create-task`)).set(alice.auth).send({}).expect(201)).body;
      expect(again).toMatchObject({ title: 'Bug:', labels: [] });
    });

    it('saves an existing task as a template', async () => {
      const task = (await http().post(pj('/tasks')).set(alice.auth).send({ title: 'Release checklist', description: 'Do the thing', priority: 'MEDIUM', estimate: 3 }).expect(201)).body;
      const list = (await http().post(api(`/tasks/${task.key}/checklists`)).set(alice.auth).send({ title: 'Steps' }).expect(201)).body;
      await http().post(api(`/tasks/${task.key}/checklists/${list.id}/items`)).set(alice.auth).send({ text: 'Tag' }).expect(201);
      const saved = (await http().post(pj(`/templates/from-task/${task.key}`)).set(alice.auth).send({ name: 'Release' }).expect(201)).body;
      expect(saved).toMatchObject({ name: 'Release', title: 'Release checklist', description: 'Do the thing', priority: 'MEDIUM', estimate: 3, checklists: [{ title: 'Steps', items: ['Tag'] }] });
      await http().post(pj(`/templates/from-task/${task.key}`)).set(bob.auth).send({ name: 'Mine' }).expect(403);
      await http().post(pj('/templates/from-task/NOPE-1')).set(alice.auth).send({ name: 'x' }).expect(404);
    });
  });

  describe('recurring tasks', () => {
    const rule = (over: Record<string, unknown> = {}) => ({ name: 'Weekly triage', title: 'Triage bugs {date}', frequency: 'WEEKLY', interval: 1, startsAt: '2030-01-07T09:00:00Z', ...over });
    const create = async (over: Record<string, unknown> = {}) => (await http().post(pj('/recurring')).set(alice.auth).send(rule(over)).expect(201)).body as { id: string; nextRunAt: string; active: boolean };
    const tasks = async () => (await http().get(api(`/tasks?projectId=${project.id}`)).set(alice.auth).expect(200)).body.items as { title: string; assignees: { name: string }[]; priority: string }[];

    it('validates rules and lets only project admins change them', async () => {
      const r = await create({ assigneeIds: [bob.id], priority: 'LOW' });
      expect(r).toMatchObject({ name: 'Weekly triage', frequency: 'WEEKLY', interval: 1, active: true, nextRunAt: '2030-01-07T09:00:00.000Z', lastRunAt: null, lastTaskKey: null });
      expect((await http().get(pj('/recurring')).set(viv.auth).expect(200)).body).toHaveLength(1);
      await http().post(pj('/recurring')).set(bob.auth).send(rule()).expect(403);
      await http().patch(pj(`/recurring/${r.id}`)).set(bob.auth).send({ active: false }).expect(403);
      await http().delete(pj(`/recurring/${r.id}`)).set(bob.auth).expect(403);
      for (const bad of [{ interval: 0 }, { interval: 100 }, { frequency: 'HOURLY' }, { startsAt: 'soon' }, { assigneeIds: [eve.id] }, { labelIds: ['nope'] }, { title: '' }, { startsAt: '2099-01-01T00:00:00Z' }]) {
        await http().post(pj('/recurring')).set(alice.auth).send(rule(bad)).expect(400);
      }
      const off = (await http().patch(pj(`/recurring/${r.id}`)).set(alice.auth).send({ active: false, title: 'Renamed' }).expect(200)).body;
      expect(off).toMatchObject({ active: false, title: 'Renamed' });
      await http().delete(pj(`/recurring/${r.id}`)).set(alice.auth).expect(204);
      await http().patch(pj(`/recurring/${r.id}`)).set(alice.auth).send({ active: true }).expect(404);
    });

    it('starts from the next slot when the start date is in the past', async () => {
      const r = await create({ frequency: 'DAILY', startsAt: '2020-01-01T09:00:00Z' });
      const next = new Date(r.nextRunAt).getTime();
      expect(next).toBeGreaterThan(Date.now());
      expect(next - Date.now()).toBeLessThanOrEqual(86_400_000);
      expect(new Date(r.nextRunAt).getUTCHours()).toBe(9);
    });

    it('creates a task when due, once, and schedules the next run', async () => {
      const r = await create({ assigneeIds: [bob.id], priority: 'LOW', labelIds: [labels[0].id] });
      const due = new Date('2030-01-07T09:05:00Z');
      expect(await recurring.runDue(new Date('2030-01-07T08:00:00Z'))).toBe(0);
      expect(await recurring.runDue(due)).toBe(1);
      expect(await recurring.runDue(due)).toBe(0); // already claimed
      const made = (await tasks()).filter((t) => t.title.startsWith('Triage'));
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ title: 'Triage bugs 2030-01-07', priority: 'LOW', assignees: [{ name: 'Bob' }] });
      const after = (await http().get(pj('/recurring')).set(alice.auth).expect(200)).body[0];
      expect(after).toMatchObject({ id: r.id, nextRunAt: '2030-01-14T09:00:00.000Z', lastRunAt: due.toISOString(), lastTaskKey: 'SYN-1' });
      expect(await recurring.runDue(new Date('2030-01-14T09:00:00Z'))).toBe(1);
      expect((await tasks()).map((t) => t.title).sort()).toEqual(['Triage bugs 2030-01-07', 'Triage bugs 2030-01-14']);
    });

    it('creates one task after missed runs, not a backlog, and respects pausing', async () => {
      const r = await create({ frequency: 'DAILY', title: 'Standup notes' });
      expect(await recurring.runDue(new Date('2030-03-01T00:00:00Z'))).toBe(1); // weeks late
      expect((await tasks())).toHaveLength(1);
      expect(new Date((await http().get(pj('/recurring')).set(alice.auth).expect(200)).body[0].nextRunAt).toISOString()).toBe('2030-03-01T09:00:00.000Z');
      await http().patch(pj(`/recurring/${r.id}`)).set(alice.auth).send({ active: false }).expect(200);
      expect(await recurring.runDue(new Date('2030-04-01T00:00:00Z'))).toBe(0);
      const resumed = (await http().patch(pj(`/recurring/${r.id}`)).set(alice.auth).send({ active: true }).expect(200)).body;
      expect(new Date(resumed.nextRunAt).getTime()).toBeGreaterThan(Date.now()); // resumes from the next slot, not from the pause
    });

    it('repeats monthly without drifting and deactivates when its owner or project is gone', async () => {
      await create({ name: 'Monthly', title: 'Rotate keys', frequency: 'MONTHLY', startsAt: '2030-01-31T10:00:00Z' });
      await recurring.runDue(new Date('2030-01-31T10:01:00Z'));
      expect((await http().get(pj('/recurring')).set(alice.auth).expect(200)).body[0].nextRunAt).toBe('2030-02-28T10:00:00.000Z');
      await recurring.runDue(new Date('2030-02-28T10:01:00Z'));
      expect((await http().get(pj('/recurring')).set(alice.auth).expect(200)).body[0].nextRunAt).toBe('2030-03-31T10:00:00.000Z');

      const bobsRule = (await http().post(pj('/recurring')).set(alice.auth).send(rule({ name: 'Owned by Bob' })).expect(201)).body;
      await prisma.recurringTask.update({ where: { id: bobsRule.id }, data: { createdById: bob.id } });
      await http().delete(api(`/members/${bob.id}`)).set(alice.auth).expect(204);
      await recurring.runDue(new Date('2031-01-07T09:05:00Z'));
      expect((await prisma.recurringTask.findUniqueOrThrow({ where: { id: bobsRule.id } })).active).toBe(false);
      expect((await tasks()).filter((t) => t.title.startsWith('Triage'))).toHaveLength(0);

      await create({ name: 'Archived soon' });
      await http().post(pj('/archive')).set(alice.auth).expect(200);
      await recurring.runDue(new Date('2031-06-01T00:00:00Z'));
      expect(await prisma.recurringTask.count({ where: { active: true, projectId: project.id } })).toBe(0);
    });

    it('drops assignees who left the workspace instead of failing', async () => {
      await create({ assigneeIds: [bob.id] });
      await http().delete(api(`/members/${bob.id}`)).set(alice.auth).expect(204);
      expect(await recurring.runDue(new Date('2030-01-07T09:05:00Z'))).toBe(1);
      expect((await tasks())[0].assignees).toEqual([]);
    });
  });
});
