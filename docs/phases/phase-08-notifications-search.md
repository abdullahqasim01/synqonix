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

## Status: done

Implemented in `api/src/notifications`, `api/src/search`, `web/src/components/notifications`, `web/src/components/command-palette.tsx` and the settings/inbox pages.

**Notifications.** Domain events from tasks, sprints, chat and GitHub are turned into notifications by `NotificationListeners`; `NotificationsService.notify` is the single place that applies the rules: the actor is never notified, recipients must belong to the workspace and be able to see the project, muted projects are skipped, and each person's per-type settings decide whether it goes to the inbox, to email, both or neither. A `dedupeKey` makes reminders, GitHub redeliveries and repeated events notify once. Types: assigned, mentioned in a task, mentioned in chat, comment on a watched task, status change, due soon, overdue, sprint started/completed, pull request opened/merged, checks failed. People mentioned in a comment get "mentioned" instead of "commented". Things people can no longer see (project went private, removed from it) disappear from their inbox and unread count.

**Inbox.** `GET /notifications` (cursor paging, unread and workspace filters), `/unread-count` (per workspace), read/unread, read-all, snooze (up to 30 days; a minute-by-minute job brings it back as unread) and dismiss. These work with personal API tokens too, so the editor extension can use them. The server pushes a content-free `notification` socket event to the user's room and clients refetch.

**Email.** Resend in production, SMTP locally, as before. Modes: instant (several that built up during quiet hours go out as one email), hourly digest (at most one per hour) or off; quiet hours in the user's time zone hold emails but never the inbox; anything already read in the app is not emailed; failures stay queued and are retried every minute. Defaults email only what asks for attention (assignments, mentions, due dates).

**Preferences.** Per type and channel, email mode, quiet hours with time zone, and muted projects (only projects the person can see), all in `/settings/notifications`.

**Background jobs.** `@nestjs/schedule` (already used for burndown) instead of BullMQ or pg-boss: hourly due-date reminders (due within 24 hours, or overdue up to a week; each due date announced once), and a minute job for snoozes and queued emails. This keeps Redis and a job table out of the stack; the jobs are idempotent.

**Search.** `GET /workspaces/:ws/search?q=` over tasks, comments, projects, channels, messages and people. Text uses Postgres full-text search with stemming, trigram similarity for typos and substring matching, with GIN indexes (`pg_trgm` is enabled by the migration). Task keys (`SYN-12`) match exactly and rank first. Filters: `assignee:me|none|<name>`, `reporter:me`, `status:open|done|<name>`, `label:`, `type:`, `priority:`, `project:<KEY>`, `is:open|done|overdue|archived`, with quotes for spaces. The database only proposes candidates; every result is re-read through the same visibility rules as the rest of the API (private projects, private channels and DMs, deleted messages), so nothing hidden can be found, even by title, description, comment or filter.

**Web.** Bell with live unread count and a dropdown (mark read/unread, snooze, dismiss), a full inbox page, notification settings, and a command palette on Ctrl/⌘+K in every workspace page: commands (create task, go to…), debounced search with grouped results and keyboard navigation.

**Tests.** 19 notification and 14 search API e2e tests (plus 2 GitHub notification tests), unit tests for quiet hours/preferences and the query parser, 9 web unit tests. API: 244 e2e, 67 unit; web: 58 unit. Verified in a real browser with two users: live badge, dropdown actions, snooze, inbox page, preferences persistence, muted project, command palette (including that a private task never appears), and an assignment email delivered over SMTP.

**Not included.**
- In-app notification for workspace invitations (the invitee has no account yet in the normal flow; the email is the notification).
- Per-project overrides of individual types (projects can only be muted as a whole).
- Search uses the English text configuration; other languages still match through trigram and substring matching.
- The jobs assume one API instance. With several, the due-date reminders stay safe (dedupe keys) but queued emails could be sent twice; a job lock is part of Phase 11 hardening.
