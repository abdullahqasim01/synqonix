# GitHub integration

Optional. Without the variables below the integration is inactive and the UI says so.

## Create the GitHub App

1. GitHub → *Settings → Developer settings → GitHub Apps → New GitHub App*.
2. **Webhook URL:** `https://<your-api>/api/v1/github/webhooks`. Set a webhook secret.
3. **Setup URL:** `https://<your-api>/api/v1/github/setup` (tick "Redirect on update").
4. **Permissions:** Contents (read & write), Pull requests (read), Issues (read & write), Checks (read), Metadata (read).
5. **Subscribe to events:** push, pull_request, pull_request_review, check_run, issues, installation, installation_repositories.
6. Generate a private key and set on the API: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (PEM; `\n` escapes are accepted so it fits on one line), `GITHUB_WEBHOOK_SECRET`.

## Using it

A workspace admin connects a GitHub account from workspace settings (the install redirect carries a signed 15-minute state). A project admin then links repositories from that installation to a project.

- Branches, commits and pull requests that mention a task key (`SYN-123`) appear on the task; PR and CI state is shown with it.
- A project can map "PR opened" and "PR merged" to statuses, so merging moves the task.
- Issues sync both ways for linked repositories; "create branch" from a task is available to people who can edit it.

## How webhooks are handled

`POST /api/v1/github/webhooks` verifies `X-Hub-Signature-256` over the raw body and records the `X-GitHub-Delivery` id before processing, so retries and replays are no-ops. If processing throws, the id is released so GitHub's retry runs again. Everything is keyed by the linked repository, so a repository linked to two projects keeps separate copies.

## Known limitation

The install redirect trusts our signed state plus the installation id from the query string. GitHub's guidance is to also verify the user with OAuth; until that is added, someone who knows a not-yet-connected installation id could attach it to their own workspace. Do not rely on this integration for sensitive private repositories on a shared instance until that is fixed (see [SECURITY.md](../SECURITY.md)).
