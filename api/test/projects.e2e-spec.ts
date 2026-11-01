import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

describe('Teams & projects (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let owner: TestUser, admin: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
  let ws: string;
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1${path}`;
  const projectsUrl = (suffix = '') => api(`/workspaces/${ws}/projects${suffix}`);

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [owner, admin, member, viewer, outsider] = [
      await signUp(app, 'Owner'), await signUp(app, 'Admin'), await signUp(app, 'Member'),
      await signUp(app, 'Viewer'), await signUp(app, 'Outsider'),
    ];
    ws = (await http().post(api('/workspaces')).set(owner.auth).send({ name: 'Acme' }).expect(201)).body.id;
    for (const [user, role] of [[admin, 'ADMIN'], [member, 'MEMBER'], [viewer, 'VIEWER']] as const) {
      await http().post(api(`/workspaces/${ws}/invitations`)).set(owner.auth).send({ email: user.email, role }).expect(201);
      await http().post(api(`/invitations/${mail.inviteTokenFor(user.email)}/accept`)).set(user.auth).expect(201);
    }
  });

  const createProject = (user: TestUser, body: Record<string, unknown> = {}) =>
    http().post(projectsUrl()).set(user.auth).send({ name: 'Synqonix', key: 'SYN', ...body });

  describe('teams', () => {
    const teamsUrl = (suffix = '') => api(`/workspaces/${ws}/teams${suffix}`);

    it('lets admins manage teams and members read them', async () => {
      const team = await http().post(teamsUrl()).set(admin.auth).send({ name: 'Backend', description: 'API folks' }).expect(201);
      await http().post(teamsUrl()).set(member.auth).send({ name: 'Nope' }).expect(403);
      await http().post(teamsUrl()).set(admin.auth).send({ name: 'Backend' }).expect(409);

      const id = team.body.id;
      await http().post(teamsUrl(`/${id}/members`)).set(admin.auth).send({ userId: member.id }).expect(201);
      await http().post(teamsUrl(`/${id}/members`)).set(admin.auth).send({ userId: outsider.id }).expect(400);
      const got = await http().get(teamsUrl(`/${id}`)).set(viewer.auth).expect(200);
      expect(got.body.members).toEqual([expect.objectContaining({ userId: member.id, name: 'Member' })]);

      await http().patch(teamsUrl(`/${id}`)).set(admin.auth).send({ name: 'Platform' }).expect(200);
      await http().delete(teamsUrl(`/${id}/members/${member.id}`)).set(admin.auth).expect(204);
      await http().delete(teamsUrl(`/${id}`)).set(admin.auth).expect(204);
      await http().get(teamsUrl(`/${id}`)).set(admin.auth).expect(404);
    });

    it('removes a member from teams when they leave the workspace', async () => {
      const team = await http().post(teamsUrl()).set(admin.auth).send({ name: 'Web' });
      await http().post(teamsUrl(`/${team.body.id}/members`)).set(admin.auth).send({ userId: member.id }).expect(201);
      await http().delete(api(`/workspaces/${ws}/members/${member.id}`)).set(admin.auth).expect(204);
      const got = await http().get(teamsUrl(`/${team.body.id}`)).set(admin.auth);
      expect(got.body.members).toEqual([]);
    });
  });

  describe('projects', () => {
    it('creates a project from a template with statuses, labels and the creator as lead', async () => {
      const res = await createProject(member, { template: 'SCRUM' }).expect(201);
      expect(res.body).toMatchObject({ key: 'SYN', template: 'SCRUM', leadId: member.id, visibility: 'WORKSPACE', canManage: true });
      expect(res.body.statuses.map((s: { name: string }) => s.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
      expect(res.body.statuses.map((s: { position: number }) => s.position)).toEqual([0, 1, 2, 3]);
      expect(res.body.labels.map((l: { name: string }) => l.name).sort()).toEqual(['bug', 'chore', 'feature']);

      const bug = await createProject(admin, { key: 'BUG', name: 'Bugs', template: 'BUG_TRACKING' }).expect(201);
      expect(bug.body.statuses).toHaveLength(6);
    });

    it('validates keys and enforces uniqueness per workspace', async () => {
      await createProject(owner, { key: 'syn' }).expect(201); // normalised to upper case
      await createProject(owner, { key: 'SYN' }).expect(409);
      await createProject(owner, { key: '1AB' }).expect(400);
      await createProject(owner, { key: 'A' }).expect(400);
      await createProject(owner, { key: 'TOOLONGKEY12' }).expect(400);

      // same key is fine in another workspace
      const other = await http().post(api('/workspaces')).set(outsider.auth).send({ name: 'Other' });
      await http().post(api(`/workspaces/${other.body.id}/projects`)).set(outsider.auth).send({ name: 'x', key: 'SYN' }).expect(201);
    });

    it('lets viewers read but not create', async () => {
      await createProject(owner).expect(201);
      await createProject(viewer, { key: 'VWR' }).expect(403);
      const list = await http().get(projectsUrl()).set(viewer.auth).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].canManage).toBe(false);
    });

    it('hides private projects from non-members and reveals them when added', async () => {
      const p = (await createProject(owner, { visibility: 'PRIVATE' }).expect(201)).body;
      expect((await http().get(projectsUrl()).set(member.auth)).body).toEqual([]);
      await http().get(projectsUrl(`/${p.id}`)).set(member.auth).expect(404);
      expect((await http().get(projectsUrl()).set(admin.auth)).body).toHaveLength(1); // workspace admins see all

      await http().put(projectsUrl(`/${p.id}/members`)).set(owner.auth).send({ userId: member.id, role: 'MEMBER' }).expect(200);
      await http().get(projectsUrl(`/${p.id}`)).set(member.auth).expect(200);
      expect((await http().get(projectsUrl()).set(member.auth)).body).toHaveLength(1);
      await http().put(projectsUrl(`/${p.id}/members`)).set(owner.auth).send({ userId: outsider.id, role: 'MEMBER' }).expect(400);
    });

    it("scopes projects to their workspace", async () => {
      const p = (await createProject(owner).expect(201)).body;
      const other = (await http().post(api('/workspaces')).set(outsider.auth).send({ name: 'Other' })).body.id;
      await http().get(api(`/workspaces/${other}/projects/${p.id}`)).set(outsider.auth).expect(404);
      await http().get(projectsUrl(`/${p.id}`)).set(outsider.auth).expect(404);
    });

    it('lets the lead or a project admin manage a project, but not plain members', async () => {
      const p = (await createProject(member).expect(201)).body; // member is lead => can manage
      await http().patch(projectsUrl(`/${p.id}`)).set(member.auth).send({ name: 'Renamed', description: 'hi' }).expect(200);
      await http().patch(projectsUrl(`/${p.id}`)).set(viewer.auth).send({ name: 'x' }).expect(403);

      const q = (await createProject(admin, { key: 'ADM' }).expect(201)).body; // member has no role here
      await http().patch(projectsUrl(`/${q.id}`)).set(member.auth).send({ name: 'x' }).expect(403);
      await http().put(projectsUrl(`/${q.id}/members`)).set(admin.auth).send({ userId: member.id, role: 'ADMIN' }).expect(200);
      await http().patch(projectsUrl(`/${q.id}`)).set(member.auth).send({ name: 'Allowed now' }).expect(200);
      // project-level admins still cannot delete
      await http().delete(projectsUrl(`/${q.id}`)).set(member.auth).expect(403);
    });

    it('changes the lead and refuses to remove the current lead', async () => {
      const p = (await createProject(owner, { visibility: 'PRIVATE' }).expect(201)).body;
      await http().delete(projectsUrl(`/${p.id}/members/${owner.id}`)).set(owner.auth).expect(400);
      await http().patch(projectsUrl(`/${p.id}`)).set(owner.auth).send({ leadId: outsider.id }).expect(400);
      await http().patch(projectsUrl(`/${p.id}`)).set(owner.auth).send({ leadId: member.id }).expect(200);
      await http().get(projectsUrl(`/${p.id}`)).set(member.auth).expect(200); // lead can see private project
      await http().patch(projectsUrl(`/${p.id}`)).set(owner.auth).send({ leadId: null }).expect(200);
    });

    it('archives, restores and deletes', async () => {
      const p = (await createProject(owner).expect(201)).body;
      await http().post(projectsUrl(`/${p.id}/archive`)).set(owner.auth).expect(200)
        .then((r) => expect(r.body.archived).toBe(true));
      expect((await http().get(projectsUrl()).set(owner.auth)).body).toEqual([]);
      expect((await http().get(projectsUrl('?includeArchived=true')).set(owner.auth)).body).toHaveLength(1);
      await http().post(projectsUrl(`/${p.id}/restore`)).set(owner.auth).expect(200);
      expect((await http().get(projectsUrl()).set(owner.auth)).body).toHaveLength(1);
      await http().delete(projectsUrl(`/${p.id}`)).set(admin.auth).expect(204);
      await http().get(projectsUrl(`/${p.id}`)).set(owner.auth).expect(404);
    });

    it('manages workflow statuses and keeps a valid workflow', async () => {
      const p = (await createProject(owner, { template: 'SCRUM' }).expect(201)).body;
      const base = projectsUrl(`/${p.id}/statuses`);
      const [todo, , , done] = p.statuses;

      const blocked = await http().post(base).set(owner.auth).send({ name: 'Blocked', category: 'IN_PROGRESS', color: '#ef4444' }).expect(201);
      expect(blocked.body.position).toBe(4);
      await http().post(base).set(owner.auth).send({ name: 'Blocked', category: 'TODO' }).expect(409);
      await http().post(base).set(member.auth).send({ name: 'Nope', category: 'TODO' }).expect(403);

      await http().patch(`${base}/${blocked.body.id}`).set(owner.auth).send({ name: 'On Hold' }).expect(200);
      // cannot remove or re-categorise the only TODO / DONE status
      await http().delete(`${base}/${todo.id}`).set(owner.auth).expect(400);
      await http().patch(`${base}/${done.id}`).set(owner.auth).send({ category: 'IN_PROGRESS' }).expect(400);

      const ids = [...p.statuses.map((s: { id: string }) => s.id), blocked.body.id].reverse();
      const reordered = await http().put(`${base}/order`).set(owner.auth).send({ ids }).expect(200);
      expect(reordered.body.map((s: { id: string }) => s.id)).toEqual(ids);
      await http().put(`${base}/order`).set(owner.auth).send({ ids: ids.slice(1) }).expect(400);

      await http().delete(`${base}/${blocked.body.id}`).set(owner.auth).expect(204);
      expect((await http().get(base).set(viewer.auth).expect(200)).body).toHaveLength(4);
    });

    it('manages labels', async () => {
      const p = (await createProject(owner).expect(201)).body;
      const base = projectsUrl(`/${p.id}/labels`);
      const label = await http().post(base).set(owner.auth).send({ name: 'urgent', color: '#ff0000' }).expect(201);
      await http().post(base).set(owner.auth).send({ name: 'urgent' }).expect(409);
      await http().post(base).set(owner.auth).send({ name: 'x', color: 'red' }).expect(400);
      await http().patch(`${base}/${label.body.id}`).set(owner.auth).send({ name: 'critical' }).expect(200);
      await http().delete(`${base}/${label.body.id}`).set(viewer.auth).expect(403);
      await http().delete(`${base}/${label.body.id}`).set(owner.auth).expect(204);
      expect((await http().get(base).set(viewer.auth)).body).toEqual([]);
    });
  });
});
