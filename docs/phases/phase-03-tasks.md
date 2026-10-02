# Phase 3 – Tasks

**Goal:** the core issue-tracking entity.

## Data model
`Task` (project key + sequence → `SYN-123`, type, title, rich-text description, status, priority, assignee(s), reporter, estimate, due date, parent, position), `TaskRelation` (blocks, relates-to, duplicates), `Checklist`/`ChecklistItem`, `Comment`, `Attachment`, `TaskLabel`, `Activity` (field-level history), `Watcher`, `CustomField` + values.

## Features
- CRUD with types: story, bug, task, epic, sub-task.
- Priority, labels, assignee, due date, estimates, custom fields.
- Parent/child and relations.
- Comments with @mentions and edit/delete; activity timeline.
- Attachments (S3-compatible storage; local disk in dev).
- Watchers; bulk edit; duplicate; move between projects; archive/delete/restore.
- Keyboard-friendly quick create.
- Rich-text editor with markdown and code blocks.

## Web
- Task detail (page + side-panel), quick-create modal, task list basics.

## Acceptance
- Sequential keys are race-safe.
- Every field change produces an Activity row.
- Mentions trigger notification events (consumed in Phase 8).

## Status: done

Implementation notes:
- **Keys:** `<PROJECT>-<n>` from an atomic per-project counter (`Project.nextTaskNumber`), so concurrent creates never collide and numbers are never reused. Tasks are addressed by uuid or key (`/tasks/SYN-12`, case-insensitive), which the VS Code extension will use.
- **Hierarchy:** epic → story/task/bug → sub-task, enforced on create, update and type changes (`tasks/hierarchy.ts`). Sub-task counts and progress roll up.
- **Fields:** type, priority, markdown description (rendered without raw HTML), status (project workflow), multiple assignees, labels, estimate, due date, parent, `startedAt`/`completedAt` derived from status category, and typed custom fields (text, number, date, select, checkbox) defined per project.
- **Activity:** every changed field writes an `Activity` row inside the same transaction (from/to values), as do archive/restore, moves, duplicates, relations, checklists and attachments. No-op updates write nothing.
- **Comments & mentions:** markdown comments; mention syntax is `[@Name](mention:<userId>)`. The server emits `task.mentioned` (only for workspace members who can see the project, never the author, and only *new* mentions on edit) plus `task.created/updated/status_changed/assigned/commented` via `@nestjs/event-emitter` (`tasks/events.ts`). Phase 8 subscribes to these.
- **Other:** checklists, relations (blocks / relates / duplicates, contradiction-safe, hidden when the other project is private), watchers (auto-added for reporter, assignees, commenters), attachments, bulk edit (atomic), duplicate, move between projects (subtree moves together; statuses/labels/custom fields remapped by name), archive/restore, delete (reporter or project admin).
- **Attachments:** local-disk storage behind `StorageService` (`UPLOAD_DIR`, `MAX_UPLOAD_MB`). Files are always served as `attachment` with `application/octet-stream` + `nosniff`, filenames are sanitised, storage keys are server generated. **S3-compatible storage is not implemented yet** — it is a driver for the same interface and is tracked in phase 11.
- **Workflow safety (phase 2 follow-up):** deleting a status that still has tasks now requires `?moveTo=<statusId>`.
- **List API:** one endpoint, `GET /workspaces/:id/tasks`, filters by project, status/category, type, priority, assignee (`me`/`none`/id), reporter, label, parent, text/key search, due range and archived; sort and offset pagination. It only returns tasks from projects the caller can see.
- **Web:** project Tasks tab (table, filters, sort, quick add, bulk edit, side panel via `?task=KEY`), full task page, **My tasks**, global `c` quick-create dialog, markdown editor with preview/code block/@mention picker, custom field management in project settings.
- **Tests:** 73 API e2e tests (38 for tasks) and 31 unit tests; 19 web unit tests; real-browser run of the full flow (create, edit, markdown + XSS attempt, comment/mention, checklist, sub-task, relation, upload/download, filters, panel, bulk, move, delete).
