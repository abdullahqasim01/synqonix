# Synqonix test plan (run locally)

Part 1 sets up the stack. Part 2 runs the automated suites. Part 3 is a manual checklist to walk through in a browser and in VS Code. Tick the boxes as you go.

## 1. Setup

Prerequisites: Node 22, npm, Docker (for Postgres 17.9 and Mailpit), git, and VS Code 1.90+ for the extension.

```bash
# from the repo root
docker compose up -d                      # Postgres :5432, Mailpit :1025 (SMTP) / :8025 (inbox UI)

cd api
cp .env.example .env                      # defaults work locally
npm ci
npx prisma migrate deploy
THROTTLE_DISABLED=1 npm run start:dev     # API on http://localhost:4000 (docs at /docs)
# THROTTLE_DISABLED only stops rate limits from getting in the way of testing; leave it off for the rate-limit check in 3.1

cd ../web
npm ci
npm run dev                               # web on http://localhost:3000

cd ../vscode-extension
npm ci && npm run build
```

Optional demo data (a workspace, project `DEMO`, an active sprint): `node api/scripts/seed-demo.mjs`, then sign in as `demo@synqonix.local` / `demo-password-123`.

Check: `curl localhost:4000/api/v1/health/ready` returns `{"status":"ok","db":"up",…}` and http://localhost:3000 shows the sign-in page.

## 2. Automated suites

Run each app's checks. All should pass with no failures.

