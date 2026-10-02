# Phase 5 – Agile

**Goal:** first-class Scrum and Kanban support.

## Data model
`Sprint` (goal, dates, state), `SprintTask` snapshot, `Epic` (as Task type + roll-ups), `Release`/`Version`, `Milestone`, `Estimation` settings (points / t-shirt / hours).

## Features
- Backlog with drag to sprint, ranking, bulk move.
- Sprint planning: capacity, goal, start/complete, carry-over of unfinished work.
- Active sprint board.
- Story points; epic progress roll-up; releases with fix-version and release notes.
- Definition of done / acceptance criteria fields.
- Kanban mode per project: WIP limits, cycle/lead time capture.
- Sprint reports: burndown, burnup, velocity (data collected here, charts in Phase 9).
- Planning poker (stretch).

## Acceptance
- Completing a sprint moves unfinished tasks per user choice and snapshots stats.
- Burndown data points recorded daily and on scope change.

## Status: done (planning poker skipped)

Implementation notes:
- **Project settings:** `methodology` (Scrum / Kanban, defaulting from the template), `estimationUnit` (points, T-shirt, hours), default sprint length and a markdown *definition of done*. Switching away from Scrum is refused while a sprint is active. T-shirt projects only accept the scale XS 1, S 2, M 3, L 5, XL 8, XXL 13, so every unit stays a plain number that burndown and velocity can add up.
- **Sprints** (`Sprint`, `SprintTask`, `SprintSnapshot`): planned → active → completed, numbered per project. One active sprint per project (enforced under a lock). Creating, editing, starting and completing need project-admin rights; planning (adding/removing/ranking tasks) needs write access. `Task.sprintId` points at the current sprint; finished tasks keep the sprint that completed them, and a task reopened after the sprint closed returns to the backlog. Epics cannot be planned into sprints. Tasks, bulk edits, board filters and saved views all understand `sprintId` (`active`, `none` or an id); moving a task to another project clears its sprint, release and milestone.
- **Backlog:** `GET /projects/:id/backlog` returns planned/active sprints with their tasks plus the ranked backlog (done work, epics and sub-tasks hidden by default), with point totals. `POST /tasks/:id/backlog-rank` drops a task into a sprint or the backlog above/below another task. `Task.position` is now one project-wide rank shared by boards and the backlog, and the rare rebalance renumbers the whole project so both views stay consistent.
- **Completing a sprint:** unfinished work goes to the backlog, the next planned sprint (created if needed) or a chosen planned sprint. Results are snapshotted on the sprint (`summary`: committed, added, removed, completed, carried over, in points and tasks) and each task's membership history records its outcome.
- **Burndown data:** a snapshot at start, one per UTC day (hourly cron plus a lazy catch-up when the burndown is read), one whenever scope or progress changes (task added/removed/archived/deleted/moved, status or estimate changed) and a final one at completion. Repeated identical snapshots are skipped. `GET /sprints/:id/burndown` returns the points and the ideal line; one dataset serves burndown and burnup. A running sprint's summary also shows live added/removed scope.
- **Velocity** (`/velocity`): committed vs completed points per completed sprint with averages. **Epics** (`/epics`): child counts and progress, weighted by estimate when present. **Flow** (`/flow?days=`): lead time (created → done), cycle time (first in progress → done), median/average/85th percentile, weekly throughput and current WIP, for Kanban projects.
- **Releases and milestones:** releases are fix versions (unreleased → released, archivable); shipping can move unfinished tasks to another release, and release notes are generated as markdown from finished tasks grouped into Features / Bug fixes / Tasks / Epics. Milestones group tasks under a due date and can be closed and reopened. Both show done/total progress and can be assigned from the task page or bulk edit.
- **Task fields:** `acceptanceCriteria` (markdown) plus the project's definition of done on the task page.
- **Web:** Backlog (drag between sprints and the backlog, quick add, bulk move, capacity warning, start/complete dialogs, sprint editing), the board defaults to the active sprint with a sprint banner, Epics, Releases (with milestones and notes), Reports (burndown with data table, velocity, flow metrics; simple SVG charts) and agile settings. Dashboards come in phase 9. Kanban projects hide the Backlog tab and sprint report.
- **Tests:** 135 API e2e tests (25 for agile: lifecycle, scope-change snapshots, daily snapshots, carry-over modes, velocity, backlog ranking, releases, milestones, epics, flow numbers, estimation, permissions) and 43 unit tests; 37 web unit tests; a real-browser run through backlog planning by drag and drop, starting/completing a sprint, burndown and velocity, T-shirt estimates, releases, milestones, epics and switching to Kanban.

Not done:
- Planning poker (stretch).
- Cumulative flow diagram (needs status history; planned with phase 9 dashboards).
