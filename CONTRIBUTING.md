# Contributing

- Three independent apps (`api/`, `web/`, `vscode-extension/`), each with its own `package.json` and lockfile. **Never add a root `package.json` or npm workspaces.**
- Use **npm** (`npm ci` in CI). If a peer-dependency conflict appears, fix versions rather than committing a different package manager.
- Cross-app contracts go through `api/openapi.json`: run `npm run generate:openapi` in `api/` after changing endpoints, then `npm run generate:api` in `web/` and `vscode-extension/`, and commit the results.
- Before pushing, run `lint`, `typecheck`, `test` and `build` in each app you touched.
- Follow the phase plan in [docs/](docs/README.md).
