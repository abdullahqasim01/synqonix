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
