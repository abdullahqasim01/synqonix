# Synqonix API

NestJS + Prisma + PostgreSQL.

```bash
cp .env.example .env
docker compose -f ../docker-compose.yml up -d   # postgres + mailpit
npm install
npm run start:dev                                # http://localhost:4000/api/v1/health
```

| Script | Purpose |
|---|---|
| `npm run start:dev` | watch mode |
| `npm test` / `npm run test:e2e` | unit / e2e tests (e2e needs Postgres) |
| `npm run lint`, `npm run typecheck` | static checks |
| `npm run prisma:migrate` | create/apply migrations |
| `npm run generate:openapi` | write `openapi.json` (consumed by `web/` and `vscode-extension/`) |

Swagger UI: `http://localhost:4000/docs`.

See the [root README](../README.md) for the full setup and [docs/deployment.md](../docs/deployment.md) for production configuration.
