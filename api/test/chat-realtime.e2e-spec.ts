import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser } from './helpers.js';

interface Msg { type: string; channelId: string; message: { id: string; seq: number; body: string; parentId: string | null; replyCount: number } }

describe('Chat realtime (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let url: string;
  let alice: TestUser, bob: TestUser, carol: TestUser;
  let ws: string;
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
    await prisma.$executeRaw`TRUNCATE "User", "Workspace" CASCADE`;
    [alice, bob, carol] = [await signUp(app, 'Alice'), await signUp(app, 'Bob'), await signUp(app, 'Carol')];
    ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER'], [carol, 'ADMIN']]);
  });
  afterEach(() => { sockets.forEach((s) => s.close()); sockets = []; });

  async function connect(u: TestUser) {
    const s = io(url, { auth: { token: u.token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    const messages: Msg[] = [];
    const typing: { channelId: string; userId: string }[] = [];
    const presence: { userId: string; online: boolean }[] = [];
    const reads: { channelId: string; seq: number }[] = [];
    const changed: unknown[] = [];
    s.on('message', (e: Msg) => messages.push(e));
    s.on('typing', (e) => typing.push(e));
    s.on('presence', (e) => presence.push(e));
    s.on('channel:read', (e) => reads.push(e));
    s.on('channels:changed', (e) => changed.push(e));
    await new Promise<void>((resolve, reject) => { s.on('connect', resolve); s.on('connect_error', reject); });
    // rooms are joined asynchronously after connect
    await new Promise((r) => setTimeout(r, 100));
    return { s, messages, typing, presence, reads, changed };
  }
  const ack = <T>(s: Socket, event: string, body: unknown) => new Promise<T>((res) => s.emit(event, body, res));
  const waitFor = async <T>(list: T[], pred: (e: T) => boolean = () => true, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = list.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out; got ${JSON.stringify(list)}`);
  };
  const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const mkChannel = async (u: TestUser, body: Record<string, unknown>) => (await http().post(api('/channels')).set(u.auth).send(body).expect(201)).body;
  const post = (u: TestUser, ch: string, body: Record<string, unknown>) => http().post(api(`/channels/${ch}/messages`)).set(u.auth).send(body);

  it('delivers messages to followers of a channel and only to them', async () => {
    const priv = await mkChannel(alice, { name: 'core', type: 'PRIVATE', memberIds: [bob.id] });
    const a = await connect(alice), b = await connect(bob), c = await connect(carol);
    await post(alice, priv.id, { body: 'secret plan' }).expect(201);
    const got = await waitFor(b.messages);
    expect(got).toMatchObject({ type: 'created', channelId: priv.id, message: { body: 'secret plan', seq: 1 } });
    await waitFor(a.messages);
    await quiet();
    expect(c.messages).toEqual([]);
    // Carol cannot subscribe to it either
    expect(await ack(c.s, 'channel:subscribe', { workspaceId: ws, channelId: priv.id })).toEqual({ ok: false, error: 'not_found' });
    await post(alice, priv.id, { body: 'second' }).expect(201);
    await quiet();
    expect(c.messages).toEqual([]);
  });

  it('lets people watch a public channel they do not follow after subscribing', async () => {
    const pub = await mkChannel(alice, { name: 'open', type: 'PUBLIC' });
    const b = await connect(bob);
    await post(alice, pub.id, { body: 'before' }).expect(201);
    await quiet();
    expect(b.messages).toEqual([]);
    expect(await ack(b.s, 'channel:subscribe', { workspaceId: ws, channelId: pub.id })).toEqual({ ok: true });
    await post(alice, pub.id, { body: 'after' }).expect(201);
    expect((await waitFor(b.messages)).message.body).toBe('after');
    await ack(b.s, 'channel:unsubscribe', { channelId: pub.id });
    await post(alice, pub.id, { body: 'unheard' }).expect(201);
    await quiet();
    expect(b.messages).toHaveLength(1);
  });

  it('joins rooms live when someone is added, and leaves them when removed', async () => {
    const priv = await mkChannel(alice, { name: 'core', type: 'PRIVATE' });
    const b = await connect(bob);
    await http().post(api(`/channels/${priv.id}/members`)).set(alice.auth).send({ userId: bob.id }).expect(201);
    await waitFor(b.changed);
    await post(alice, priv.id, { body: 'welcome' }).expect(201);
    await waitFor(b.messages, (m) => m.message.body === 'welcome');
    await http().delete(api(`/channels/${priv.id}/members/${bob.id}`)).set(alice.auth).expect(204);
    await quiet();
    await post(alice, priv.id, { body: 'after kick' }).expect(201);
    await quiet();
    expect(b.messages.map((m) => m.message.body)).toEqual(['welcome']);
  });

  it('stops delivering a project channel when the project goes private', async () => {
    const p = (await http().post(api('/projects')).set(alice.auth).send({ name: 'Proj', key: 'PRJ', template: 'SCRUM' }).expect(201)).body;
    const ch = (await http().get(api('/channels')).set(alice.auth).expect(200)).body.find((c: { projectId: string }) => c.projectId === p.id);
    const b = await connect(bob);
    expect(await ack(b.s, 'channel:subscribe', { workspaceId: ws, channelId: ch.id })).toEqual({ ok: true });
    await post(alice, ch.id, { body: 'visible' }).expect(201);
    await waitFor(b.messages);
    await http().patch(api(`/projects/${p.id}`)).set(alice.auth).send({ visibility: 'PRIVATE' }).expect(200);
    await quiet();
    await post(alice, ch.id, { body: 'now hidden' }).expect(201);
    await quiet();
    expect(b.messages.map((m) => m.message.body)).toEqual(['visible']);
  });

  it('emits edits, deletes, reactions and thread replies with the parent refreshed', async () => {
    const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
    await http().post(api(`/channels/${ch.id}/join`)).set(bob.auth).expect(200);
    const b = await connect(bob);
    const root = (await post(alice, ch.id, { body: 'root' }).expect(201)).body;
    await post(alice, ch.id, { body: 'reply', parentId: root.id }).expect(201);
    await http().patch(api(`/channels/${ch.id}/messages/${root.id}`)).set(alice.auth).send({ body: 'root!' }).expect(200);
    await http().put(api(`/channels/${ch.id}/messages/${root.id}/reactions/${encodeURIComponent('🎉')}`)).set(alice.auth).expect(200);
    await http().delete(api(`/channels/${ch.id}/messages/${root.id}`)).set(alice.auth).expect(204);
    await waitFor(b.messages, (m) => m.type === 'deleted');
    const types = b.messages.map((m) => `${m.type}:${m.message.parentId ? 'reply' : 'root'}`);
    expect(types).toEqual(expect.arrayContaining(['created:root', 'created:reply', 'updated:root', 'reactions:root', 'deleted:root']));
    const parentRefresh = b.messages.find((m) => m.type === 'updated' && m.message.replyCount === 1);
    expect(parentRefresh).toBeTruthy();
    // payloads never carry the viewer-specific parts
    const withReaction = b.messages.find((m) => m.type === 'reactions')!;
    expect((withReaction.message as unknown as { reactions: { reacted: boolean }[] }).reactions[0].reacted).toBe(false);
  });

  it('lets a client catch up on what it missed using after=', async () => {
    const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
    const b = await connect(bob);
    await ack(b.s, 'channel:subscribe', { workspaceId: ws, channelId: ch.id });
    await post(alice, ch.id, { body: 'one' }).expect(201);
    await waitFor(b.messages);
    b.s.disconnect();
    await post(alice, ch.id, { body: 'two' }).expect(201);
    await post(alice, ch.id, { body: 'three', parentId: undefined }).expect(201);
    const missed = (await http().get(api(`/channels/${ch.id}/messages?after=1&threads=true`)).set(bob.auth).expect(200)).body.messages;
    expect(missed.map((m: { body: string }) => m.body)).toEqual(['two', 'three']);
  });

  it('relays typing only to people in the channel and throttles it', async () => {
    const priv = await mkChannel(alice, { name: 'core', type: 'PRIVATE', memberIds: [bob.id] });
    const a = await connect(alice), b = await connect(bob), c = await connect(carol);
    expect(await ack(c.s, 'typing', { channelId: priv.id })).toEqual({ ok: false });
    expect(await ack(a.s, 'typing', { channelId: priv.id })).toEqual({ ok: true });
    await ack(a.s, 'typing', { channelId: priv.id });
    expect(await waitFor(b.typing)).toEqual({ channelId: priv.id, userId: alice.id });
    await quiet();
    expect(b.typing).toHaveLength(1);
    expect(c.typing).toEqual([]);
    expect(a.typing).toEqual([]);
  });

  it('tracks who is online in a workspace', async () => {
    const a = await connect(alice);
    const first = await ack<{ ok: boolean; online: string[] }>(a.s, 'presence:subscribe', { workspaceId: ws });
    expect(first).toEqual({ ok: true, online: [alice.id] });
    const b = await connect(bob);
    const second = await ack<{ ok: boolean; online: string[] }>(b.s, 'presence:subscribe', { workspaceId: ws });
    expect(second.online.sort()).toEqual([alice.id, bob.id].sort());
    expect(await waitFor(a.presence, (p) => p.userId === bob.id)).toEqual({ workspaceId: ws, userId: bob.id, online: true });
    // a second tab does not announce again, and closing one tab keeps them online
    const b2 = await connect(bob);
    await ack(b2.s, 'presence:subscribe', { workspaceId: ws });
    b2.s.disconnect();
    await quiet();
    expect(a.presence.filter((p) => p.userId === bob.id)).toHaveLength(1);
    b.s.disconnect();
    expect(await waitFor(a.presence, (p) => p.userId === bob.id && !p.online)).toBeTruthy();
    // not a member of this workspace
    const outsider = await signUp(app, 'Eve');
    const e = await connect(outsider);
    expect(await ack(e.s, 'presence:subscribe', { workspaceId: ws })).toEqual({ ok: false, error: 'not_found' });
  });

  it('syncs read state to the reader\'s other sockets', async () => {
    const ch = await mkChannel(alice, { name: 'dev', type: 'PUBLIC' });
    await http().post(api(`/channels/${ch.id}/join`)).set(bob.auth).expect(200);
    const b1 = await connect(bob), b2 = await connect(bob), a = await connect(alice);
    await post(alice, ch.id, { body: 'hello' }).expect(201);
    await http().post(api(`/channels/${ch.id}/read`)).set(bob.auth).send({}).expect(200);
    expect(await waitFor(b1.reads)).toEqual({ channelId: ch.id, seq: 1 });
    expect(await waitFor(b2.reads)).toEqual({ channelId: ch.id, seq: 1 });
    await quiet();
    expect(a.reads).toEqual([]);
  });
});
