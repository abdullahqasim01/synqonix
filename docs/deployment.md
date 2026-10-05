# Deploying Synqonix

Three pieces: **Postgres 17.9**, the **API** (NestJS, port 4000) and the **web app** (Next.js, port 3000). Both apps ship a Dockerfile; `docker-compose.prod.yml` wires them together.

## From scratch

1. **Server**: any host with Docker and Compose. Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front, with two public names, e.g. `app.example.com` → web:3000 and `api.example.com` → api:4000. The proxy must pass WebSocket upgrades to the API (chat and live updates use socket.io on the same port).
2. **Configuration**: each app has its own env file. `cp api/.env.production.example api/.env.production` and `cp web/.env.production.example web/.env.production`, then fill them in (see the table below). Generate secrets with `openssl rand -base64 48`. The Postgres container takes its password from `POSTGRES_PASSWORD` in `api/.env.production`, which must match the password inside `DATABASE_URL` there.
3. **Start**: `docker compose -f docker-compose.prod.yml up -d --build`. The API container applies database migrations on start (`prisma migrate deploy`), and refuses to boot in production with development secrets or a `localhost` `WEB_URL`.
4. **Check**: `curl https://api.example.com/api/v1/health/ready` → `{"status":"ok","db":"up",…}`; open `https://app.example.com` and register. The first user creates the first workspace.
5. **Optional demo data** (not for real installs): `SYNQONIX_API=https://api.example.com node api/scripts/seed-demo.mjs`.

`NEXT_PUBLIC_API_URL` (in `web/.env.production`) is compiled into the web bundle, so changing it needs `up -d --build web`.

## Environment reference (API)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | – (required) | Postgres connection string |
| `NODE_ENV` | `development` | `production` turns on JSON logs and the secret checks |
| `PORT` | `4000` | |
| `WEB_URL` | `http://localhost:3000` | Public web address; CORS origin and the base of emailed links. Must not be localhost in production |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | dev values | Required and different in production, 16+ chars |
| `JWT_ACCESS_TTL_SECONDS` / `REFRESH_TTL_DAYS` | `900` / `30` | |
| `TRUST_PROXY` | `0` | Reverse-proxy hops; set to `1` behind one proxy so rate limits and logs use the client IP |
| `LOG_FORMAT` | `json` in production | `json` or `pretty` |
| `METRICS_TOKEN` | unset | 16+ chars; enables `GET /api/v1/metrics` for `Authorization: Bearer …` |
| `RESEND_API_KEY`, `MAIL_FROM` | – | Email via Resend; without a key the API uses SMTP (`SMTP_HOST`/`SMTP_PORT`, default Mailpit) |
| `STORAGE_DRIVER` | `local` | `local` (container disk, mount a volume at `/app/uploads`) or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | – / `us-east-1` / – / – / – / `1` | Any S3-compatible bucket (required with `s3`). The bucket stays private: every upload and download uses a presigned link |
| `PRESIGN_TTL_SECONDS` | `300` | How long a presigned link works |
| `API_PUBLIC_URL` | `http://localhost:PORT` | Used only for the local driver's links |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | `./uploads`, `10` | Local-driver folder; the size limit applies to both drivers |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | unset | GitHub integration is off until set (Phase 7) |
| `AUDIT_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS`, `DELIVERY_RETENTION_DAYS` | `365`, `90`, `30` | `0` keeps forever |
| `WEBHOOKS_ALLOW_PRIVATE_TARGETS` | `0` | Development only |

Web: `NEXT_PUBLIC_STORAGE_URL` (origin of the S3 endpoint; lets the browser upload to it under the Content-Security-Policy), `NEXT_PUBLIC_API_URL` in `web/.env.production` (read at build time), nothing else. Both `.env.production` files are git-ignored.

## Upgrades and migrations

- Migrations are forward-only SQL files in `api/prisma/migrations`, applied automatically on API start. To run them as a separate step, set `SKIP_MIGRATIONS=1` on the API and run `docker compose run --rm api npx prisma migrate deploy` first.
- Take a backup before upgrading (below). Roll back by restoring the backup and starting the previous image tag; migrations are not reversed automatically.
- Rolling deploys: new API versions should be started after migrations; migrations in this repository are additive (new tables/columns/indexes).
- Run **one** API instance unless you add a shared socket.io adapter: realtime rooms and the in-process schedulers (recurring tasks, webhook retries, retention) assume a single process. Claims are compare-and-set so an accidental second instance will not double-send, but live updates would only reach clients connected to the same instance.

## Backups

- **Database**: `docker compose exec postgres pg_dump -U synqonix -Fc synqonix > synqonix-$(date +%F).dump`; restore with `pg_restore --clean --if-exists -d synqonix`. Schedule it (cron) and copy off the host; test a restore.
- **Uploads**: with the S3 driver the bucket holds the files (enable versioning or copy it elsewhere if you need backups); with the local driver back up the `uploads` volume (attachments and chat files) together with the database dump, since rows refer to files.
- Postgres WAL archiving / managed point-in-time recovery is preferable for production data; the dump is the minimum.

## Observability

- Logs: one JSON line per request (`requestId`, method, path without query string, status, ms, `userId`) and per unhandled error (with stack). Clients see only `Internal server error` plus a `requestId` to quote; search the logs for it. Request and response bodies, headers and query strings are never logged. Send an `X-Request-Id` from the proxy to carry a trace id through.
- Probes: `GET /api/v1/health/live` (process) and `/health/ready` (database). The Docker images use `live`.
- Metrics: set `METRICS_TOKEN` and scrape `/api/v1/metrics` (request counts by method and status class, request time, memory, uptime).
- Error tracking: unhandled errors go through one filter (`api/src/common/all-exceptions.filter.ts`); attach Sentry or similar there.

For a zero-cost hosted setup (Vercel + Northflank + Neon + Resend + Filebase) see [deploy-free-tier.md](deploy-free-tier.md).
