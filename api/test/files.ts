import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

/** Runs the presigned upload flow the web app uses: ask for a link, PUT the bytes to it, confirm. */
export async function uploadFile(
  app: NestExpressApplication, base: string, auth: { Authorization: string }, content: Buffer, filename: string,
  opts: { mimeType?: string; announcedSize?: number } = {},
) {
  const http = () => request(app.getHttpServer());
  const target = (await http().post(`${base}/upload-url`).set(auth).send({ filename, size: opts.announcedSize ?? content.length, mimeType: opts.mimeType }).expect(201)).body;
  const url = new URL(target.uploadUrl);
  // The link is meant for the browser alone: it carries its own credential, never our Authorization header.
  await http().put(url.pathname + url.search).set(target.headers).send(content).expect(200);
  return { target, confirm: () => http().post(base).set(auth).send({ uploadToken: target.uploadToken }) };
}

/** Asks for a presigned download link, then fetches the bytes from it. */
export async function downloadFile(app: NestExpressApplication, downloadUrlEndpoint: string, auth: { Authorization: string }) {
  const http = () => request(app.getHttpServer());
  const link = (await http().get(downloadUrlEndpoint).set(auth).expect(200)).body as { url: string };
  const url = new URL(link.url);
  return await http().get(url.pathname + url.search).buffer().parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
}
