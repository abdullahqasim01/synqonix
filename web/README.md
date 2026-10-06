# Synqonix Web

Next.js (App Router) + Tailwind + shadcn-style UI components.

```bash
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run generate:api` | regenerate typed API client from `../api/openapi.json` |
| `npm test` | unit tests (Vitest + Testing Library) |
| `npm run lint`, `npm run typecheck` | static checks |

Add shadcn components with `npx shadcn add <component>` (config in `components.json`).

See the [root README](../README.md) for the full setup and [docs/deployment.md](../docs/deployment.md) for production configuration.
