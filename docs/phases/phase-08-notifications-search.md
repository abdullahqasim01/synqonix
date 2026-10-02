# Phase 8 – Notifications & Search

## Notifications
- Events: assigned, mentioned, comment on watched task, status change, due soon/overdue, sprint start/end, invite, PR/CI events.
- Channels: in-app inbox (real-time), email via Resend (with batching/digest), per-user and per-project preferences, quiet hours.
- Mark read/unread, snooze, mark all read.
- Background jobs for reminders and digests (BullMQ + Redis, or pg-boss to avoid Redis).

## Search
- Global search over tasks, comments, projects, channels/messages, people (Postgres full-text + trigram).
- Command palette (⌘K) in web with actions and navigation.
- Query syntax: `assignee:me status:open label:bug`.

## Acceptance
- Notification preferences are honored per channel.
- Search results respect permissions.
