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
