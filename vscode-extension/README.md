# Synqonix for VS Code

Your tasks, sprint and backlog in the activity bar; start a task and get a correctly named git branch, move it through its workflow, comment, track time and see who mentioned you — without leaving the editor.

## Using it
1. Run **Synqonix: Sign in** (opens the web app to approve) or **Synqonix: Sign in with an API token**.
2. Pick a workspace and project (the view toolbar has pickers).
3. Right-click a task → **Start task** to create/switch to `syn-123-short-title`, assign you and move it to In Progress.

Settings are under `synqonix.*` (API/web URLs, notification polling, what "Start task" does, commit-message prefill).

## Developing
```bash
npm install
npm run build          # bundle to dist/extension.js
npm run watch
npm run generate:api   # typed client from ../api/openapi.json
npm run lint && npm run typecheck
npm test               # unit tests (fake VS Code host, real temp git repos)
npm run test:e2e       # extension code vs a running API (SYNQONIX_API, default http://localhost:4000)
npm run test:vscode    # smoke test inside a real VS Code (@vscode/test-electron; needs network)
npm run package        # .vsix via vsce
```
Press **F5** (Run Extension) to try it in a development host. `src/core` has no `vscode` imports and is unit-tested directly; `src/ui` is the VS Code glue.
