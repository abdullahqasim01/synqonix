# Deploying on free tiers

Vercel (web) · Northflank (API) · Neon (Postgres) · Resend (email) · Filebase (S3-compatible files) · one domain name.

Free-tier limits change. The numbers below are what each provider advertised when this was written; **check each pricing page before you rely on them.**

## Before you start

| What | Why |
|---|---|
| A **domain name** (about $10/year) | Resend only sends to arbitrary addresses from a domain you have verified, and one parent domain for web + API avoids cross-site problems. It is the only unavoidable cost. |
| A GitHub repo with this code | Vercel and Northflank both build from it. |
| **Vercel plan check** | Vercel's free *Hobby* plan is for personal, non-commercial use. An organization's internal tool normally needs *Pro*. If you want to stay at zero cost, host the web app on Northflank too (`web/Dockerfile`) or on Cloudflare Pages. |

Use the same region (or close ones) everywhere, for example `eu-west` or `us-east`, to keep latency down.

Create the services in this order, because each step produces values the next one needs.

---

## 1. Neon (database)

1. Create a project (Postgres 17) and a database.
2. Open **Connection details** and copy the **direct** connection string (host *without* `-pooler`) and append `?sslmode=require` if it is missing.
   ```
   postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require
   ```
   Use the direct string for `DATABASE_URL`. Migrations (`prisma migrate deploy`, which the API container runs on every start) need a direct connection, and a single API instance does not need pooling.
3. Nothing else: the API creates the tables itself on first start.

Things to know:
- **Compute hours.** Neon's free plan has a monthly compute allowance and normally suspends an idle database. This app runs background jobs every minute (webhook retries, recurring tasks), so the database will rarely go idle and will use hours continuously. Watch **Usage** in the Neon console during the first weeks. If the allowance runs out, the database is suspended until the next month. The scheduler frequency can be reduced later if that happens.
- **Backups.** Free-plan point-in-time restore covers only a short window. Add the scheduled dump in section 8.

## 2. Filebase (files)

1. Create a **bucket** (for example `synqonix-files`). Keep it **private**. If Filebase asks for a storage network, prefer a non-IPFS one for private files (IPFS objects are content-addressed); check what your plan offers.
2. **Access Keys** → create a key pair. Note the key and secret.
3. Allow the browser to talk to the bucket (**CORS**). Browsers upload straight to Filebase with a `PUT`, so the bucket must allow your web address. In the bucket's CORS settings, or with the AWS CLI:
   ```bash
   cat > cors.json <<'JSON'
   { "CORSRules": [{
       "AllowedOrigins": ["https://app.example.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3000
   }] }
   JSON
   AWS_ACCESS_KEY_ID=KEY AWS_SECRET_ACCESS_KEY=SECRET \
     aws s3api put-bucket-cors --bucket synqonix-files --cors-configuration file://cors.json --endpoint-url https://s3.filebase.com
   ```
   Use your real web origin (no trailing slash). Add `http://localhost:3000` while testing locally.
4. Values for the API: `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://s3.filebase.com`, `S3_REGION=us-east-1`, `S3_BUCKET=synqonix-files`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=1`.

How files move: the browser asks the API for a presigned link (the API checks permissions and the size limit), `PUT`s the file to Filebase with that link, then tells the API it is done; the API checks the object exists and has the announced size before it shows up on the task. Downloads are the same in reverse: a short-lived presigned link, served as an attachment. The API never carries file bytes, and the bucket never needs public read or write. Links expire after `PRESIGN_TTL_SECONDS` (300 s).

Abandoned uploads (a browser that closed after the `PUT` but before the confirmation) leave an object with no database row. They are small; delete them occasionally or add a lifecycle rule if Filebase offers one.

## 3. Resend (email)

1. Add your domain under **Domains** and create the DNS records Resend shows (SPF, DKIM, optionally DMARC). Wait until it says *Verified*.
2. **API Keys** → create a key with *Sending access*.
3. API values: `RESEND_API_KEY=re_…`, `MAIL_FROM=Synqonix <no-reply@yourdomain.com>`.

Free-plan limits (about 100 emails/day) are plenty for verification, reset and notification emails of one team. Without a verified domain Resend only delivers to your own address.

## 4. Northflank (API)

1. Create a project in a region near the database. Add a **Combined service** (build + deploy) from your GitHub repo:
   - Build type: **Dockerfile**, Dockerfile path `/api/Dockerfile`, build context `/api`.
   - Port `4000`, protocol **HTTP**, publicly exposed. Northflank gives you a `https://….code.run` address (add your own domain under **Domains** if you like, for example `api.yourdomain.com`).
   - Health check: HTTP `GET /api/v1/health/live` on port 4000 for liveness, `/api/v1/health/ready` for readiness.
   - Plan: the free **sandbox** resources. Keep **one** instance (see *Scaling* in `docs/deployment.md`).
