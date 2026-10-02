import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Synqonix <no-reply@synqonix.local>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  // GitHub App (integration is switched off while these are unset).
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  /** PEM private key; `\n` escapes are accepted so it fits on one line. */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  /** Let webhooks target private/loopback addresses and plain http (for local development only). */
  WEBHOOKS_ALLOW_PRIVATE_TARGETS: z.enum(['0', '1']).default('0'),
  /** Days to keep records before the nightly cleanup deletes them; 0 keeps them forever. */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(365),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  /** Number of reverse-proxy hops in front of the API, so rate limits and logs see the real client IP. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** `json` writes one structured line per request and error (default in production). */
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  /** Enables GET /metrics for a scraper presenting `Authorization: Bearer <token>`. Unset: the endpoint is off. */
  METRICS_TOKEN: z.string().min(16).optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(config: Record<string, unknown>): Env {
  // docker compose passes unset optional variables as empty strings; treat those as not set.
  const cleaned: Record<string, unknown> = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (!(key in cleaned) || /change-me/.test(env[key])) problems.push(`${key} must be set to a private value`);
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) problems.push('the two JWT secrets must differ');
    if (/localhost|127\.0\.0\.1/.test(env.WEB_URL)) problems.push('WEB_URL must be the public address of the web app');
    if (problems.length) throw new Error(`Invalid production environment: ${problems.join('; ')}`);
  }
  return env;
}
