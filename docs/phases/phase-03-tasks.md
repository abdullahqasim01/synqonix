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
