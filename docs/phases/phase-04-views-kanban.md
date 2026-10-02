# Phase 4 – Views & Kanban

**Goal:** multiple ways to see and manage work.

## Features
- **Views:** list, table, Kanban board, calendar, timeline (Gantt-lite).
- Filters (status, assignee, label, type, priority, dates, text), sorting, grouping, column visibility.
- **Saved views** (personal and shared) stored as `View` records with a JSON query.
- Kanban: drag-and-drop between columns and reordering (fractional/lexorank positions), swimlanes (assignee, priority, epic), WIP limits, quick add per column, card preferences.
- Real-time board updates via Socket.IO.
- "My tasks" and "Recently viewed" pages.

## Acceptance
- Moving a card persists status and position; concurrent moves converge.
- A saved view reproduces the same results in web and API (`/tasks?view=`).

## Status: done

Implementation notes:
- **Layouts:** list (column visibility, sorting, bulk edit, pagination), Kanban board, month calendar (by due date) and a timeline (bars from `startDate` to `dueDate`, 2/8/16-week windows). A new `startDate` field on tasks feeds the timeline. The layout lives in the URL (`?layout=`), as does the open task (`?task=`) and the applied saved view (`?view=`).
- **Ranking:** `Task.position` is a float; `POST /tasks/:id/rank` places a card `beforeId` / `afterId` another card in a column (or at the bottom) and can change its status in the same call. A midpoint is used between neighbours; when the gap falls below `1e-3` the column is renumbered (1000, 2000, …) in SQL. Rankings, task creation, duplication, moves and form-driven status changes take a per-project advisory lock, so concurrent drags are applied one at a time, every card keeps a distinct position and clients converge. A card whose status is changed through a form joins the bottom of its new column; sub-task lists are ordered by number so they do not jump around.
- **Board API:** `GET /projects/:id/board` returns one column per workflow status (cards in rank order, total, `hasMore`, per-column limit) plus the project's epics for swimlanes. Sub-tasks are hidden by default. All task filters and `?view=` apply.
- **WIP limits:** optional per-status `wipLimit` (set in project settings). Soft: the column count turns red (`3/2`) but nothing is blocked.
- **Swimlanes:** by assignee (first assignee), priority or epic. Dropping a card into another lane also updates that field (assignee / priority / epic).
- **Board preferences:** hide columns, choose card fields, swimlane mode; quick add per column.
- **Saved views:** `View` records (personal or shared, project-level or workspace-wide) store layout plus a validated JSON query (filters, sort, order, swimlane, display). `GET /tasks?view=<id>` (and the board) expand a view into the same parameters the UI uses; explicit parameters override it, and `assignee=me` is resolved per viewer. Shared views are editable by their owner, project admins and workspace admins; viewers can keep personal views but not share them. Verified: a view returns exactly the same response as the equivalent explicit query.
- **Recently viewed:** `POST /tasks/:id/viewed`, `GET /recent-tasks` (latest 50 per user, only tasks the caller can still see), shown on **My tasks**.
- **Realtime:** Socket.IO gateway. Clients connect with `auth: { token }` (session JWT or personal API token), `subscribe` to `{ projectId }` (same visibility rules as HTTP) and receive `task` events (`created`, `updated`, `deleted`, `ranked`, `commented`, `moved_out`). Events carry identifiers only, so clients refetch and no data bypasses HTTP authorisation. Sockets are dropped when their access token expires and the web client reconnects with a fresh one; the HTTP auth and rate-limit guards ignore WebSocket traffic. The web client shares one socket and re-subscribes after reconnects.
- **Tests:** 110 API e2e tests (board/ranking incl. concurrency and rebalancing, views, recents, realtime, throttling) and 37 unit tests; 31 web unit tests; browser run covering drag between/within columns with persistence after reload, WIP highlight, live update in a second browser, swimlane drops, card/column preferences, saved + shared views, calendar, timeline and My tasks.

Not done / follow-ups:
- Drag-to-reschedule on the calendar and drag-resize on the timeline.
- Epic roll-up bars on the timeline.
