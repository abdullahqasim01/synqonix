# Contributing to Synqonix

Thanks for helping! This guide covers how to set up, what we expect from a change, and how to get it merged.

## Ground rules

- Be kind; see the [Code of Conduct](CODE_OF_CONDUCT.md).
- For anything bigger than a small fix, **open an issue first** so we can agree on the approach before you spend time on it.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Repository layout

Three independent apps — `api/`, `web/`, `vscode-extension/` — each with its **own `package.json` and lockfile**. Please do **not** add a root `package.json` or npm workspaces. Use **npm** (CI runs `npm ci`); if a peer-dependency conflict appears, fix versions rather than committing a different package manager.

## Setup

See *Quick start* in the [README](README.md). Postgres and a mail inbox come from `docker compose -f docker-compose.dev.yml up -d` at the repo root. The [test plan](docs/test-plan.md) lists every command for running the suites.

## Before you open a pull request

Run, in each app you touched:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also:

- **API changes:** run `npm run test:e2e` in `api/` (needs Postgres; it wipes users and workspaces in the database it points at, so use a throwaway one).
- **Endpoint changes:** run `npm run generate:openapi` in `api/`, then `npm run generate:api` in `web/` and `vscode-extension/`, and commit the results. Cross-app contracts go through `api/openapi.json` only.
- **Database changes:** add a Prisma migration (`npm run prisma:migrate`); migrations must be additive and safe to apply to a running system.
- **Web changes:** UI should work in light and dark mode and by keyboard; `npm run test:e2e` in `web/` runs the browser and accessibility tests against a running stack.
- Add tests for behaviour you add or fix. Permission checks especially: every new route is covered by the route matrix test in `api/test/security.e2e-spec.ts`, which fails if a route is reachable without authentication unless you list it as public on purpose.

## Pull requests

- Keep them focused; one concern per PR.
- Describe what changed and why, and how you tested it (the PR template has prompts).
- Use clear commit messages (imperative: "Add X", "Fix Y").
- By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).

## Code style

Follow the surrounding code: naming, comment density, and idiom. Linters and formatters (`oxlint` for the API, ESLint for web and extension, Prettier configs where present) are the source of truth.
