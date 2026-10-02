# Phase 7 – GitHub Integration

**Goal:** tie code activity to tasks.

## Data model
`GithubInstallation`, `LinkedRepository`, `GithubBranch`, `GithubPullRequest`, `GithubCommit`, `TaskGithubLink`, `WebhookDelivery` (idempotency).

## Features
- GitHub App install flow; link repos to projects.
- Webhook receiver (signature verified, idempotent) for push, pull_request, pull_request_review, issues, check runs.
- Auto-link by task key in branch name, commit message and PR title/body (`SYN-123`).
- Automations: PR opened → In Review, merged → Done (configurable per project).
- Task page shows branches, commits, PRs, CI status.
- Create GitHub branch from a task; create task from a GitHub issue; optional two-way issue sync.
- Contributor mapping between GitHub users and members.

## Acceptance
- Replayed webhooks do not duplicate data.
- Status automations are covered by tests with recorded payload fixtures.

## Status: done

Implemented in `api/src/github` and `web/src/components/github`.

**Setup.** Create a GitHub App and set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` (see `api/.env.example` for the URLs, permissions and events). Without them the integration is inert and the UI says so. A workspace admin connects an account (`GET /workspaces/:ws/github/install-url`, carrying a signed 15-minute state through GitHub's redirect to `/api/v1/github/setup`); a project admin then links repositories from the installation to a project.

**Webhooks.** `POST /api/v1/github/webhooks` verifies `X-Hub-Signature-256` over the raw body, then records the `X-GitHub-Delivery` id before processing, so retries and replays are no-ops; if processing throws, the id is removed so GitHub's retry runs it again. Handled: `push`, `pull_request`, `pull_request_review`, `check_run`, `issues`, `installation` (deleted, suspend, unsuspend) and `installation_repositories` (removed). Everything is keyed by the linked repository, so a repository linked to two projects keeps separate copies.

**Linking.** Task keys are found in branch names (`feature/SYN-12-login`), commit messages and pull request titles and bodies (not inside code), and may point at any project of the workspace. Links are only added, never removed, when text is edited. Lookalikes that match no task are ignored.

**Automations (per linked repository).** A pull request that opens, reopens or becomes ready for review moves linked tasks to a status named like "review" (or a configured one); a merge moves them to the first done status (or a configured one). Drafts, closed-unmerged pull requests, tasks that are already done, and repositories with automation switched off are left alone. Changes go through the same status logic as manual edits (lifecycle dates, board position, events for realtime and burndown) and are credited to the mapped member, or shown as "GitHub".

**Issues.** Optionally every new issue becomes a task (once, even if redelivered). With sync on, closing or reopening an issue moves the task, and finishing or reopening the task closes or reopens the issue (only when GitHub's state differs, so there are no loops).

**CI and reviews.** Check runs are stored per commit and summarised on each pull request (pending, passed, failed); the latest review verdict is kept, and a plain comment never overrides an approval or change request.

**Task page.** A Development section lists pull requests, branches, commits and issues, plus "Create branch" (name suggested from the task key and title, created from the default branch through the GitHub API and linked right away).

**Contributors.** Logins seen in events are listed in workspace settings and can be mapped to members.

**Tests.** 38 API e2e tests driven by webhook fixtures in `api/test/fixtures/github` (signed and replayed deliveries, linking, every automation path, issue sync both ways, installation events, permissions) with a fake GitHub client, plus unit tests for key parsing, branch names and CI summaries (API: 209 e2e, 53 unit; web: 49 unit). The fixtures are hand-written to match GitHub's documented payload shape, not recordings of live deliveries. Verified in a real browser against seeded data and signed webhooks; the real GitHub App install and REST calls (repository list, branch creation, issue updates) were not run against github.com.

**Known limitations.**
- The install redirect trusts our signed state plus an installation id from the query string. GitHub's guidance is to also verify the user with OAuth; until then an attacker who knows a not-yet-connected installation id could attach it to their own workspace. Planned for hardening (Phase 11).
- Installation access tokens are cached in memory per process.
- Branch and pull request history before a repository was linked is not backfilled.
