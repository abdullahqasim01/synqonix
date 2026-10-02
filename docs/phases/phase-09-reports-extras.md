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

Phase 9 is delivered in three parts. **9a is done** (below); 9b (import/export, templates, recurring tasks) and 9c (outbound webhooks, automation rules, retention) follow.

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
