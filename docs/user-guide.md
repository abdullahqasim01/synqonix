# Synqonix user guide

## First steps
1. **Create an account** and verify your email (a banner reminds you until you do).
2. **Create a workspace** from the dashboard, then invite teammates from *Members* (roles: Owner, Admin, Member, Viewer).
3. **Create a project** (Scrum, Kanban, Bug tracking or Basic template). Its key (e.g. `SYN`) prefixes task keys (`SYN-12`).
4. **Add tasks** with *New task* or the quick-add box in the list (`/` focuses it). Press `Ctrl K` to search or jump anywhere.

## Day to day
- **Board / list / calendar** views per project; drag cards between columns; filters and saved views.
- **Scrum**: backlog planning, sprints (start, burndown, complete), estimates, epics, releases, roadmap.
- **Tasks**: description and acceptance criteria in markdown, sub-tasks, checklists, labels, links, attachments, comments with @mentions, time tracking (timer or manual log).
- **Chat**: channels and direct messages, threads, reactions, files; link tasks by typing a key like `SYN-12`.
- **GitHub**: install the app on a workspace, link repositories to projects; branches, commits and PRs that mention a task key appear on it, and merging can move the task.
- **Notifications**: bell, inbox, per-project muting and optional email digests (*Settings → Notifications*).
- **Reports**: overview, velocity, burndown, workload; export to CSV, import from CSV/Jira/GitHub.
- **Automation**: project settings → rules; **webhooks** and **API tokens** for integrations (API reference at `/docs` on the API).

## In VS Code
Install the Synqonix extension, run *Synqonix: Sign in*, then right-click a task → *Start task* to get a branch named after it, with the task assigned to you and moved to In Progress. See `vscode-extension/README.md`.

## Security tips
- Revoke API tokens you no longer use under *Settings → Security*. Changing your password signs out your other devices.
- Admins can review the audit log under workspace settings.