| App | Command | Expected |
|---|---|---|
| api | `npm run lint && npm run typecheck` | clean |
| api | `npm test` | 104 unit tests pass |
| api | `npm run test:e2e` (needs Postgres; **wipes the dev database's users/workspaces**, so use a throwaway DB or the demo DB) | 309 tests, about 10 minutes |
| web | `npm run lint && npm run typecheck && npm test` | 77 unit tests pass |
| web | `npm run build && npm start`, then in another terminal `npm run test:e2e` (API must run with `THROTTLE_DISABLED=1`; set `CHROMIUM_PATH` if Playwright can't find a browser, or run `npx playwright install chromium` first) | 9 browser tests pass |
| vscode-extension | `npm run lint && npm run typecheck && npm test` | 30 unit tests pass |
| vscode-extension | `npm run test:e2e` (API running on :4000) | 12 tests pass |
| vscode-extension | `npm run test:vscode` (downloads VS Code; **never run in the sandbox, so this is the first real run**) | smoke test passes |
| vscode-extension | `npm run package` | produces a `.vsix` |

## 3. Manual checklist

### 3.1 Auth and account
- [ ] Register a new user. The "verify your email" banner appears. Open Mailpit (http://localhost:8025), click the verification link; the banner goes away.
- [ ] Sign out, sign in with a wrong password: an error shows and you stay on the login page.
- [ ] "Forgot password": the reset email arrives in Mailpit; the link lets you set a new password; the old password no longer works.
- [ ] Change password under Settings, Security: your other browser sessions are signed out.
- [ ] Create an API token under Security; it is shown once. `curl -H "Authorization: Bearer sqx_…" localhost:4000/api/v1/users/me` returns you. Revoke it and the same call returns 401.
- [ ] Rate limit (start the API **without** `THROTTLE_DISABLED`): about 10 quick wrong logins return 429.
- [ ] Visit a signed-in URL while signed out: you are sent to `/login?next=…` and land back on that page after signing in.

### 3.2 Workspaces, members, projects
- [ ] Create a workspace from the dashboard.
- [ ] Invite a second user (use a second browser profile) with role Member; accept the invite from the email.
- [ ] Roles: a Viewer cannot create or edit tasks (buttons disabled or hidden); a Member can; only Owner/Admin see workspace settings.
- [ ] Create projects from each template (Scrum, Kanban, Bug tracking, Blank): statuses differ as expected. Create a private project: a workspace member who is not in it cannot see it.
- [ ] Teams: create a team, add members.

### 3.3 Tasks
- [ ] Create tasks with "New task" and with the quick-add box (`/` focuses it). Keys are `KEY-1`, `KEY-2`, …
- [ ] Open a task: edit title, description (markdown), acceptance criteria, priority, assignees, labels, due date, estimate.
- [ ] Add a sub-task, a checklist with items (tick one), a link to another task, an attachment, a comment with an @mention.
- [ ] History shows each change. Delete a task (via Actions) and confirm it disappears.
- [ ] Bulk actions in the list: select several tasks and change status or assignee.
- [ ] Saved views and filters persist after reload.

### 3.4 Board, list, calendar
- [ ] Drag a card between columns and reorder within a column; reload and the order is kept.
- [ ] Open the same board in two browsers: a move in one appears in the other without refreshing.
- [ ] Calendar view shows tasks with due dates on the right days.

### 3.5 Agile (Scrum project)
- [ ] Backlog: create a sprint, drag tasks into it, set estimates.
- [ ] Start the sprint (end date required); the board shows only sprint tasks; the burndown chart renders.
- [ ] Complete the sprint: unfinished tasks go back to the backlog or the next sprint as chosen; velocity updates.
- [ ] Epics page, a release, a milestone, and the roadmap show what you created.

### 3.6 Chat
- [ ] Create a channel; post messages; they appear live in a second browser.
- [ ] Reply in a thread, add a reaction, edit and delete your own message.
- [ ] Typing a task key (e.g. `DEMO-1`) renders a task link; @mention a teammate and they get a notification.
- [ ] Start a direct message; unread counts clear when you open the channel; upload a file.

### 3.7 GitHub (needs a GitHub App configured; skip otherwise)
- [ ] Without the GitHub variables set, the integration page says it is not configured.
- [ ] With them set: install the app on a workspace, link a repo to a project.
- [ ] Push a branch or open a PR mentioning a task key (`DEMO-1`): it appears on the task. Merging moves the task per the project's mapping.

### 3.8 Notifications and search
- [ ] Being assigned or mentioned adds a bell notification and an inbox entry; mark read, mark all read.
- [ ] Mute a project in Settings, Notifications: no more notifications from it.
- [ ] `Ctrl K` command palette finds tasks, comments, messages and members, and only ones you may see (check with a Viewer or an outsider).
- [ ] Search filters work, e.g. `assignee:me status:open`.

### 3.9 Reports and extras
- [ ] Project reports and the workspace overview render charts with data.
- [ ] Time tracking: start and stop a timer on a task; log time manually; totals update.
- [ ] Export tasks to CSV; import a CSV (dry run first, then real); re-importing the same file skips existing rows.
- [ ] Task templates and a recurring task (set it to run soon; a new task appears).
- [ ] Settings, Webhooks: add an https endpoint (for example from webhook.site), send the test ping, change a task, check the signed delivery arrives.
- [ ] Automation rule: for example "when a bug is created, set priority to High"; create a bug and verify; history shows "Automation ran …".

### 3.10 VS Code extension
Open `vscode-extension/` in VS Code and press **F5** (Run Extension). In the new window open a folder that is a git repo.
- [ ] Activity bar shows **Synqonix** with a sign-in welcome view. Settings `synqonix.apiUrl` / `synqonix.webUrl` default to localhost.
- [ ] **Synqonix: Sign in** opens the browser to "Connect VS Code?"; approve; the editor comes back signed in and asks for a workspace if you have several.
- [ ] Also test **Sign in with an API token** (paste a `sqx_…` token).
- [ ] The trees show My tasks, Active sprint, Backlog and Recent (pick a project with the toolbar button for sprint and backlog).
- [ ] Click a task: the task page opens with description, comments and activity. Change status and priority; add a comment; check it in the web app.
- [ ] Right-click a task, **Start task**: a branch like `demo-1-short-title` is created and checked out, the task is assigned to you and moved to In Progress, the status bar shows `DEMO-1`, and the Source Control message box is prefilled.
- [ ] Run Start task again from another branch: it switches to the existing branch. With a dirty working tree it asks first.
- [ ] Start/stop the timer from the status bar; the web app shows the logged time.
- [ ] Create a task from the toolbar; search tasks; open in browser.
- [ ] Switch branches manually to one containing a task key: the status bar follows.
- [ ] Notifications: from the web app assign a task to yourself from another user; a toast appears within about a minute (interval is `synqonix.notifications.intervalSeconds`).
- [ ] Offline: stop the API, refresh: trees show "Offline, showing data from …". Restart the API and refresh to recover.
- [ ] Revoke the token in the web app, then refresh: you are signed out with a prompt. **Sign out** clears everything.

### 3.11 Security and hardening
- [ ] Response headers (browser dev tools, Network, any page): `Content-Security-Policy` with a `nonce-…`, `X-Frame-Options: DENY`, and no `unsafe-inline` for scripts. The console shows no CSP errors while clicking around.
- [ ] `curl localhost:4000/api/v1/projects` (no token) returns 401.
- [ ] As user B, try opening user A's workspace or task URL: you get an error or not-found, never the data.
- [ ] `GET /api/v1/metrics` is 404 unless `METRICS_TOKEN` is set; with it set it needs `Authorization: Bearer <token>`.
- [ ] Every response has an `X-Request-Id`; with `NODE_ENV=production` and `LOG_FORMAT=json` the API logs one JSON line per request without query strings.
- [ ] Production guard: `NODE_ENV=production node dist/main` with default secrets refuses to start.
- [ ] Accessibility: navigate a page with Tab only (visible focus, "Skip to content" appears first); zoom to 200% without losing content; try a screen reader on the login form and task page.

### 3.12 Deployment (needs Docker)
- [ ] `cp api/.env.production.example api/.env.production` and `cp web/.env.production.example web/.env.production`, fill them in (keep the Postgres password in `DATABASE_URL` and `POSTGRES_PASSWORD` identical), then `docker compose -f docker-compose.prod.yml up -d --build`. **This is the first real build of the images** (the sandbox could not run Docker): note any failure.
- [ ] `curl localhost:4000/api/v1/health/ready` is ok; register through the web app on :3000; migrations ran on start.
- [ ] Back up and restore the database as described in `docs/deployment.md`.

## 4. Reporting problems
For each failure note: the step number, what you did, what you expected, what happened, browser console errors, and the `X-Request-Id` of the failing API call. The API log line with that id has the server-side detail.
