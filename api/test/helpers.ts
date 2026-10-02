import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { GithubClient, type GithubInstallationInfo, type GithubRepoInfo } from '../src/github/github.client.js';
import { WebhookSender } from '../src/webhooks/webhook-sender.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

export interface SentMail { to: string; subject: string; text: string }

export class FakeMailService {
  sent: SentMail[] = [];
  invites: { to: string; token: string; workspace: string }[] = [];
  async send(m: SentMail) { this.sent.push(m); }
  private url(to: string, path: string) {
    const mail = [...this.sent].reverse().find((m) => m.to === to && m.text.includes(path));
    return mail?.text.match(new RegExp(`${path}\\?token=([^\\s]+)`))?.[1];
  }
  sendVerificationEmail(u: { email: string; name: string }, token: string) {
    return this.send({ to: u.email, subject: 'verify', text: `/verify-email?token=${token}` });
  }
  sendPasswordResetEmail(u: { email: string; name: string }, token: string) {
    return this.send({ to: u.email, subject: 'reset', text: `/reset-password?token=${token}` });
  }
  async sendInvitationEmail(to: string, _inviter: string, workspace: string, token: string) {
    this.invites.push({ to, token, workspace });
  }
  notifications: { to: string; items: { title: string; body?: string | null; url: string }[] }[] = [];
  failNotifications = false;
  async sendNotificationEmail(to: string, items: { title: string; body?: string | null; url: string }[]) {
    if (this.failNotifications) throw new Error('smtp down');
    this.notifications.push({ to, items });
  }
  inviteTokenFor(to: string) { return [...this.invites].reverse().find((i) => i.to === to)?.token; }
  tokenFor(to: string, path: 'verify-email' | 'reset-password') { return this.url(to, `/${path}`); }
}

/** Stands in for GitHub's REST API; records what the app asked it to do. */
export class FakeGithubClient extends GithubClient {
  installations = new Map<string, GithubInstallationInfo>();
  repos = new Map<string, GithubRepoInfo[]>();
  branches: { installation: string; repo: string; name: string; from: string }[] = [];
  issueStates: { repo: string; number: number; state: string }[] = [];
  configured = true;
  failBranch = false;
  isConfigured() { return this.configured; }
  installUrl(state: string) { return `https://github.com/apps/synqonix-test/installations/new?state=${encodeURIComponent(state)}`; }
  async getInstallation(id: string) { return this.installations.get(id) ?? null; }
  async listRepositories(id: string) { return this.repos.get(id) ?? []; }
  async createBranch(installation: string, repo: string, name: string, from: string) {
    if (this.failBranch) throw new Error('boom');
    this.branches.push({ installation, repo, name, from });
    return { sha: 'f'.repeat(40), url: `https://github.com/${repo}/tree/${name}` };
  }
  async setIssueState(_installation: string, repo: string, number: number, state: 'open' | 'closed') { this.issueStates.push({ repo, number, state }); }
}

/** Records webhook requests instead of sending them; answers with a configurable status. */
export class FakeWebhookSender extends WebhookSender {
  requests: { url: string; headers: Record<string, string>; body: string }[] = [];
  status = 200;
  fail: string | null = null;
  async send(req: { url: string; headers: Record<string, string>; body: string }) {
    this.requests.push(req);
    if (this.fail) throw new Error(this.fail);
    return { status: this.status };
  }
}

export async function createTestApp({ throttle = false } = {}) {
  const mail = new FakeMailService();
  const github = new FakeGithubClient();
  const webhookSender = new FakeWebhookSender();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue(mail)
    .overrideProvider(GithubClient).useValue(github)
    .overrideProvider(WebhookSender).useValue(webhookSender);
  process.env.THROTTLE_DISABLED = throttle ? '0' : '1';
  const mod = await builder.compile();
  const app = mod.createNestApplication<NestExpressApplication>({ rawBody: true });
  setupApp(app, 'http://localhost:3000');
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, mail, prisma, github, webhookSender };
}

import request from 'supertest';

export interface TestUser { id: string; email: string; token: string; auth: { Authorization: string } }

/** Registers a user and returns a ready-to-use bearer header. */
export async function signUp(app: NestExpressApplication, name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, name, password: 'correct horse battery' })
    .expect(201);
  const token = res.body.accessToken as string;
  return { id: res.body.user.id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Creates a workspace owned by `owner` and adds the given users with the given roles. */
export async function createWorkspace(
  app: NestExpressApplication,
  mail: FakeMailService,
  owner: TestUser,
  others: [TestUser, 'ADMIN' | 'MEMBER' | 'VIEWER'][] = [],
  name = 'Acme',
): Promise<string> {
  const http = () => request(app.getHttpServer());
  const ws = (await http().post('/api/v1/workspaces').set(owner.auth).send({ name }).expect(201)).body.id as string;
  for (const [user, role] of others) {
    await http().post(`/api/v1/workspaces/${ws}/invitations`).set(owner.auth).send({ email: user.email, role }).expect(201);
    await http().post(`/api/v1/invitations/${mail.inviteTokenFor(user.email)}/accept`).set(user.auth).expect(201);
  }
  return ws;
}
