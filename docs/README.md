# Synqonix – Project Docs

Synqonix is a project management system built for developers. Its differentiator is a VS Code extension that lets developers manage projects and tasks without leaving the editor. Later milestones integrate it deeper into VS Code and add first-class Agile support.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js (App Router), Tailwind, shadcn/ui |
| API | NestJS, Prisma ORM |
| DB | PostgreSQL |
| Auth | JWT (access + refresh), personal API tokens |
| Email | Resend |
| Realtime | Socket.IO |
| Extension | VS Code extension (TypeScript) |
| Package manager | **npm** |

## Repository rules

- Three independent apps: `web/`, `api/`, `vscode-extension/`.
- **Each app has its own `package.json` and `package-lock.json`.** No root `package.json`, no npm workspaces, no shared package.
- Shared contracts: the API publishes an OpenAPI spec (`api/openapi.json`). `web` and `vscode-extension` each generate their own typed client from it (`npm run generate:api`). Nothing is imported across app folders.
- Work happens on the designated feature branch; no new branches are created per phase.
- Every phase ends with: tests passing, lint clean, docs updated, one or more commits.

## Target layout

```
synqonix/
├── docs/
├── api/                 # NestJS
├── web/                 # Next.js
├── vscode-extension/    # VS Code extension
└── docker-compose.yml   # postgres (+ mailpit for local email)
```

## Milestone 1 phases

| # | Phase | File |
|---|---|---|
| 0 | Foundation | [phase-00-foundation.md](phases/phase-00-foundation.md) |
| 1 | Auth & accounts | [phase-01-auth.md](phases/phase-01-auth.md) |
| 2 | Workspaces, teams & projects | [phase-02-workspaces-projects.md](phases/phase-02-workspaces-projects.md) |
| 3 | Tasks | [phase-03-tasks.md](phases/phase-03-tasks.md) |
| 4 | Views & Kanban | [phase-04-views-kanban.md](phases/phase-04-views-kanban.md) |
| 5 | Agile (sprints, backlog, epics, releases) | [phase-05-agile.md](phases/phase-05-agile.md) |
| 6 | Discussion channels | [phase-06-channels.md](phases/phase-06-channels.md) |
| 7 | GitHub integration | [phase-07-github.md](phases/phase-07-github.md) |
| 8 | Notifications & search | [phase-08-notifications-search.md](phases/phase-08-notifications-search.md) |
| 9 | Reports & PM extras | [phase-09-reports-extras.md](phases/phase-09-reports-extras.md) |
| 10 | VS Code extension | [phase-10-vscode-extension.md](phases/phase-10-vscode-extension.md) |
| 11 | Hardening & release | [phase-11-hardening.md](phases/phase-11-hardening.md) |

## Later milestones (out of scope now)

- Milestone 2: deep VS Code integration (inline task refs in code, TODO-to-task, PR review in editor, time tracking from editor activity, AI helpers).
- Milestone 3: advanced Agile (SAFe-style program increments, capacity planning, retrospectives, automation rules).
