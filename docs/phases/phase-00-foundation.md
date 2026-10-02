# Phase 0 – Foundation

**Goal:** three runnable, independent apps with a database and CI, ready for features.

## Tasks
- [x] `docker-compose.yml`: Postgres 16 and Mailpit (local SMTP/inbox for dev).
- [x] `api/`: NestJS app (`npm init`/Nest CLI), own `package.json`.
  - Config module (env validation), Prisma setup, health endpoint, global validation pipe, exception filter, request logging, Swagger/OpenAPI at `/docs` and exported to `openapi.json`.
  - Versioned routes (`/api/v1`), CORS, rate limiting, Helmet.
- [x] `web/`: Next.js app, own `package.json`; Tailwind, shadcn/ui, theme (light/dark), base layout, typed API client generated from `api/openapi.json`.
- [x] `vscode-extension/`: extension skeleton (esbuild bundle, `activate`, hello command), own `package.json`.
- [x] Per-app: ESLint, Prettier, `.env.example`, `README`, test runner (Jest for api, Vitest/Jest for web, `@vscode/test-electron` for extension).
- [x] GitHub Actions: lint + test + build per app (path-filtered).
- [x] Root `.gitignore`, `.editorconfig`, `CONTRIBUTING.md`.

## Acceptance
- `docker compose up -d` then `npm run start:dev` (api) and `npm run dev` (web) both work.
- Health check returns OK and touches the DB.
- No root `package.json`; each app installs on its own with `npm ci`.

## Status: done

Notes / deviations:
- Generated with current tooling: Nest 12 (ESM, Vitest, oxlint), Next 16, Prisma 7 (driver adapter `@prisma/adapter-pg`, config in `api/prisma.config.ts`, client generated to `api/src/generated`, git-ignored and rebuilt by `postinstall`).
- `api/.npmrc` sets `legacy-peer-deps=true` so `npm ci` is reproducible.
- shadcn registry was unreachable when scaffolding, so `web/components.json` and the first components are hand-written in the shadcn style; add more with `npx shadcn add`.
- Web uses a system font stack (no build-time Google Fonts fetch).
- Extension unit tests use Vitest; `@vscode/test-electron` integration tests are added in phase 10.
- Local verification used a native Postgres 16 because Docker was unavailable in the dev sandbox; CI uses a Postgres service container.