2. Add the environment as a **secret group** attached to the service:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Neon **direct** string (section 1) |
   | `WEB_URL` | your web address, exactly, e.g. `https://app.yourdomain.com` (no trailing slash; it is the CORS origin and the base of emailed links) |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different random strings: `openssl rand -base64 48` |
   | `STORAGE_DRIVER`, `S3_*` | Filebase values (section 2) |
   | `RESEND_API_KEY`, `MAIL_FROM` | Resend values (section 3) |
   | `TRUST_PROXY` | `1` |
   | `METRICS_TOKEN` | optional, 16+ characters |
   | `GITHUB_*` | optional, see GitHub App below |

   Do **not** set `UPLOAD_DIR`; with the S3 driver nothing is written to disk, which matters because Northflank's container disk is wiped on each deploy.
3. Deploy. The container runs `prisma migrate deploy` and then starts. Check `https://API/api/v1/health/ready` returns `{"status":"ok","db":"up"}`. The API refuses to start in production with development secrets or a `localhost` `WEB_URL`; the logs say which setting is wrong.

## 5. Vercel (web)

1. Import the repo. **Root directory:** `web`. Framework: Next.js (detected).
2. Environment variables (all environments):
   - `NEXT_PUBLIC_API_URL` = your API address (`https://….code.run` or `https://api.yourdomain.com`)
   - `NEXT_PUBLIC_STORAGE_URL` = `https://s3.filebase.com` (so the Content-Security-Policy lets the browser upload there)
3. Deploy, then add your domain (`app.yourdomain.com`) under **Domains**. `NEXT_PUBLIC_*` values are compiled in, so changing them needs a redeploy.
4. Go back to Northflank and make sure `WEB_URL` equals the final web address, and to Filebase to put that address in the CORS rules.

## 6. DNS summary

| Name | Points to |
|---|---|
| `app.yourdomain.com` | Vercel (CNAME it shows) |
| `api.yourdomain.com` (optional) | Northflank (CNAME it shows) |
| Resend records | SPF/DKIM TXT records shown by Resend |

## 7. First run

1. Open the web app, register (first user), create the workspace, invite people.
2. Open the verification email (proves Resend works), attach a file to a task and download it (proves Filebase and CORS work).
3. Optional demo data: `SYNQONIX_API=https://API node api/scripts/seed-demo.mjs`.

**GitHub App (optional).** Create the app as described in `docs/github-integration.md`; webhook URL `https://API/api/v1/github/webhooks`, then set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` on the service.

## 8. Backups (free, GitHub Actions)

A nightly `pg_dump` into a separate bucket (or a different prefix) gives you a restore point beyond Neon's free window. Add repository secrets `NEON_DIRECT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and a bucket `synqonix-backups`:

```yaml
# .github/workflows/backup.yml
name: Database backup
on:
  schedule: [{ cron: "17 2 * * *" }]
  workflow_dispatch:
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - name: Dump (client version must match the server: 17)
        run: docker run --rm -e DB="${{ secrets.NEON_DIRECT_URL }}" postgres:17 sh -c 'pg_dump -Fc "$DB"' > synqonix.dump
      - name: Upload
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.S3_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.S3_SECRET_ACCESS_KEY }}
        run: aws s3 cp synqonix.dump "s3://synqonix-backups/$(date +%F).dump" --endpoint-url https://s3.filebase.com
```

Restore: `pg_restore --clean --if-exists --no-owner -d "$DIRECT_URL" file.dump`. Test a restore once. The files themselves live in the files bucket; copy it periodically too if losing attachments matters.

## 9. Optional extras (all free tiers)

- **Uptime check:** UptimeRobot or Better Stack on `https://API/api/v1/health/ready`.
- **Error tracking:** Sentry, hooked into `api/src/common/all-exceptions.filter.ts`.
- **Metrics:** set `METRICS_TOKEN` and scrape `/api/v1/metrics`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Upload fails with "Could not reach file storage" | The bucket's CORS rules do not include your web origin, or `NEXT_PUBLIC_STORAGE_URL` is missing so the browser's CSP blocked the request (the browser console says which). |
| "The upload link was rejected or has expired" | The link is older than `PRESIGN_TTL_SECONDS`, or the server clock is far off. Try again. |
| Upload works but the file never appears | The confirmation failed: check the API log for the request id; size mismatch or object missing. |
| Browser shows CORS errors calling the API | `WEB_URL` on the API is not exactly the web address (scheme, host, no trailing slash). |
| API container restarts at boot | A production-config check failed (secrets, `WEB_URL`) or `DATABASE_URL` is wrong; see the first log lines. |
| Migrations fail or hang | `DATABASE_URL` uses Neon's pooled host; use the direct one. |
| No emails arrive | Resend domain not verified yet, or `MAIL_FROM` is not on the verified domain. |
| Database "suspended" / quota messages | Neon's free compute hours are used up; see section 1. |
