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
