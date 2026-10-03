# Phase 11 – Hardening & Release

- Strict Content-Security-Policy and XSS review for the web app (auth tokens live in localStorage, see phase 1).
- Security review: authZ matrix tests, input validation, rate limits, CSRF/XSS review, secret scanning, dependency audit.
- Performance: indexes, N+1 checks, pagination everywhere, load test of board and search endpoints.
- Observability: structured logs, error tracking, metrics, health/readiness.
- Backups and migrations strategy, seed/demo data.
- Accessibility pass (keyboard, contrast, screen reader) on web.
- Docker images for api and web; deployment docs; environment reference.
- E2E suite (Playwright) for critical flows.
- Publish extension to the VS Code Marketplace (pre-release channel first).
- User docs and onboarding flow.

## Acceptance
- CI green on all three apps, E2E passing, documented deploy from scratch.

---

## Status: done, with the exceptions listed under "Not done"

### Security
- **Authorization matrix test** (`api/test/security.e2e-spec.ts`): reads every route from the generated OpenAPI document and checks that (1) each one answers 401 without credentials unless it is on an explicit public list (the list itself is checked so it cannot rot), (2) a signed-in *outsider* gets only 401/403/404 on every `/workspaces/{id}/…` route of someone else's workspace, and (3) no route crashes (5xx) on junk input from a member. New routes are covered automatically.
- **Production configuration is validated at boot**: the API refuses to start with the development JWT secrets, identical access/refresh secrets, or a `localhost` `WEB_URL`.
- **Errors**: unexpected exceptions return a generic 500 with a `requestId` instead of internals; details go to the log only.
- **Web CSP** (`web/src/proxy.ts`, `web/src/lib/csp.ts`): nonce-based, `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`/`unsafe-eval` in production), `connect-src` limited to the API origin (and its websocket), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action` `'self'`; plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, HSTS and no `X-Powered-By`. Only inline `style=""` attributes are allowed (`style-src-attr`), because charts and colour chips use them. Checked in a real browser: no violations across login, dashboard and the board.
- **XSS review**: user content is rendered through the restricted markdown renderer (covered by tests with `<script>`, `onerror`, `javascript:` payloads); there is no `dangerouslySetInnerHTML` in the web app; the extension's task page uses its own escaping and CSP. Tokens stay in `localStorage` by design (Phase 1), which is why the CSP is strict.
- **Rate limits** were already in place (global 120/min, strict limits on auth routes); `TRUST_PROXY` makes them apply per real client behind a proxy.
- **Dependencies and secrets**: `npm audit --omit=dev` is clean in all three apps and now runs in CI (`--audit-level=high`), as does a gitleaks scan; a manual pattern scan of the repository found nothing.
- Login CSRF/cookies: the API authenticates with bearer tokens (the refresh cookie is httpOnly and only used by `/auth/refresh`), so state-changing routes are not exposed to cross-site form posts.

### Performance
- Reviewed foreign keys against indexes and added the missing ones that matter for lookups and cascading deletes (`api/prisma/migrations/…_hardening_indexes`): task status and reporter, recent-task task, notification task/channel/workspace, message parent/author, audit actor, linked-repository workspace. Lists and feeds were already paginated (cursor or `limit`); board/search queries already filter on indexed columns.
- No load test was run (no environment for realistic data volumes) — see "Not done".

### Observability
- Structured JSON logs in production (`LOG_FORMAT`), request ids (`X-Request-Id`, honoured when sane), no bodies/headers/query strings logged; `GET /api/v1/health/live` and `/health/ready` (the old `/health` still works); Prometheus metrics at `/api/v1/metrics` behind `METRICS_TOKEN`; a single exception filter as the hook for error tracking. Details in `docs/deployment.md`.

### Operations
- Dockerfiles for the API (migrates on start, runs as non-root, healthcheck, `tini`) and web (standalone output), `docker-compose.prod.yml` (Postgres 17.9), per-app `api/.env.production.example` and `web/.env.production.example`, deployment/environment/backup/upgrade guide in `docs/deployment.md`, demo data script `api/scripts/seed-demo.mjs` (idempotent), `prisma` moved to production dependencies so migrations can run in the image.
- CI now also audits dependencies, builds both Docker images, scans for secrets and runs the browser suite against a real API + production web build.

### Accessibility
- axe-core (WCAG 2.1 A/AA, serious and critical) runs over login, register, forgot password, dashboard, my tasks, project board, task page and the settings pages. It found one real problem (muted table-header text below 4.5:1 contrast), fixed by darkening the light-theme muted colour. Added a "Skip to content" link and a focusable main region. Dark theme and the remaining pages (chat, reports, roadmap, project settings) were not scanned.

### End-to-end suite
- `web/e2e` (Playwright, `npm run test:e2e`): register → create workspace → sign out/in; wrong password; redirect to login and back; open task and comment; board lists tasks; VS Code handshake; CSP header and no violations; accessibility scans. 9 tests pass against the production build.

### Extension release
- Version 0.1.0 marked pre-release, repository/keywords/CHANGELOG added, `npm run package:pre` / `publish:pre` scripts, release steps in `vscode-extension/README.md`.

### User docs
- `docs/user-guide.md` (first steps, daily use, VS Code, security tips); the dashboard already prompts new users to create a workspace.

### Not done
- **Publishing to the Marketplace** (needs your publisher account and token) and an extension icon.
- **Building the Docker images here**: the sandbox has no Docker daemon, so the Dockerfiles were checked by performing the same steps by hand (clean `npm ci`, build, `npm prune --omit=dev`, `docker-entrypoint.sh` against an empty database, production boot with JSON logs, metrics and the secret checks; the web standalone server serving pages and assets). The new CI `docker` job is the first real build.
- **Load testing** of board/search endpoints, error-tracking service integration, and automated database backups (documented, not scheduled).
- **Running more than one API instance** (needs a socket.io adapter, e.g. Redis).
- Real VS Code integration test for the extension (Phase 10 caveat), accessibility scan of dark mode and the remaining pages, and the GitHub App install flow against real GitHub (needs credentials).

### UI refresh (after the phase)
App shell redesigned in the style of Slack/ClickUp: a dark workspace rail (workspace avatars, add, account menu), a top bar with a global search field, notifications and theme toggle, and a per-workspace sidebar (New task button, Home / My tasks / Overview / Chat / Members / Teams / Settings, collapsible Projects and Channels lists with unread badges, running timer) that becomes a drawer on small screens. New design tokens (violet primary, softer neutrals, dark-mode shell colours), generated avatars for workspaces/projects/people, card and button polish, project header with breadcrumb and pill tabs, split-screen sign-in with a brand panel. Sign out moved into the account menu. The axe scan and the 9 browser tests still pass against the production build. Not restyled in this pass: the task list filter bar, the board and the settings sub-pages (they inherit the new colours but keep their old layouts).
