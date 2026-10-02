import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, type FakeMailService } from './helpers.js';

const creds = { email: 'ada@example.com', name: 'Ada', password: 'correct horse battery' };

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, mail, prisma } = await createTestApp()));
  afterAll(() => app.close());
  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE "User" CASCADE`;
    mail.sent = [];
  });

  const register = () => http().post('/api/v1/auth/register').send(creds);

  it('registers, returns tokens, sets refresh cookie, sends verification mail', async () => {
    const res = await register().expect(201);
    expect(res.body.user).toMatchObject({ email: creds.email, emailVerified: false });
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/sx_refresh=.*HttpOnly/);
    expect(mail.tokenFor(creds.email, 'verify-email')).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate emails and weak passwords', async () => {
    await register().expect(201);
    await register().expect(409);
    await http().post('/api/v1/auth/register').send({ ...creds, email: 'b@example.com', password: 'short' }).expect(400);
  });

  it('logs in case-insensitively and rejects bad credentials', async () => {
    await register();
    await http().post('/api/v1/auth/login').send({ email: 'ADA@example.com', password: creds.password }).expect(200);
    await http().post('/api/v1/auth/login').send({ email: creds.email, password: 'nope-nope-nope' }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' }).expect(401);
  });

  it('protects routes and serves /users/me with a valid token', async () => {
    await http().get('/api/v1/users/me').expect(401);
    const { body } = await register();
    const me = await http().get('/api/v1/users/me').set('Authorization', `Bearer ${body.accessToken}`).expect(200);
    expect(me.body.email).toBe(creds.email);
    await http().get('/api/v1/users/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('verifies email once', async () => {
    const { body } = await register();
    const token = mail.tokenFor(creds.email, 'verify-email')!;
    await http().post('/api/v1/auth/verify-email').send({ token }).expect(204);
    await http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    const me = await http().get('/api/v1/users/me').set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.body.emailVerified).toBe(true);
    await http().post('/api/v1/auth/resend-verification').set('Authorization', `Bearer ${body.accessToken}`).expect(400);
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const { body } = await register();
    const first = body.refreshToken as string;
    const rotated = await http().post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first);

    // Reusing the old token is treated as theft: the whole session dies.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(401);
  });

  it('refreshes using the httpOnly cookie and logs out', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/register').send(creds).expect(201);
    const refreshed = await agent.post('/api/v1/auth/refresh').send({}).expect(200);
    await agent.post('/api/v1/auth/logout').send({}).expect(204);
    await agent.post('/api/v1/auth/refresh').send({}).expect(401);
    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(401);
  });

  it('resets a password, invalidating sessions and the link', async () => {
    const { body } = await register();
    await http().post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(204);
    expect(mail.tokenFor('ghost@example.com', 'reset-password')).toBeUndefined();

    await http().post('/api/v1/auth/forgot-password').send({ email: creds.email }).expect(204);
    const token = mail.tokenFor(creds.email, 'reset-password')!;
    await http().post('/api/v1/auth/reset-password').send({ token, password: 'a brand new password' }).expect(204);
    await http().post('/api/v1/auth/reset-password').send({ token, password: 'another new password' }).expect(400);

    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${body.accessToken}`).expect(401);
    await http().post('/api/v1/auth/login').send({ email: creds.email, password: creds.password }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: creds.email, password: 'a brand new password' }).expect(200);
  });

  it('changes password and signs out other sessions only', async () => {
    const a = await register();
    const b = await http().post('/api/v1/auth/login').send({ email: creds.email, password: creds.password });
    await http().post('/api/v1/auth/change-password').set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ currentPassword: 'wrong-wrong', newPassword: 'new password 123' }).expect(400);
    await http().post('/api/v1/auth/change-password').set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ currentPassword: creds.password, newPassword: 'new password 123' }).expect(204);
    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${a.body.accessToken}`).expect(200);
    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${b.body.accessToken}`).expect(401);
  });

  it('lists and revokes sessions', async () => {
    const a = await register();
    const b = await http().post('/api/v1/auth/login').send({ email: creds.email, password: creds.password });
    const list = await http().get('/api/v1/auth/sessions').set('Authorization', `Bearer ${a.body.accessToken}`).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await http().delete(`/api/v1/auth/sessions/${other.id}`).set('Authorization', `Bearer ${a.body.accessToken}`).expect(204);
    await http().get('/api/v1/users/me').set('Authorization', `Bearer ${b.body.accessToken}`).expect(401);
  });

  it('issues API tokens that authenticate but cannot manage credentials', async () => {
    const { body } = await register();
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    const created = await http().post('/api/v1/api-tokens').set(auth).send({ name: 'vscode' }).expect(201);
    expect(created.body.token).toMatch(/^sqx_/);

    const viaToken = { Authorization: `Bearer ${created.body.token}` };
    await http().get('/api/v1/users/me').set(viaToken).expect(200);
    await http().post('/api/v1/api-tokens').set(viaToken).send({ name: 'x' }).expect(403);
    await http().get('/api/v1/auth/sessions').set(viaToken).expect(403);

    const list = await http().get('/api/v1/api-tokens').set(auth).expect(200);
    expect(list.body[0]).not.toHaveProperty('token');
    expect(list.body[0].prefix).toBe(created.body.token.slice(0, 12));

    await http().delete(`/api/v1/api-tokens/${created.body.id}`).set(auth).expect(204);
    await http().get('/api/v1/users/me').set(viaToken).expect(401);
  });

  it('deletes the account with the right password', async () => {
    const { body } = await register();
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    await http().delete('/api/v1/users/me').set(auth).send({ password: 'wrong' }).expect(401);
    await http().delete('/api/v1/users/me').set(auth).send({ password: creds.password }).expect(204);
    await http().post('/api/v1/auth/login').send({ email: creds.email, password: creds.password }).expect(401);
  });
});
