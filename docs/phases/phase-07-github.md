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
