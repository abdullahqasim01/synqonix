# Phase 10 – VS Code Extension

**Goal:** manage Synqonix from the editor (the differentiator).

## Features
- **Auth:** sign in via browser flow or personal API token stored in `SecretStorage`.
- **Activity bar view:** workspace/project picker; trees for *My Tasks*, *Current Sprint*, *Backlog*, *Recent*.
- **Task actions:** create, edit, assign, comment, transition status, change priority, open in browser.
- **Task detail webview** with description, comments, activity, GitHub links.
- **Start working:** "Start task" creates and checks out a branch named `SYN-123-short-title`, sets it as the current task, optionally moves it to In Progress.
- **Status bar:** current task and quick transition; time tracking start/stop.
- **Quick pick:** search tasks, commands palette entries.
- **Git awareness:** detect task key in current branch; commit message template with task key.
- **Notifications:** assigned/mentioned toasts (polling or WebSocket).
- Settings, offline cache, error handling, telemetry opt-in.

## Packaging
- Own `package.json` (publisher, contributes, activation events), bundled with esbuild, API client generated from `api/openapi.json`, packaged via `vsce`.

## Acceptance
- Full flow works: sign in → pick task → start (branch created) → transition → comment.
- Integration tests run with `@vscode/test-electron`.
