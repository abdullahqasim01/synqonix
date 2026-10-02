# Phase 2 – Workspaces, Teams & Projects

**Goal:** multi-tenant structure and permissions.

## Data model
`Workspace`, `Membership` (role), `Invitation`, `Team`, `TeamMember`, `Project` (key, name, description, lead, visibility, archived), `ProjectMember`, `Workflow`, `WorkflowStatus` (category: todo / in-progress / done), `Label`.

## Features
- Create/switch workspaces; roles: owner, admin, member, viewer; permission matrix enforced by a central `PoliciesGuard`.
- Invite by email (Resend), accept/decline/revoke, resend.
- Teams within a workspace.
- Projects with unique keys (e.g. `SYN`), project templates (Scrum, Kanban, Bug tracking), custom workflows and statuses, labels, archive/restore.
- Per-project settings and member management.
- Audit log foundation (who did what) used by later phases.

## Web
- Workspace switcher, members & invites page, teams page, project list/create/settings.

## Acceptance
- Row-level scoping: a user can never read another workspace's data (tested).
- Permission matrix has unit tests per role.
