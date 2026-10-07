import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

describe('Workspaces, members & invitations (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let alice: TestUser, bob: TestUser, carol: TestUser;
  let wsId: string;
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.sent = []; mail.invites = [];
    [alice, bob, carol] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Carol')];
    const ws = await http().post(api('/workspaces')).set(alice.auth).send({ name: 'Acme Inc' }).expect(201);
    wsId = ws.body.id;
  });

  /** Invites `user` with `role` and has them accept. */
  async function addMember(user: TestUser, role: 'ADMIN' | 'MEMBER' | 'VIEWER' | 'OWNER' = 'MEMBER') {
    await http().post(api(`/workspaces/${wsId}/invitations`)).set(alice.auth).send({ email: user.email, role }).expect(201);
    const token = mail.inviteTokenFor(user.email)!;
    await http().post(api(`/invitations/${token}/accept`)).set(user.auth).expect(201);
  }

  it('creates a workspace owned by the creator, with a unique slug', async () => {
    const list = await http().get(api('/workspaces')).set(alice.auth).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER' })]);
    const second = await http().post(api('/workspaces')).set(bob.auth).send({ name: 'Acme Inc' }).expect(201);
    expect(second.body.slug).not.toBe('acme-inc');
    expect(second.body.slug).toMatch(/^acme-inc-/);
  });

  it('hides workspaces from non-members and requires auth', async () => {
    await http().get(api(`/workspaces/${wsId}`)).expect(401);
    await http().get(api(`/workspaces/${wsId}`)).set(bob.auth).expect(404);
    await http().get(api(`/workspaces/${wsId}/projects`)).set(bob.auth).expect(404);
    const mine = await http().get(api('/workspaces')).set(bob.auth).expect(200);
    expect(mine.body).toEqual([]);
  });

  it('runs the invitation flow end to end', async () => {
    const inv = await http().post(api(`/workspaces/${wsId}/invitations`)).set(alice.auth)
      .send({ email: 'BOB@example.com', role: 'MEMBER' }).expect(201);
    expect(inv.body.email).toBe('bob@example.com');
    const token = mail.inviteTokenFor(bob.email)!;
    expect(token).toBeTruthy();

    // public preview, no auth
    const preview = await http().get(api(`/invitations/${token}`)).expect(200);
    expect(preview.body).toMatchObject({ workspaceName: 'Acme Inc', inviterName: 'Alice', role: 'MEMBER' });

    // someone else cannot use it
    await http().post(api(`/invitations/${token}/accept`)).set(carol.auth).expect(403);
    // the recipient can
    const accepted = await http().post(api(`/invitations/${token}/accept`)).set(bob.auth).expect(201);
    expect(accepted.body).toMatchObject({ id: wsId, role: 'MEMBER' });
    await http().get(api(`/workspaces/${wsId}`)).set(bob.auth).expect(200);
    // single use
    await http().post(api(`/invitations/${token}/accept`)).set(bob.auth).expect(410);
    await http().get(api(`/invitations/${token}`)).expect(410);
    // already a member
    await http().post(api(`/workspaces/${wsId}/invitations`)).set(alice.auth)
      .send({ email: bob.email, role: 'ADMIN' }).expect(409);
  });

  it('supports listing, resending, revoking and declining', async () => {
    await http().post(api(`/workspaces/${wsId}/invitations`)).set(alice.auth).send({ email: bob.email, role: 'VIEWER' }).expect(201);
    const first = mail.inviteTokenFor(bob.email)!;
    const pending = await http().get(api(`/workspaces/${wsId}/invitations`)).set(alice.auth).expect(200);
    expect(pending.body).toHaveLength(1);

    await http().post(api(`/workspaces/${wsId}/invitations/${pending.body[0].id}/resend`)).set(alice.auth).expect(201);
    const second = mail.inviteTokenFor(bob.email)!;
    expect(second).not.toBe(first);
    await http().get(api(`/invitations/${first}`)).expect(404); // old link revoked

    await http().post(api(`/invitations/${second}/decline`)).set(bob.auth).expect(204);
    await http().post(api(`/invitations/${second}/accept`)).set(bob.auth).expect(404);

    await http().post(api(`/workspaces/${wsId}/invitations`)).set(alice.auth).send({ email: carol.email, role: 'MEMBER' }).expect(201);
    const list = await http().get(api(`/workspaces/${wsId}/invitations`)).set(alice.auth);
    await http().delete(api(`/workspaces/${wsId}/invitations/${list.body[0].id}`)).set(alice.auth).expect(204);
    await http().post(api(`/invitations/${mail.inviteTokenFor(carol.email)}/accept`)).set(carol.auth).expect(404);
  });

  it('enforces the role matrix on invitations and workspace settings', async () => {
    await addMember(bob, 'MEMBER');
    await addMember(carol, 'ADMIN');
    await http().post(api(`/workspaces/${wsId}/invitations`)).set(bob.auth).send({ email: 'x@example.com', role: 'MEMBER' }).expect(403);
    await http().patch(api(`/workspaces/${wsId}`)).set(bob.auth).send({ name: 'Hacked' }).expect(403);
    await http().patch(api(`/workspaces/${wsId}`)).set(carol.auth).send({ name: 'Acme Corp' }).expect(200);
    await http().post(api(`/workspaces/${wsId}/invitations`)).set(carol.auth).send({ email: 'x@example.com', role: 'OWNER' }).expect(403);
    await http().delete(api(`/workspaces/${wsId}`)).set(carol.auth).expect(403);
  });

  it('manages member roles safely', async () => {
    await addMember(bob, 'MEMBER');
    await addMember(carol, 'ADMIN');

    const members = await http().get(api(`/workspaces/${wsId}/members`)).set(bob.auth).expect(200);
    expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);

    await http().patch(api(`/workspaces/${wsId}/members/${bob.id}`)).set(bob.auth).send({ role: 'ADMIN' }).expect(403);
    await http().patch(api(`/workspaces/${wsId}/members/${bob.id}`)).set(carol.auth).send({ role: 'VIEWER' }).expect(200);
    // admins cannot touch owners or mint owners
    await http().patch(api(`/workspaces/${wsId}/members/${alice.id}`)).set(carol.auth).send({ role: 'MEMBER' }).expect(403);
    await http().patch(api(`/workspaces/${wsId}/members/${bob.id}`)).set(carol.auth).send({ role: 'OWNER' }).expect(403);
    // the last owner cannot be demoted or leave
    await http().patch(api(`/workspaces/${wsId}/members/${alice.id}`)).set(alice.auth).send({ role: 'ADMIN' }).expect(400);
    await http().delete(api(`/workspaces/${wsId}/members/${alice.id}`)).set(alice.auth).expect(400);
    // after promoting a second owner, the first may step down
    await http().patch(api(`/workspaces/${wsId}/members/${carol.id}`)).set(alice.auth).send({ role: 'OWNER' }).expect(200);
    await http().patch(api(`/workspaces/${wsId}/members/${alice.id}`)).set(alice.auth).send({ role: 'ADMIN' }).expect(200);
  });

  it('lets members leave and admins remove members, revoking access', async () => {
    await addMember(bob, 'MEMBER');
    await addMember(carol, 'MEMBER');
    await http().delete(api(`/workspaces/${wsId}/members/${carol.id}`)).set(bob.auth).expect(403); // plain member
    await http().delete(api(`/workspaces/${wsId}/members/${carol.id}`)).set(alice.auth).expect(204);
    await http().get(api(`/workspaces/${wsId}`)).set(carol.auth).expect(404);
    await http().delete(api(`/workspaces/${wsId}/members/${bob.id}`)).set(bob.auth).expect(204); // leave
    await http().get(api(`/workspaces/${wsId}`)).set(bob.auth).expect(404);
  });

  it('records an audit log visible to admins only', async () => {
    await addMember(bob, 'MEMBER');
    const log = await http().get(api(`/workspaces/${wsId}/audit-log`)).set(alice.auth).expect(200);
    const actions = log.body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['workspace.created', 'invitation.created', 'member.joined']));
    await http().get(api(`/workspaces/${wsId}/audit-log`)).set(bob.auth).expect(403);
    await http().get(api(`/workspaces/${wsId}/audit-log?limit=1`)).set(alice.auth).expect(200)
      .then((r) => expect(r.body).toHaveLength(1));
  });

  it('deletes a workspace (owner only) and blocks account deletion for sole owners', async () => {
    await http().delete(api('/users/me')).set(alice.auth).send({ password: 'correct horse battery' }).expect(400);
    await addMember(bob, 'ADMIN');
    await http().delete(api(`/workspaces/${wsId}`)).set(bob.auth).expect(403);
    await http().delete(api(`/workspaces/${wsId}`)).set(alice.auth).expect(204);
    await http().get(api(`/workspaces/${wsId}`)).set(alice.auth).expect(404);
    await http().delete(api('/users/me')).set(alice.auth).send({ password: 'correct horse battery' }).expect(204);
  });
});
