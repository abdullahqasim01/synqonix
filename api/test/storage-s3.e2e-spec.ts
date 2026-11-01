import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import S3rver from 's3rver';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { S3Storage } from '../src/storage/s3-storage.js';
import { createTestApp, createWorkspace, signUp, type TestUser, resetDatabase } from './helpers.js';

// The app reads its configuration when its modules are first imported, so set it before the imports below run.
vi.hoisted(() => {
  Object.assign(process.env, {
    STORAGE_DRIVER: 's3', S3_ENDPOINT: 'http://127.0.0.1:4569', S3_BUCKET: 'synqonix-test', S3_ACCESS_KEY_ID: 'S3RVER', S3_SECRET_ACCESS_KEY: 'S3RVER',
  });
});

const PORT = 4569;
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const cfg = {
  S3_ENDPOINT: ENDPOINT, S3_REGION: 'us-east-1', S3_BUCKET: 'synqonix-test', S3_ACCESS_KEY_ID: 'S3RVER', S3_SECRET_ACCESS_KEY: 'S3RVER',
  S3_FORCE_PATH_STYLE: '1' as const, PRESIGN_TTL_SECONDS: 120,
};

describe('S3 storage (against an S3-compatible server)', () => {
  let server: S3rver;
  let dir: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 's3rver-'));
    server = new S3rver({ port: PORT, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: cfg.S3_BUCKET, configs: [] }] });
    await server.run();
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = saved;
  });

  describe('driver', () => {
    const storage = new S3Storage(cfg);

    it('hands out presigned links that sign the size and type', async () => {
      const up = await storage.presignUpload('ws/task/file-1', 5);
      const u = new URL(up.url);
      expect(u.origin).toBe(ENDPOINT);
      expect(u.pathname).toBe('/synqonix-test/ws/task/file-1');
      expect(u.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(u.searchParams.get('X-Amz-Expires')).toBe('120');
      // Size and type are part of the signature, and no checksum parameters that S3-compatible services reject.
      expect(u.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-length/);
      expect(u.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-type/);
      expect([...u.searchParams.keys()].some((k) => /checksum/i.test(k))).toBe(false);
      expect(up.headers).toEqual({ 'Content-Type': 'application/octet-stream' });

    });

    it('round-trips a file: PUT to the link, head, GET from the link as an attachment, delete', async () => {
      const body = Buffer.from('hello from s3');
      const up = await storage.presignUpload('ws/round/trip', body.length);
      const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body });
      expect(put.status).toBe(200);
      expect(await storage.head('ws/round/trip')).toEqual({ size: body.length });

      const dl = await storage.presignDownload('ws/round/trip', 'résumé "final".txt');
      const res = await fetch(dl.url);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('hello from s3');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.txt");
      expect(res.headers.get('content-type')).toBe('application/octet-stream');

      await storage.delete('ws/round/trip');
      expect(await storage.head('ws/round/trip')).toBeNull();
    });

    it('reports a missing object as null', async () => {
      expect(await storage.head('nothing/here')).toBeNull();
    });
  });

  describe('through the API with STORAGE_DRIVER=s3', () => {
    let app: NestExpressApplication;
    let alice: TestUser;
    let bob: TestUser;
    let ws: string;
    let taskKey: string;
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      let mail, prisma;
      ({ app, mail, prisma } = await createTestApp());
      await resetDatabase(prisma);
      alice = await signUp(app, 'S3_Alice');
      bob = await signUp(app, 'S3_Bob');
      ws = await createWorkspace(app, mail, alice, [[bob, 'MEMBER']]);
      const project = (await http().post(`/api/v1/workspaces/${ws}/projects`).set(alice.auth).send({ name: 'Files', key: 'FIL' }).expect(201)).body;
      taskKey = (await http().post(`/api/v1/workspaces/${ws}/projects/${project.id}/tasks`).set(alice.auth).send({ title: 'With a file' }).expect(201)).body.key;
    });
    afterAll(() => app.close());

    it('uploads and downloads only through links that point at the bucket', async () => {
      const base = `/api/v1/workspaces/${ws}/tasks/${taskKey}/attachments`;
      const target = (await http().post(`${base}/upload-url`).set(bob.auth).send({ filename: 'plan.pdf', size: 9, mimeType: 'application/pdf' }).expect(201)).body;
      expect(target.uploadUrl.startsWith(ENDPOINT)).toBe(true);

      // Nothing uploaded yet: confirming is refused.
      await http().post(base).set(bob.auth).send({ uploadToken: target.uploadToken }).expect(400);

      const put = await fetch(target.uploadUrl, { method: 'PUT', headers: target.headers, body: Buffer.from('pdf-bytes') });
      expect(put.status).toBe(200);
      const att = (await http().post(base).set(bob.auth).send({ uploadToken: target.uploadToken }).expect(201)).body;
      expect(att).toMatchObject({ filename: 'plan.pdf', mimeType: 'application/pdf', size: 9 });

      const link = (await http().get(`${base}/${att.id}/download-url`).set(alice.auth).expect(200)).body as { url: string };
      expect(link.url.startsWith(ENDPOINT)).toBe(true);
      const res = await fetch(link.url);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('pdf-bytes');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);

      // The API has no route that serves file bytes in this mode, and the local endpoints do not exist.
      await http().get('/api/v1/storage/local/download?token=x').expect(404);
      await http().delete(`${base}/${att.id}`).set(bob.auth).expect(204);
      const gone = await fetch(link.url);
      expect(gone.status).toBe(404);
    });

    it('rejects a file whose size differs from what was announced and removes it', async () => {
      const base = `/api/v1/workspaces/${ws}/tasks/${taskKey}/attachments`;
      const target = (await http().post(`${base}/upload-url`).set(bob.auth).send({ filename: 'a.txt', size: 3 }).expect(201)).body;
      // An S3-compatible service enforces the signed length; if one does not, the API's own check catches it.
      const put = await fetch(target.uploadUrl, { method: 'PUT', headers: target.headers, body: Buffer.from('longer than announced') });
      if (put.status === 200) await http().post(base).set(bob.auth).send({ uploadToken: target.uploadToken }).expect(400);
      else expect(put.status).toBeGreaterThanOrEqual(400);
    });
  });
});
