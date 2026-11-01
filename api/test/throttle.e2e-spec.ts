import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from './helpers.js';

let app: NestExpressApplication;
beforeAll(async () => ({ app } = await createTestApp({ throttle: true })));
afterAll(() => app.close());

it('rate limits repeated login attempts', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });
    codes.push(res.status);
  }
  expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  expect(codes.slice(10)).toEqual([429, 429]);
});

it('does not rate limit (or break) websocket traffic', async () => {
  const { io } = await import('socket.io-client');
  await app.listen(0);
  const port = (app.getHttpServer().address() as import('node:net').AddressInfo).port;
  const email = `ws${Date.now()}@example.com`;
  // register is throttled per route, one call is well within the limit
  const reg = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, name: 'W', password: 'correct horse battery' }).expect(201);
  const socket = io(`http://127.0.0.1:${port}`, { auth: { token: reg.body.accessToken }, transports: ['websocket'], reconnection: false });
  await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  for (let i = 0; i < 150; i++) {
    const ack = await new Promise<{ ok: boolean }>((res) => socket.emit('subscribe', { projectId: 'x' }, res));
    expect(ack.ok).toBe(false); // answered normally, never throttled
  }
  socket.close();
});
