import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** URL-safe random token with 256 bits of entropy. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
