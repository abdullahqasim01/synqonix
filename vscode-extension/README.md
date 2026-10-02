# Synqonix for VS Code

Manage Synqonix projects and tasks from the editor. Phase 0 ships only a skeleton; features land in phase 10.

```bash
npm install
npm run build        # bundle to dist/extension.js
npm run watch
```

Press **F5** (Run Extension) with this folder open, then run **Synqonix: Hello**.

`npm run generate:api` generates a typed client schema from `../api/openapi.json`.
`npm test` runs unit tests. Integration tests with `@vscode/test-electron` are added in phase 10.
