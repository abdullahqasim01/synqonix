import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const key = (secret: string) => createHash('sha256').update(`webhook-secrets:${secret}`).digest();

/** AES-256-GCM, `iv.tag.ciphertext` in base64url, so a leaked database does not leak signing secrets. */
export function encryptSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(appSecret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(stored: string, appSecret: string): string {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(appSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** `X-Synqonix-Signature` value: HMAC-SHA256 over `<timestamp>.<body>`, so a captured request cannot be replayed with a new time. */
export const signPayload = (secret: string, timestamp: number, body: string) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

export function verifySignature(secret: string, timestamp: number, body: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
