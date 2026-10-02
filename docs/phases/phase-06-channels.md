# Phase 6 – Discussion Channels

**Goal:** conversations next to the work.

## Data model
`Channel` (workspace/project/private/DM), `ChannelMember`, `Message`, `Thread` (via parent message), `Reaction`, `MessageTaskLink`, read-state per member.

## Features
- Public/private channels, project channels auto-created, direct messages.
- Threads, reactions, edit/delete, markdown + code blocks, file uploads.
- @mentions, #task references (`SYN-123` unfurls into a card), link a message to a task or create a task from it.
- Real-time delivery, typing and presence indicators, unread counts.
- Message search (indexed in Phase 8).

## Acceptance
- Messages delivered in order and not lost across reconnects.
- Private channel content is inaccessible to non-members (tested).

## Status: done

Implemented in `api/src/channels` and `web/src/components/chat`.

**Model.** One `Channel` table covers public, private and direct channels. A project's own channel is created with the project (`projectId` is unique) and its access follows the project, so it flips between public and private with the project's visibility. Direct conversations are deduplicated by `dmKey` (the sorted member ids), so the same people always share one conversation. Every message gets a per-channel `seq` taken from an atomic counter on the channel row, which makes ordering strict and gap-free.

**Access.** Private channels and DMs are visible to members only, with no override for workspace admins or owners. Viewers can read channels but only post in DMs. Archived channels are read-only. Message content, task cards and mentions are filtered per viewer.

**Realtime.** The existing socket gateway now also joins each user to the rooms of the channels they follow, plus `channel:subscribe` for public channels they are only watching. It relays `message` events (created, updated, deleted, reactions), `typing` (throttled, only from sockets that passed the access check), `presence` per workspace and `channel:read` to the reader's other tabs. Removing someone, or making a project private, revalidates the room and drops sockets that lost access. Events are not guaranteed, so clients detect a hole in `seq` (or a reconnect) and fetch `GET .../messages?after=<seq>&threads=true`.

**Tasks.** `SYN-12` in a message is linked to the task when the author can see it; the web shows a card to viewers who can see it and plain text to everyone else. Messages can also be linked by hand or turned into a task, and the task page lists its discussions (only conversations the viewer can read).

**Files.** Uploaded first, attached when the message is sent; unsent uploads are purged after 24 hours and are only visible to the uploader. Served as downloads only.

**Web.** `/w/:ws/chat` with the channel list (unread and mention badges, presence dots), markdown messages, reactions, threads, edit/delete, @mention autocomplete, file upload, typing indicator, a "New" divider, catch-up after reconnect, a Chat tab with the total unread count, and a Discussions section on tasks.

**Tests.** 36 new API e2e tests (visibility, DMs, ordering under concurrency, threads, permissions, reactions, read state, mentions, task-link privacy, attachments, realtime isolation, typing, presence, kick) and unit tests for task-key parsing and the web helpers (API: 171 e2e, 48 unit; web: 49 unit). Verified in a real browser with two users.

**Not in this phase.** Message search (Phase 8, with the search index) and notifications for mentions (the `chat.mentioned` event is emitted for Phase 8 to consume). Pinned messages and message forwarding are not planned for milestone 1.
