# Phase 9 – Reports & PM Extras

## Dashboards and reports
- Burndown, burnup, velocity, cumulative flow, cycle/lead time, workload per assignee, created vs resolved, overdue.
- Configurable per-project and per-workspace dashboards.

## PM extras
- Time tracking (manual + timer), estimates vs actual.
- Recurring tasks, task templates, project templates.
- Import (CSV, Jira, GitHub issues) and export (CSV/JSON).
- Public API docs, outbound webhooks, API keys management.
- Automation rules (simple trigger → action).
- Roadmap view (epics/milestones on a timeline).
- Audit log UI, workspace settings, data retention.

## Acceptance
- Report numbers match raw data in test fixtures.
- Import is idempotent and reports row-level errors.

## Status

Phase 9 is delivered in three parts. **9a and 9b are done** (below); 9c (outbound webhooks, automation rules, retention) follows.

### 9a – reports, time tracking, roadmap

**Reports** (`api/src/insights`, project Reports tab, workspace Overview tab). Every number is derived from raw rows and checked against hand-computed fixtures in the tests.
- *Created vs resolved* per day or week (Monday start, UTC). "Resolved" counts tasks whose `completedAt` falls in the bucket, so a task that was reopened stops counting.
- *Cumulative flow*, which closes the gap left in Phase 5: the status of every task at the end of each day is rebuilt from the status changes in task history (before its first recorded change a task was in that change's "from" status). Archived tasks drop out from the day they were archived; a status that was later deleted counts as "to do". No new tables were needed.
- *Workload* per assignee (open tasks, open points, overdue, finished in the last 30 days, plus an "Unassigned" row), *overdue* list, and a *time report* (by person, by task, estimates vs actuals).
- *Workspace overview*: per project open/done/overdue/created/resolved over 14 days and workload across projects, limited to the projects the caller can see.
- Dashboards are fixed, not configurable per user; the existing Scrum burndown/velocity and Kanban flow reports sit above the new widgets.

**Time tracking** (`api/src/time`). Manual entries (1 minute to 24 hours, not in the future) and a start/stop timer. One running timer per person across all workspaces, enforced by a partial unique index, so racing requests cannot start two; starting another stops the first and keeps its time; a timer stopped within a minute is discarded. Anyone who can edit the task may log time; changing or deleting an entry needs its author or a project admin. Tasks have an optional time estimate (`timeEstimateMinutes`) and report `timeSpentMinutes` including a running timer. The task page has a Time tracking section (estimate with progress bar, over-estimate warning, timer, log form) and a header pill shows a running timer anywhere in the workspace.

**Roadmap.** A new project tab lays epics out on a time axis by their start and due dates (a missing one gives a two-week bar), with progress fill, milestone markers, a today line, and an "Unscheduled" list; clicking an epic opens the usual task panel.

**Tests.** 14 API e2e tests (report numbers against fixtures, permissions and private projects, timer rules and races), unit tests for the series maths and web helpers (durations, charts, roadmap layout). API: 258 e2e, 72 unit; web: 68 unit. Verified in a real browser: estimate and entries, over-estimate flag, ticking timer pill, all report widgets, overview and roadmap.

### 9b – import/export, task templates, recurring tasks

**Export** (`GET /projects/:id/export?format=csv|json`). Every task of the project the caller can see (archived ones are left out), with status, priority, assignees, labels, estimates, time spent, dates, sprint, release, milestone and parent. CSV cells that a spreadsheet could run as a formula (starting with `=`, `+`, `-`, `@`) are prefixed with an apostrophe, and the importer removes that prefix again, so an export imports back unchanged.

**Import** (`POST /projects/:id/import`, multipart: `file`, `source`, `dryRun`, optional `mapping`). Reads CSV (comma, semicolon or tab; quotes and line breaks inside cells) or our JSON export, up to 5 MB and 5,000 rows. Columns are matched by name for our own export, Jira ("Summary", "Issue key", "Story Points", "Epic Link", repeated "Labels" columns, `21/Mar/24 9:30 AM` dates) and GitHub issue exports (`number`, `title`, `body`, `state`), and can be overridden with an explicit mapping. Statuses are matched by name (unknown ones are placed by wording and reported), people by name or email, missing labels are created, parents are resolved from ids in the file or existing task keys and created first even when they appear later in the file.
- *Row-level report*: every row that was skipped, failed or needs a note is listed with the reasons. Errors (missing title, unreadable date or number, duplicate id in the file) skip that row; unknown priorities, types, people and statuses are warnings with a sensible fallback.
- *Idempotent*: each external id is remembered per source (`TaskImport`), so importing the same file again creates nothing and reports the rows as already imported; files without an id column are identified by their content. A different `source` name is a separate import.
- *Dry run* ("Check file") reports exactly what would happen without writing anything. Imports are silent: no notifications or webhooks for the created tasks.

**Task templates.** Per project: name, title, description, type, priority, labels, estimates and checklists. Project admins manage them; anyone who can create tasks uses them (also from the New task dialog) and any task can be saved as a template from its Actions menu. A label deleted after saving is dropped when the template is used.

**Recurring tasks.** Every N days, weeks or months from a start time; titles can contain `{date}`. A job every five minutes creates the due tasks; each rule is claimed with a compare-and-set on its next run time so two instances cannot create a task twice. A rule that missed runs creates a single task, month ends are clamped without drifting (31 Jan, 28 Feb, 31 Mar), a pause resumes from the next slot, and a rule whose owner left the workspace or whose project was archived deactivates itself. Assignees who left are dropped.

**Not done.** Live importing from the GitHub API (issues arrive from linked repositories through the webhook from Phase 7, or from a CSV), user-defined project templates (the built-in Scrum/Kanban/Bug/Basic ones remain), and updating existing tasks from a re-import (rows already imported are skipped, not updated).

**Tests.** 12 import/export and 9 template/recurring API e2e tests (round trip, Jira/GitHub fixtures with every error path, idempotency, dry run, limits, permissions, recurrence maths with fixed clocks), plus unit tests for the CSV parser, column mapping and recurrence. API: 279 e2e, 89 unit; web: 70 unit. Verified in a real browser: export download, check/import/re-import with the report table, template creation and use from the New task dialog, saving a task as a template, and creating/pausing/resuming a recurring task.
