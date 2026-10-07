import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/setup-app.js';
import { createTestApp, createWorkspace, signUp, type FakeMailService, type TestUser, resetDatabase } from './helpers.js';

const UUID = '00000000-0000-4000-8000-000000000000';
type Route = { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string };

/** Routes that are meant to be reachable without logging in. Adding a public route must be a conscious change here. */
const PUBLIC = new Set([
  'post /api/v1/auth/register', 'post /api/v1/auth/login', 'post /api/v1/auth/refresh', 'post /api/v1/auth/logout',
  'post /api/v1/auth/verify-email', 'post /api/v1/auth/resend-verification', 'post /api/v1/auth/forgot-password', 'post /api/v1/auth/reset-password',
  'get /api/v1/invitations/{token}', 'get /api/v1/health', 'get /api/v1/health/live', 'get /api/v1/health/ready',
]);
// POST /github/webhooks and GET /github/setup are public too, but hidden from the OpenAPI document
// (GitHub calls the first with an HMAC signature; the second is a redirect), so they are covered by github.e2e-spec.ts.

describe('Security matrix (e2e)', () => {
  let app: NestExpressApplication;
  let mail: FakeMailService;
  let owner: TestUser;
  let outsider: TestUser;
  let ws: string;
  let routes: Route[];
  const http = () => request(app.getHttpServer());

  const fill = (path: string, workspaceId: string) =>
    path.replace(/\{(\w+)\}/g, (_, name: string) => (name === 'workspaceId' ? workspaceId : UUID));

  beforeAll(async () => {
    let prisma;
    ({ app, mail, prisma } = await createTestApp());
    await resetDatabase(prisma);
    owner = await signUp(app, 'Sec_Owner');
    outsider = await signUp(app, 'Sec_Outsider');
    ws = await createWorkspace(app, mail, owner);
    const doc = buildOpenApi(app);
    routes = Object.entries(doc.paths).flatMap(([path, item]) =>
      (['get', 'post', 'put', 'patch', 'delete'] as const).filter((m) => item?.[m]).map((method) => ({ method, path })),
    );
  });
  afterAll(() => app.close());

  it('documents a meaningful number of routes', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every route requires authentication unless it is on the public list', async () => {
    const open: string[] = [];
    for (const r of routes) {
      const id = `${r.method} ${r.path}`;
      if (PUBLIC.has(id)) continue;
      const res = await http()[r.method](fill(r.path, ws)).send({});
      if (res.status !== 401) open.push(`${id} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('public routes on the list really exist (the list does not rot)', () => {
    const known = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const id of PUBLIC) expect(known.has(id), id).toBe(true);
  });

  it("a signed-in outsider can touch nothing inside someone else's workspace", async () => {
    const leaked: string[] = [];
    for (const r of routes.filter((x) => x.path.includes('{workspaceId}'))) {
      const res = await http()[r.method](fill(r.path, ws)).set(outsider.auth).send({});
      // Anything but a refusal or "not found" is a leak (a 2xx) or a crash (5xx).
      if (![401, 403, 404].includes(res.status)) leaked.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(leaked).toEqual([]);
  });

  it('no route answers 5xx to empty or malformed input from a member', async () => {
    const crashed: string[] = [];
    for (const r of routes.filter((x) => x.path.includes('{workspaceId}') && x.method !== 'delete')) {
      const res = await http()[r.method](fill(r.path, ws)).set(owner.auth).send({ junk: [1, { a: null }] });
      if (res.status >= 500) crashed.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(crashed).toEqual([]);
  });
});

describe('Observability (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { ({ app } = await createTestApp()); });
  afterAll(() => app.close());

  it('gives each request an id and keeps a sane one from the caller', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app.getHttpServer()).get('/api/v1/health/live').set('X-Request-Id', 'trace-12345678');
    expect(b.headers['x-request-id']).toBe('trace-12345678');
    const c = await request(app.getHttpServer()).get('/api/v1/health/live').set('X-Request-Id', 'bad id <script>');
    expect(c.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('liveness and readiness answer; metrics are off without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
  });

  it('sends security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
