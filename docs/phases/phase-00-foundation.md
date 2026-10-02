# Phase 0 – Foundation

**Goal:** three runnable, independent apps with a database and CI, ready for features.

## Tasks
- [ ] `docker-compose.yml`: Postgres 16 and Mailpit (local SMTP/inbox for dev).
- [ ] `api/`: NestJS app (`npm init`/Nest CLI), own `package.json`.
  - Config module (env validation), Prisma setup, health endpoint, global validation pipe, exception filter, request logging, Swagger/OpenAPI at `/docs` and exported to `openapi.json`.
  - Versioned routes (`/api/v1`), CORS, rate limiting, Helmet.
- [ ] `web/`: Next.js app, own `package.json`; Tailwind, shadcn/ui, theme (light/dark), base layout, typed API client generated from `api/openapi.json`.
- [ ] `vscode-extension/`: extension skeleton (esbuild bundle, `activate`, hello command), own `package.json`.
- [ ] Per-app: ESLint, Prettier, `.env.example`, `README`, test runner (Jest for api, Vitest/Jest for web, `@vscode/test-electron` for extension).
- [ ] GitHub Actions: lint + test + build per app (path-filtered).
- [ ] Root `.gitignore`, `.editorconfig`, `CONTRIBUTING.md`.

## Acceptance
- `docker compose up -d` then `npm run start:dev` (api) and `npm run dev` (web) both work.
- Health check returns OK and touches the DB.
- No root `package.json`; each app installs on its own with `npm ci`.
