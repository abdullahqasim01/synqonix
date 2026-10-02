# Phase 2 – Workspaces, Teams & Projects

**Goal:** multi-tenant structure and permissions.

## Data model
`Workspace`, `Membership` (role), `Invitation`, `Team`, `TeamMember`, `Project` (key, name, description, lead, visibility, archived), `ProjectMember`, `ProjectStatus` (per-project workflow column; category: todo / in-progress / done), `Label`.

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

## Status: done

Implementation notes:
- **Permissions:** one matrix in `api/src/permissions/permissions.ts` (unit-tested per role). `WorkspaceGuard` resolves the caller's membership from `:workspaceId` and enforces `@RequirePermission(...)`; non-members get 404 so ids can't be probed. Project-level rules (lead, project admin, private visibility) live in `ProjectsService`.
- **Roles:** owner / admin / member / viewer. Only owners can grant, change or remove the owner role; a workspace always keeps at least one owner. Removing a member also clears their team/project memberships and project leads.
- **Invitations:** emailed single-use links (7 days), tied to the invited address; preview is public, accept/decline need a matching signed-in account. Resend replaces the old link. Accepting also verifies the email. Sole owners cannot delete their account.
- **Projects:** immutable uppercase key (`SYN`), templates (Scrum, Kanban, Bug tracking, Blank) seed workflow statuses and labels, workspace-visible or private projects, archive/restore, lead, project members (admin/member/viewer). A workflow must keep at least one To Do and one Done status. `nextTaskNumber` is reserved for phase 3.
- **Audit log:** workspace/member/invitation/team/project events, readable by owners and admins (`GET /workspaces/:id/audit-log`).
- **Web:** workspace switcher, projects (create from template, private/archived), project page (workflow reordering, labels, members, settings), members and invitations, teams, workspace settings with audit log, and the `/invitations/[token]` landing page (with `?next=` redirects through login/register).
- **Tests:** 35 API e2e tests across auth, workspaces and projects, plus unit tests; a real-browser run covered workspace/project creation, inviting a second user by email (SMTP sink), joining via the link, role changes and private-project visibility.
