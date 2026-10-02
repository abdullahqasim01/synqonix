import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeGithubClient, type FakeMailService, type TestUser } from './helpers.js';

const SECRET = 'test-webhook-secret';
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/github/${name}.json`, import.meta.url)), 'utf8'));

describe('GitHub integration (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let github: FakeGithubClient;
  let alice: TestUser, bob: TestUser, viv: TestUser, carol: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  let link: { id: string; installationId: string };
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => ({ app, mail, prisma, github } = await createTestApp()));
  afterAll(() => app.close());

  /** Sends a webhook the way GitHub does: signed JSON with delivery and event headers. */
  const deliver = (event: string, body: string | Record<string, unknown>, opts: { id?: string; secret?: string; signature?: string } = {}) => {
    const raw = typeof body === 'string' ? (JSON.stringify(fixture(body))) : JSON.stringify(body);
    const sig = opts.signature ?? `sha256=${createHmac('sha256', opts.secret ?? SECRET).update(raw).digest('hex')}`;
    return http().post('/api/v1/github/webhooks')
      .set('Content-Type', 'application/json').set('X-GitHub-Event', event).set('X-GitHub-Delivery', opts.id ?? randomUUID()).set('X-Hub-Signature-256', sig)
      .send(raw);
  };
  const ok = async (event: string, body: string | Record<string, unknown>, id?: string) => {
    const res = await deliver(event, body, { id });
    expect(res.status).toBe(202);
    return res.body as { status: string };
  };

  const task = async (key: string) => (await http().get(api(`/tasks/${key}`)).set(alice.auth).expect(200)).body;
  const gh = async (key: string, u = alice) => (await http().get(api(`/tasks/${key}/github`)).set(u.auth).expect(200)).body;
  const statusOf = async (key: string) => (await task(key)).status.name as string;
  const activity = async (key: string) => (await http().get(api(`/tasks/${key}/activity`)).set(alice.auth).expect(200)).body as { type: string; field: string | null; to: unknown; actorId: string | null }[];

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User", "Workspace", "WebhookDelivery" CASCADE`;
    github.installations.clear(); github.repos.clear(); github.branches = []; github.issueStates = []; github.configured = true; github.failBranch = false;
    [alice, bob, viv, carol] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Viv'), await signUp(app, 'Carol')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [viv, 'VIEWER'], [carol, 'ADMIN']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
    await http().post(api(`/projects/${project.id}/tasks`)).set(alice.auth).send({ title: 'Login form' }).expect(201);
    await http().post(api(`/projects/${project.id}/tasks`)).set(alice.auth).send({ title: 'Other work' }).expect(201);
    github.installations.set('5001', { githubId: '5001', accountLogin: 'acme', accountType: 'Organization' });
    github.repos.set('5001', [{ githubRepoId: '1001', fullName: 'acme/synqonix', htmlUrl: 'https://github.com/acme/synqonix', defaultBranch: 'main', private: true }]);
    await connect(alice);
    const inst = (await http().get(api('/github')).set(alice.auth).expect(200)).body.installations[0];
    link = (await http().post(api(`/projects/${project.id}/github/repos`)).set(alice.auth).send({ installationId: inst.id, githubRepoId: '1001' }).expect(201)).body;
  });

  async function connect(u: TestUser, installationId = '5001') {
    const url = (await http().get(api('/github/install-url')).set(u.auth).expect(200)).body.url as string;
    const state = new URL(url).searchParams.get('state')!;
    return http().get(`/api/v1/github/setup?installation_id=${installationId}&state=${encodeURIComponent(state)}`);
  }

  describe('installing', () => {
    it('reports whether the integration is configured and lists installations', async () => {
      const res = (await http().get(api('/github')).set(bob.auth).expect(200)).body;
      expect(res.configured).toBe(true);
      expect(res.installations).toEqual([expect.objectContaining({ accountLogin: 'acme', accountType: 'Organization', suspended: false, repositoryCount: 1 })]);
      github.configured = false;
      expect((await http().get(api('/github')).set(bob.auth).expect(200)).body.configured).toBe(false);
      await http().get(api('/github/install-url')).set(alice.auth).expect(400);
    });

    it('only lets workspace admins start an install, and sends a signed state through GitHub', async () => {
      await http().get(api('/github/install-url')).set(bob.auth).expect(403);
      await http().get(api('/github/install-url')).set(viv.auth).expect(403);
      const url = (await http().get(api('/github/install-url')).set(carol.auth).expect(200)).body.url as string;
      expect(url).toContain('github.com/apps/synqonix-test/installations/new?state=');
    });

    it('records the installation when GitHub redirects back, and rejects forged or reused states', async () => {
      github.installations.set('6002', { githubId: '6002', accountLogin: 'octo', accountType: 'User' });
      const res = await connect(alice, '6002');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`http://localhost:3000/w/${ws}/settings?github=connected`);
      expect(await prisma.githubInstallation.count({ where: { workspaceId: ws } })).toBe(2);

      const forged = await http().get('/api/v1/github/setup?installation_id=7003&state=abc.def');
      expect(forged.headers.location).toBe('http://localhost:3000/dashboard?github=error');
      const url = (await http().get(api('/github/install-url')).set(alice.auth).expect(200)).body.url as string;
      const state = new URL(url).searchParams.get('state')!;
      const tampered = `${state.split('.')[0]}x.${state.split('.')[1]}`;
      expect((await http().get(`/api/v1/github/setup?installation_id=7003&state=${encodeURIComponent(tampered)}`)).headers.location).toContain('github=error');
      // unknown installation on GitHub's side
      expect((await http().get(`/api/v1/github/setup?installation_id=9999&state=${encodeURIComponent(state)}`)).headers.location).toBe(`http://localhost:3000/w/${ws}/settings?github=error`);
      expect((await http().get(`/api/v1/github/setup?installation_id=abc&state=${encodeURIComponent(state)}`)).headers.location).toContain('github=error');
    });

    it('does not let a second workspace claim an installation that is already connected', async () => {
      const other = await signUp(app, 'Zed');
      const ws2 = (await http().post('/api/v1/workspaces').set(other.auth).send({ name: 'Other' }).expect(201)).body.id as string;
      const url = (await http().get(`/api/v1/workspaces/${ws2}/github/install-url`).set(other.auth).expect(200)).body.url as string;
      const state = new URL(url).searchParams.get('state')!;
      const res = await http().get(`/api/v1/github/setup?installation_id=5001&state=${encodeURIComponent(state)}`);
      expect(res.headers.location).toBe(`http://localhost:3000/w/${ws2}/settings?github=taken`);
      expect(await prisma.githubInstallation.count({ where: { workspaceId: ws2 } })).toBe(0);
    });

    it('lets admins disconnect an installation, which removes its repository links', async () => {
      const inst = (await http().get(api('/github')).set(alice.auth).expect(200)).body.installations[0];
      await http().delete(api(`/github/installations/${inst.id}`)).set(bob.auth).expect(403);
      await http().delete(api(`/github/installations/${inst.id}`)).set(alice.auth).expect(204);
      await http().delete(api(`/github/installations/${inst.id}`)).set(alice.auth).expect(404);
      expect((await http().get(api(`/projects/${project.id}/github/repos`)).set(alice.auth).expect(200)).body).toEqual([]);
    });
  });

  describe('linking repositories', () => {
    it('shows the linked repository with effective statuses', async () => {
      const repos = (await http().get(api(`/projects/${project.id}/github/repos`)).set(bob.auth).expect(200)).body;
      expect(repos).toHaveLength(1);
      const byName = (n: string) => project.statuses.find((s) => s.name === n)!.id;
      // the Scrum template has an "In Review" column, which is the default for opened pull requests
      expect(repos[0]).toMatchObject({ fullName: 'acme/synqonix', autoTransition: true, effectiveOpenedStatusId: byName('In Review'), effectiveMergedStatusId: byName('Done') });
    });

    it('needs project manage rights to browse, link, change and unlink', async () => {
      await http().get(api(`/projects/${project.id}/github/available`)).set(bob.auth).expect(403);
      await http().post(api(`/projects/${project.id}/github/repos`)).set(bob.auth).send({ installationId: link.installationId, githubRepoId: '1001' }).expect(403);
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(bob.auth).send({ autoTransition: false }).expect(403);
      await http().delete(api(`/projects/${project.id}/github/repos/${link.id}`)).set(bob.auth).expect(403);
      const avail = (await http().get(api(`/projects/${project.id}/github/available`)).set(alice.auth).expect(200)).body;
      expect(avail).toEqual([expect.objectContaining({ fullName: 'acme/synqonix', linked: true })]);
    });

    it('refuses repositories the installation cannot see, and duplicates', async () => {
      await http().post(api(`/projects/${project.id}/github/repos`)).set(alice.auth).send({ installationId: link.installationId, githubRepoId: '1001' }).expect(409);
      await http().post(api(`/projects/${project.id}/github/repos`)).set(alice.auth).send({ installationId: link.installationId, githubRepoId: '404' }).expect(400);
      await http().post(api(`/projects/${project.id}/github/repos`)).set(alice.auth).send({ installationId: 'nope', githubRepoId: '1001' }).expect(404);
    });

    it('updates settings with validated statuses and unlinks', async () => {
      const done = project.statuses.find((s) => s.name === 'Done')!.id;
      const res = (await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ prMergedStatusId: done, importIssues: true, syncIssues: true }).expect(200)).body;
      expect(res).toMatchObject({ prMergedStatusId: done, importIssues: true, syncIssues: true });
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ prOpenedStatusId: 'bogus' }).expect(400);
      expect((await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ prMergedStatusId: null }).expect(200)).body.prMergedStatusId).toBeNull();
      await http().delete(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).expect(204);
      expect((await http().get(api(`/projects/${project.id}/github/repos`)).set(alice.auth).expect(200)).body).toEqual([]);
    });
  });

  describe('webhook security and idempotency', () => {
    it('rejects missing or invalid signatures and unknown secrets', async () => {
      expect((await deliver('ping', 'ping', { signature: 'sha256=deadbeef' })).status).toBe(401);
      expect((await deliver('ping', 'ping', { secret: 'wrong' })).status).toBe(401);
      expect((await http().post('/api/v1/github/webhooks').send({ zen: 'x' })).status).toBe(401);
      const res = await http().post('/api/v1/github/webhooks').set('X-GitHub-Event', 'ping').set('X-GitHub-Delivery', 'd1').send({ zen: 'x' });
      expect(res.status).toBe(401);
      // a body altered after signing no longer matches
      const raw = JSON.stringify(fixture('ping'));
      const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
      const res2 = await http().post('/api/v1/github/webhooks').set('Content-Type', 'application/json').set('X-GitHub-Event', 'ping')
        .set('X-GitHub-Delivery', 'd2').set('X-Hub-Signature-256', sig).send(raw.replace('Keep', 'Kept'));
      expect(res2.status).toBe(401);
    });

    it('accepts pings and unknown events without side effects', async () => {
      expect(await ok('ping', 'ping')).toEqual({ status: 'processed' });
      expect(await ok('star', { action: 'created' })).toEqual({ status: 'processed' });
    });

    it('processes a replayed delivery once', async () => {
      const id = randomUUID();
      expect(await ok('push', 'push-feature-branch', id)).toEqual({ status: 'processed' });
      expect(await ok('push', 'push-feature-branch', id)).toEqual({ status: 'duplicate' });
      expect(await prisma.githubCommit.count()).toBe(2);
      expect(await prisma.webhookDelivery.count({ where: { id } })).toBe(1);
    });

    it('does not create duplicates when the same change arrives in a different delivery', async () => {
      await ok('push', 'push-feature-branch');
      await ok('push', 'push-feature-branch');
      await ok('pull_request', 'pull-request-opened');
      await ok('pull_request', 'pull-request-opened');
      expect(await prisma.githubBranch.count()).toBe(1);
      expect(await prisma.githubCommit.count()).toBe(2);
      expect(await prisma.githubPullRequest.count()).toBe(1);
      // branch, the one commit that names SYN-1, and the pull request
      expect(await prisma.taskGithubLink.count({ where: { task: { number: 1 } } })).toBe(3);
      expect((await activity('SYN-1')).filter((a) => a.type === 'github_linked')).toHaveLength(3);
    });

    it('ignores repositories nobody linked, and unlinked repositories stop receiving data', async () => {
      const body = fixture('push-feature-branch');
      await ok('push', { ...body, repository: { ...(body.repository as object), id: 424242 } });
      expect(await prisma.githubBranch.count()).toBe(0);
    });

    it('lets GitHub retry when processing fails', async () => {
      const id = randomUUID();
      // A payload that makes the handler throw (commit with an invalid timestamp)
      const bad = { ...fixture('push-feature-branch'), commits: [{ id: 'abc', message: 'x', url: 'u', timestamp: 'not a date' }] };
      expect((await deliver('push', bad, { id })).status).toBe(500);
      expect(await prisma.webhookDelivery.count({ where: { id } })).toBe(0);
      expect(await ok('push', 'push-feature-branch', id)).toEqual({ status: 'processed' });
    });
  });

  describe('push events', () => {
    it('records branches and commits and links them to tasks by key', async () => {
      await ok('push', 'push-feature-branch');
      const one = await gh('SYN-1');
      expect(one.branches).toEqual([expect.objectContaining({ name: 'feature/SYN-1-login-form', repo: 'acme/synqonix', deleted: false, url: 'https://github.com/acme/synqonix/tree/feature/SYN-1-login-form' })]);
      // Commits link by their own message; the second one names no task.
      expect(one.commits.map((c: { message: string }) => c.message)).toEqual(['Add login form markup']);
      // SYN-2 is only named in the body of that commit message
      const two = await gh('SYN-2');
      expect(two.branches).toEqual([]);
      expect(two.commits).toEqual([expect.objectContaining({ message: 'Add login form markup', authorLogin: 'octo-dev', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' })]);
      expect((await activity('SYN-1')).filter((a) => a.type === 'github_linked').map((a) => a.to)).toEqual(expect.arrayContaining(['branch feature/SYN-1-login-form', 'commit a1b2c3d']));
    });

    it('marks deleted branches and ignores tags and unknown keys', async () => {
      await ok('push', 'push-feature-branch');
      await ok('push', 'push-branch-deleted');
      await ok('push', 'push-tag');
      expect((await gh('SYN-1')).branches[0].deleted).toBe(true);
      expect(await prisma.githubBranch.count()).toBe(1);
      await ok('push', { ...fixture('push-feature-branch'), ref: 'refs/heads/feature/NOPE-99-x', commits: [] });
      expect(await prisma.taskGithubLink.count()).toBeGreaterThan(0);
      expect(await prisma.githubBranch.count()).toBe(2);
      expect(await prisma.taskGithubLink.count({ where: { branch: { name: 'feature/NOPE-99-x' } } })).toBe(0);
    });
  });

  describe('pull requests', () => {
    it('links by branch, title and body, and moves the task to In Review', async () => {
      expect(await statusOf('SYN-1')).toBe('To Do');
      await ok('pull_request', 'pull-request-opened');
      expect(await statusOf('SYN-1')).toBe('In Review');
      const pr = (await gh('SYN-1')).pullRequests[0];
      expect(pr).toMatchObject({ number: 12, title: 'Add login form (SYN-1)', state: 'OPEN', draft: false, headBranch: 'feature/SYN-1-login-form', baseBranch: 'main', authorLogin: 'octo-dev', reviewState: null, ci: null, url: 'https://github.com/acme/synqonix/pull/12' });
      expect((await activity('SYN-1')).find((a) => a.field === 'status')).toMatchObject({ to: 'In Review', actorId: null });
    });

    it('does not move tasks for draft pull requests until they are ready', async () => {
      await ok('pull_request', 'pull-request-opened-draft');
      expect(await statusOf('SYN-1')).toBe('To Do');
      expect((await gh('SYN-1')).pullRequests[0].draft).toBe(true);
      await ok('pull_request', 'pull-request-ready');
      expect(await statusOf('SYN-1')).toBe('In Review');
      expect((await gh('SYN-1')).pullRequests[0].draft).toBe(false);
    });

    it('moves the task to Done when the pull request is merged', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('pull_request', 'pull-request-merged');
      expect(await statusOf('SYN-1')).toBe('Done');
      expect((await task('SYN-1')).completedAt).toBeTruthy();
      const pr = (await gh('SYN-1')).pullRequests[0];
      expect(pr.state).toBe('MERGED');
    });

    it('leaves the task alone when the pull request is closed without merging', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('pull_request', 'pull-request-closed-unmerged');
      expect(await statusOf('SYN-1')).toBe('In Review');
      expect((await gh('SYN-1')).pullRequests[0].state).toBe('CLOSED');
    });

    it('never reopens finished tasks, and does nothing with automations off', async () => {
      const done = project.statuses.find((s) => s.name === 'Done')!.id;
      await http().patch(api('/tasks/SYN-1')).set(alice.auth).send({ statusId: done }).expect(200);
      await ok('pull_request', 'pull-request-opened');
      expect(await statusOf('SYN-1')).toBe('Done');
      await http().patch(api('/tasks/SYN-1')).set(alice.auth).send({ statusId: project.statuses[0].id }).expect(200);
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ autoTransition: false }).expect(200);
      await ok('pull_request', 'pull-request-opened');
      expect(await statusOf('SYN-1')).toBe('To Do');
      await ok('pull_request', 'pull-request-merged');
      expect(await statusOf('SYN-1')).toBe('To Do');
      expect((await gh('SYN-1')).pullRequests).toHaveLength(1); // still linked
    });

    it('uses configured target statuses', async () => {
      const progress = project.statuses.find((s) => s.name === 'In Progress')!.id;
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ prOpenedStatusId: progress }).expect(200);
      await ok('pull_request', 'pull-request-opened');
      expect(await statusOf('SYN-1')).toBe('In Progress');
    });

    it('picks up keys added to the title later', async () => {
      await ok('pull_request', 'pull-request-opened');
      expect((await gh('SYN-2')).pullRequests).toEqual([]);
      await ok('pull_request', 'pull-request-edited');
      expect((await gh('SYN-2')).pullRequests).toEqual([expect.objectContaining({ number: 12, title: 'Add login form (SYN-1, SYN-2)' })]);
    });

    it('records review verdicts without letting comments override them', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('pull_request_review', 'pull-request-review-commented');
      expect((await gh('SYN-1')).pullRequests[0].reviewState).toBe('COMMENTED');
      await ok('pull_request_review', 'pull-request-review-approved');
      expect((await gh('SYN-1')).pullRequests[0].reviewState).toBe('APPROVED');
      await ok('pull_request_review', 'pull-request-review-commented');
      expect((await gh('SYN-1')).pullRequests[0].reviewState).toBe('APPROVED');
      await ok('pull_request_review', 'pull-request-review-changes');
      expect((await gh('SYN-1')).pullRequests[0].reviewState).toBe('CHANGES_REQUESTED');
    });

    it('summarises CI from check runs on the head commit', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('check_run', 'check-run-success');
      expect((await gh('SYN-1')).pullRequests[0].ci).toBe('SUCCESS');
      await ok('check_run', 'check-run-in-progress');
      expect((await gh('SYN-1')).pullRequests[0].ci).toBe('PENDING');
      await ok('check_run', 'check-run-failure');
      expect((await gh('SYN-1')).pullRequests[0].ci).toBe('FAILURE');
      // a rerun of the failing check replaces its result instead of adding one
      await ok('check_run', { ...fixture('check-run-failure'), check_run: { ...(fixture('check-run-failure').check_run as object), conclusion: 'success' } });
      await ok('check_run', { ...fixture('check-run-in-progress'), check_run: { ...(fixture('check-run-in-progress').check_run as object), status: 'completed', conclusion: 'success' } });
      expect((await gh('SYN-1')).pullRequests[0].ci).toBe('SUCCESS');
      expect(await prisma.githubCheck.count()).toBe(3);
    });

    it('shows development data only to people who can see the task', async () => {
      await ok('pull_request', 'pull-request-opened');
      const hidden = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', template: 'SCRUM', visibility: 'PRIVATE' }).expect(201)).body;
      await http().post(api(`/projects/${hidden.id}/tasks`)).set(alice.auth).send({ title: 'Hidden' }).expect(201);
      await http().get(api('/tasks/SEC-1/github')).set(bob.auth).expect(404);
      expect((await gh('SYN-1', viv)).pullRequests).toHaveLength(1);
    });
  });

  describe('contributors', () => {
    it('collects GitHub logins and lets admins map them to members', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('push', 'push-feature-branch');
      expect((await http().get(api('/github/contributors')).set(bob.auth).expect(200)).body).toEqual([{ login: 'octo-dev', userId: null }]);
      await http().put(api('/github/contributors/octo-dev')).set(bob.auth).send({ userId: bob.id }).expect(403);
      await http().put(api('/github/contributors/octo-dev')).set(alice.auth).send({ userId: 'nobody' }).expect(400);
      await http().put(api('/github/contributors/octo-dev')).set(alice.auth).send({ userId: bob.id }).expect(200);
      const one = await gh('SYN-1');
      expect(one.pullRequests[0].authorName).toBe('Bob');
      expect(one.commits[0].authorName).toBe('Bob');
    });

    it('credits automatic status changes to the mapped person', async () => {
      await http().put(api('/github/contributors/octo-dev')).set(alice.auth).send({ userId: bob.id }).expect(200);
      await ok('pull_request', 'pull-request-opened');
      expect((await activity('SYN-1')).find((a) => a.field === 'status')).toMatchObject({ actorId: bob.id, to: 'In Review' });
      await http().put(api('/github/contributors/octo-dev')).set(alice.auth).send({ userId: null }).expect(200);
      expect((await http().get(api('/github/contributors')).set(alice.auth).expect(200)).body).toEqual([{ login: 'octo-dev', userId: null }]);
    });
  });

  describe('issues', () => {
    it('imports new issues as tasks when enabled, once', async () => {
      await ok('issues', 'issue-opened');
      expect(await prisma.task.count()).toBe(2); // not enabled yet
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ importIssues: true }).expect(200);
      await prisma.githubIssue.deleteMany();
      await ok('issues', 'issue-opened');
      await ok('issues', 'issue-opened');
      const tasks = (await http().get(api(`/tasks?projectId=${project.id}`)).set(alice.auth).expect(200)).body.items as { key: string; title: string }[];
      const imported = tasks.filter((t) => t.title === 'Crash when saving a draft');
      expect(imported).toHaveLength(1);
      const detail = await task(imported[0].key);
      expect(detail.description).toContain('Steps to reproduce');
      expect(detail.description).toContain('acme/synqonix#7');
      expect((await gh(imported[0].key)).issues).toEqual([expect.objectContaining({ number: 7, state: 'OPEN', repo: 'acme/synqonix' })]);
    });

    it('keeps issue and task state in step both ways when syncing', async () => {
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ importIssues: true, syncIssues: true }).expect(200);
      await ok('issues', 'issue-opened');
      const key = (await prisma.task.findFirstOrThrow({ where: { title: 'Crash when saving a draft' }, include: { project: true } }));
      const k = `${key.project.key}-${key.number}`;
      await ok('issues', 'issue-closed');
      expect(await statusOf(k)).toBe('Done');
      expect(github.issueStates).toEqual([]); // GitHub already knows
      await ok('issues', 'issue-reopened');
      expect(await statusOf(k)).toBe('To Do');
      // Finishing the task here closes the issue on GitHub
      const done = project.statuses.find((s) => s.name === 'Done')!.id;
      await http().patch(api(`/tasks/${k}`)).set(alice.auth).send({ statusId: done }).expect(200);
      await new Promise((r) => setTimeout(r, 200));
      expect(github.issueStates).toEqual([{ repo: 'acme/synqonix', number: 7, state: 'closed' }]);
      expect((await gh(k)).issues[0].state).toBe('CLOSED');
      // And moving it back reopens it
      await http().patch(api(`/tasks/${k}`)).set(alice.auth).send({ statusId: project.statuses[0].id }).expect(200);
      await new Promise((r) => setTimeout(r, 200));
      expect(github.issueStates.at(-1)).toEqual({ repo: 'acme/synqonix', number: 7, state: 'open' });
    });

    it('does not touch GitHub when syncing is off', async () => {
      await http().patch(api(`/projects/${project.id}/github/repos/${link.id}`)).set(alice.auth).send({ importIssues: true }).expect(200);
      await ok('issues', 'issue-opened');
      const t = await prisma.task.findFirstOrThrow({ where: { title: 'Crash when saving a draft' } });
      const done = project.statuses.find((s) => s.name === 'Done')!.id;
      await http().patch(api(`/tasks/SYN-${t.number}`)).set(alice.auth).send({ statusId: done }).expect(200);
      await new Promise((r) => setTimeout(r, 150));
      expect(github.issueStates).toEqual([]);
      await ok('issues', 'issue-closed');
      expect(await statusOf(`SYN-${t.number}`)).toBe('Done');
    });
  });

  describe('installation events', () => {
    it('removes everything when the app is uninstalled', async () => {
      await ok('pull_request', 'pull-request-opened');
      await ok('installation', 'installation-deleted');
      expect(await prisma.githubInstallation.count()).toBe(0);
      expect(await prisma.linkedRepository.count()).toBe(0);
      expect(await prisma.githubPullRequest.count()).toBe(0);
      expect((await gh('SYN-1')).pullRequests).toEqual([]);
    });

    it('ignores deliveries while suspended and resumes afterwards', async () => {
      await ok('installation', 'installation-suspended');
      await ok('push', 'push-feature-branch');
      expect(await prisma.githubBranch.count()).toBe(0);
      await ok('installation', { ...fixture('installation-suspended'), action: 'unsuspend' });
      await ok('push', 'push-feature-branch');
      expect(await prisma.githubBranch.count()).toBe(1);
    });

    it('unlinks repositories removed from the installation', async () => {
      await ok('installation_repositories', 'installation-repositories-removed');
      expect((await http().get(api(`/projects/${project.id}/github/repos`)).set(alice.auth).expect(200)).body).toEqual([]);
    });
  });

  describe('creating branches from tasks', () => {
    it('creates the branch on GitHub with a name derived from the task, and links it', async () => {
      const res = (await http().post(api('/tasks/SYN-1/github/branches')).set(bob.auth).send({ repoId: link.id }).expect(200)).body;
      expect(github.branches).toEqual([{ installation: '5001', repo: 'acme/synqonix', name: 'syn-1-login-form', from: 'main' }]);
      expect(res.branches).toEqual([expect.objectContaining({ name: 'syn-1-login-form', repo: 'acme/synqonix' })]);
      expect(res.suggestedBranch).toBe('syn-1-login-form');
      expect(res.repos).toEqual([expect.objectContaining({ id: link.id, fullName: 'acme/synqonix', defaultBranch: 'main' })]);
      // GitHub's push event for the new branch changes nothing
      await ok('push', { ...fixture('push-feature-branch'), ref: 'refs/heads/syn-1-login-form', commits: [] });
      expect((await gh('SYN-1')).branches).toHaveLength(1);
    });

    it('accepts a custom name and base, and validates both', async () => {
      await http().post(api('/tasks/SYN-1/github/branches')).set(alice.auth).send({ repoId: link.id, name: 'hotfix/login', from: 'release' }).expect(200);
      expect(github.branches[0]).toMatchObject({ name: 'hotfix/login', from: 'release' });
      await http().post(api('/tasks/SYN-2/github/branches')).set(alice.auth).send({ repoId: link.id, name: 'bad name;' }).expect(400);
      await http().post(api('/tasks/SYN-2/github/branches')).set(alice.auth).send({ repoId: 'nope' }).expect(404);
    });

    it('needs write access to the task and reports GitHub failures', async () => {
      await http().post(api('/tasks/SYN-1/github/branches')).set(viv.auth).send({ repoId: link.id }).expect(403);
      github.failBranch = true;
      const res = await http().post(api('/tasks/SYN-1/github/branches')).set(alice.auth).send({ repoId: link.id });
      expect(res.status).toBe(500);
      expect(await prisma.githubBranch.count()).toBe(0);
    });
  });
});
