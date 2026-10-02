# Phase 11 – Hardening & Release

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
