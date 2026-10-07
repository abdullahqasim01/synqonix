import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

interface Evt { type: string; taskKey: string; projectId: string; actorId: string; fields?: string[]; statusId?: string }

describe('Realtime (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let url: string;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let ws: string;
  let project: { id: string; statuses: { id: string; name: string }[] };
  let sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1/workspaces/${ws}${p}`;

  beforeAll(async () => {
    ({ app, mail, prisma } = await createTestApp());
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(prisma);
    [alice, bob, eve] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Eve')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER']]);
    project = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Synqonix', key: 'SYN', template: 'SCRUM' }).expect(201)).body;
  });
  afterEach(() => { sockets.forEach((s) => s.close()); sockets = []; });

  /** Connects and collects `task` events. */
  async function connect(token: string | undefined) {
    const s = io(url, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    const events: Evt[] = [];
    s.on('task', (e: Evt) => events.push(e));
    await new Promise<void>((resolve, reject) => {
      s.on('connect', resolve);
      s.on('connect_error', (err) => reject(err));
    });
    return { s, events };
  }
  const subscribe = (s: Socket, projectId: string) => new Promise<{ ok: boolean; error?: string }>((res) => s.emit('subscribe', { projectId }, res));
  const waitFor = async (events: Evt[], pred: (e: Evt) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out; got ${JSON.stringify(events)}`);
  };
  const quiet = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const mk = (title: string, body: Record<string, unknown> = {}, pid = project.id) =>
    http().post(api(`/projects/${pid}/tasks`)).set(alice.auth).send({ title, ...body }).expect(201).then((r) => r.body as { id: string; key: string });

  it('rejects connections without valid credentials', async () => {
    await expect(connect(undefined)).rejects.toThrow(/unauthorized/);
    await expect(connect('garbage')).rejects.toThrow(/unauthorized/);
    await expect(connect(alice.token)).resolves.toBeTruthy();
  });

  it('accepts personal API tokens', async () => {
    const t = (await http().post('/api/v1/api-tokens').set(alice.auth).send({ name: 'vscode' }).expect(201)).body.token as string;
    const { s } = await connect(t);
    expect(await subscribe(s, project.id)).toEqual({ ok: true });
  });

  it('only lets people who can see a project subscribe to it', async () => {
    const priv = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Secret', key: 'SEC', visibility: 'PRIVATE' })).body;
    const { s: bobSock } = await connect(bob.token);
    expect(await subscribe(bobSock, project.id)).toEqual({ ok: true });
    expect(await subscribe(bobSock, priv.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await subscribe(bobSock, 'missing')).toEqual({ ok: false, error: 'not_found' });
    const { s: eveSock } = await connect(eve.token); // not in the workspace at all
    expect(await subscribe(eveSock, project.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await new Promise((res) => bobSock.emit('subscribe', { projectId: 42 }, res))).toEqual({ ok: false, error: 'bad_request' });
    const { s: aliceSock } = await connect(alice.token);
    expect(await subscribe(aliceSock, priv.id)).toEqual({ ok: true });
  });

  it('streams created, updated, ranked, commented, deleted and moved events', async () => {
    const { s, events } = await connect(bob.token);
    await subscribe(s, project.id);

    const a = await mk('A');
    const created = await waitFor(events, (e) => e.type === 'created');
    expect(created).toMatchObject({ taskKey: 'SYN-1', projectId: project.id, actorId: alice.id });

    await http().patch(api('/tasks/SYN-1')).set(alice.auth).send({ priority: 'HIGH' }).expect(200);
    expect(await waitFor(events, (e) => e.type === 'updated' && !!e.fields?.includes('priority'))).toMatchObject({ taskKey: 'SYN-1' });

    await mk('B');
    const doing = project.statuses.find((x) => x.name === 'In Progress')!.id;
    await http().post(api('/tasks/SYN-2/rank')).set(alice.auth).send({ statusId: doing }).expect(200);
    expect(await waitFor(events, (e) => e.type === 'ranked')).toMatchObject({ taskKey: 'SYN-2', statusId: doing });

    await http().post(api('/tasks/SYN-1/comments')).set(alice.auth).send({ body: 'hi' }).expect(201);
    await waitFor(events, (e) => e.type === 'commented');

    await http().delete(api(`/tasks/${a.key}`)).set(alice.auth).expect(204);
    expect(await waitFor(events, (e) => e.type === 'deleted')).toMatchObject({ taskKey: 'SYN-1' });

    const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
    await http().post(api('/tasks/SYN-2/move')).set(alice.auth).send({ projectId: ops.id }).expect(200);
    expect(await waitFor(events, (e) => e.type === 'moved_out')).toMatchObject({ projectId: project.id, actorId: alice.id });
  });

  it('delivers events only to the project room that was subscribed', async () => {
    const ops = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Ops', key: 'OPS' })).body;
    const { s: a, events: aEvents } = await connect(alice.token);
    const { s: b, events: bEvents } = await connect(bob.token);
    await subscribe(a, project.id);
    await subscribe(b, ops.id);
    await mk('In SYN');
    await waitFor(aEvents, (e) => e.type === 'created' && e.projectId === project.id);
    await quiet();
    expect(bEvents.filter((e) => e.projectId === project.id)).toEqual([]);

    await mk('In OPS', {}, ops.id);
    await waitFor(bEvents, (e) => e.type === 'created' && e.projectId === ops.id);
    await quiet();
    expect(aEvents.filter((e) => e.projectId === ops.id)).toEqual([]);

    // unsubscribing stops the flow
    await new Promise((res) => a.emit('unsubscribe', { projectId: project.id }, res));
    const before = aEvents.length;
    await mk('Again');
    await quiet(400);
    expect(aEvents.length).toBe(before);
  });

  it('drops sockets whose access token expires', async () => {
    // a JWT that is valid right now but expires in ~1 second
    const { JwtService } = await import('@nestjs/jwt');
    const session = await prisma.session.findFirstOrThrow({ where: { userId: alice.id } });
    const short = await new JwtService({}).signAsync(
      { sub: alice.id, sid: session.id }, { secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me', expiresIn: 1 },
    );
    const { s } = await connect(short);
    const closed = new Promise<string>((res) => s.on('disconnect', res));
    expect(await Promise.race([closed, quiet(4000).then(() => 'still open')])).toBe('io server disconnect');
  }, 15_000);
});
