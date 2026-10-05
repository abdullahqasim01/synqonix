import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://x' });
    expect(env.PORT).toBe(4000);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe('validateEnv in production', () => {
  const ok = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', WEB_URL: 'https://app.example.com',
    JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  it('accepts a complete configuration', () => {
    expect(validateEnv(ok).NODE_ENV).toBe('production');
  });

  it('refuses the development secrets and a localhost web address', () => {
    expect(() => validateEnv({ ...ok, JWT_ACCESS_SECRET: undefined })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...ok, JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me' })).toThrow(/JWT_REFRESH_SECRET/);
    expect(() => validateEnv({ ...ok, JWT_REFRESH_SECRET: ok.JWT_ACCESS_SECRET })).toThrow(/differ/);
    expect(() => validateEnv({ ...ok, WEB_URL: 'http://localhost:3000' })).toThrow(/WEB_URL/);
  });
});

describe('validateEnv with empty values', () => {
  it('treats empty strings as unset', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://x', METRICS_TOKEN: '', RESEND_API_KEY: '', PORT: '' });
    expect(env.METRICS_TOKEN).toBeUndefined();
    expect(env.PORT).toBe(4000);
  });
});

describe('validateEnv storage', () => {
  it('defaults to local disk and wants credentials for s3', () => {
    expect(validateEnv({ DATABASE_URL: 'postgresql://x' }).STORAGE_DRIVER).toBe('local');
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x', STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
    const env = validateEnv({ DATABASE_URL: 'postgresql://x', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://s3.filebase.com' });
    expect(env.S3_FORCE_PATH_STYLE).toBe('1');
    expect(env.PRESIGN_TTL_SECONDS).toBe(300);
  });
});
