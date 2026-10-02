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

---

## Status: done (extension in `vscode-extension/`, sign-in page in `web/`)

**Structure.** Everything that does not need VS Code is plain TypeScript in `src/core` (API client, git, formatting, markdown, offline cache, notification poller, task page, `TaskService`); the VS Code glue is in `src/ui` (state, trees, status bar, task panel, commands, git watching) and `src/extension.ts`. The API client is typed from `api/openapi.json` (`npm run generate:api`) and calls through `openapi-fetch`; the bundle is built with esbuild and packaged with `vsce` (`npm run package`).

**Sign-in.** *Browser*: "Synqonix: Sign in" opens `<webUrl>/connect/vscode?state=<random>`; the web page (login first if needed — the layout now returns you to where you were headed) asks "Connect VS Code?", creates a personal API token and redirects to `vscode://synqonix.synqonix/auth?token=…&state=…`. The extension's URI handler accepts the answer only if the `state` matches a request made by that window, then checks the token with `/users/me`. The page only ever redirects to the `vscode:`/`vscode-insiders:` scheme at the extension's own address. *Token*: paste a `sqx_…` token. Tokens live in `SecretStorage`; a rejected token signs out with a prompt to sign in again; signing out clears the cache and selections.

**Activity bar.** Views *My tasks* (in progress / to do, across the workspace's projects), *Active sprint*, *Backlog* (sprints then backlog) and *Recent*, with workspace/project pickers, a welcome view when signed out, and inline/context actions on tasks (start, move, assign, priority, comment, timer, open, set current). Each tree remembers its last good answer: if the server cannot be reached it shows "Offline — showing data from …" instead of an error.

**Task page** (webview, one tab per task): status and priority selectors, description, acceptance criteria, checklists, GitHub PRs/branches/commits, comments (add one) and recent activity. It runs under a strict CSP with a per-render nonce, escapes everything and renders markdown through a restricted renderer (no raw HTML, http(s) links only).

**Start working.** Creates `syn-123-short-title` from the current HEAD (or the configured base branch), or switches to it if it exists; only after git succeeds does it assign you, move the task to the first In Progress status (if it was To Do) and optionally start the timer, then sets the current task and prefills the commit box. A git failure leaves the task untouched. Uncommitted changes ask for confirmation first.

**Status bar and git.** The current task (`SYN-123`) opens a quick menu (open, move, comment, timer, commit message, browser, clear); a ticking timer item stops the timer when clicked. Watching `.git/HEAD` sets the current task from the branch name when it contains a task key. "Insert commit message" fills the Source Control box with `SYN-123: title` (or copies it).

**Notifications.** The inbox is polled (default 60 s, minimum 30 s); the first poll only records where things stand, then assigned/mentioned/chat-mention/overdue/due-soon items appear as toasts with an "Open" button.

**Settings:** `apiUrl`, `webUrl`, `notifications.enabled`, `notifications.intervalSeconds`, `startTask.moveToInProgress`, `startTask.assignToMe`, `startTask.startTimer`, `startTask.baseBranch`, `git.commitTemplate`, `telemetry.enabled` (reserved; the extension sends no usage data at all).

**Not done / caveats.**
- The `@vscode/test-electron` smoke test (`npm run test:vscode`, `test/integration`) is in place but was **not run here**: the sandbox cannot download VS Code (403). Run it on a machine with network access. The behaviour below is verified against a fake `vscode` host instead, which proves the logic but not VS Code's own rendering of trees, menus and webviews — worth a manual F5 pass.
- Realtime (WebSocket) updates are not used; trees refresh after your own actions and on "Refresh", notifications are polled.
- Telemetry is a reserved setting only. Marketplace publishing and an icon are left for release.

**Tests.** 30 unit tests (git against a real temporary repository, formatting, restricted markdown/XSS, task page, cache, auth handshake parsing, poller) and 12 end-to-end tests (`npm run test:e2e`, needs the API on `SYNQONIX_API`, default `localhost:4000`) that run the real extension code against the real API and a real git repository with a fake editor: handshake (wrong state ignored), sign-in, start task (branch, assignment, status), switching back to an existing branch, trees, transition, comment, task page, panel messages, create task, timer, inbox read, offline cache and token revocation. Web: 73 unit tests (3 new for the handshake helpers). Verified in a real browser: login round trip with `next`, the connect page producing the `vscode://` redirect with a working token, and the invalid-link state. `vsce package` produces a ~60 KB `.vsix`.
