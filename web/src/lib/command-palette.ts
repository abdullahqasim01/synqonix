import type { Schemas } from "@/lib/api/client";

export interface PaletteEntry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href?: string;
  /** Runs something instead of navigating. */
  action?: "create-task";
}

/** Things you can do without searching: jump around the workspace or start a task. */
export function commandEntries(workspaceId: string, query: string): PaletteEntry[] {
  const base = `/w/${workspaceId}`;
  const all: (PaletteEntry & { keywords?: string })[] = [
    { id: "cmd:create-task", group: "Actions", label: "Create task", hint: "C", action: "create-task", keywords: "new add issue" },
    { id: "cmd:projects", group: "Go to", label: "Projects", href: base, keywords: "home boards" },
    { id: "cmd:overview", group: "Go to", label: "Overview", href: `${base}/overview`, keywords: "dashboard workload reports" },
    { id: "cmd:my-tasks", group: "Go to", label: "My tasks", href: `${base}/my-tasks`, keywords: "assigned mine" },
    { id: "cmd:chat", group: "Go to", label: "Chat", href: `${base}/chat`, keywords: "messages channels discussion" },
    { id: "cmd:members", group: "Go to", label: "Members", href: `${base}/members`, keywords: "people invite" },
    { id: "cmd:teams", group: "Go to", label: "Teams", href: `${base}/teams` },
    { id: "cmd:settings", group: "Go to", label: "Workspace settings", href: `${base}/settings`, keywords: "github audit" },
    { id: "cmd:notifications", group: "Go to", label: "Notifications", href: "/notifications", keywords: "inbox" },
    { id: "cmd:notification-settings", group: "Go to", label: "Notification settings", href: "/settings/notifications", keywords: "email quiet hours mute" },
    { id: "cmd:profile", group: "Go to", label: "Profile", href: "/settings/profile" },
    { id: "cmd:security", group: "Go to", label: "Security", href: "/settings/security", keywords: "password tokens sessions" },
  ];
  const q = query.trim().toLowerCase();
  const found = q ? all.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q)) : all;
  return found.map((c) => ({ id: c.id, group: c.group, label: c.label, hint: c.hint, href: c.href, action: c.action }));
}

type SearchResult = Schemas["SearchResultDto"];

/** Search results as one flat, ordered list of entries. */
export function resultEntries(workspaceId: string, r: SearchResult): PaletteEntry[] {
  const base = `/w/${workspaceId}`;
  return [
    ...r.tasks.map((t) => ({ id: `task:${t.id}`, group: "Tasks", label: `${t.key} ${t.title}`, hint: t.snippet ?? t.status.name, href: `${base}/tasks/${t.key}` })),
    ...r.projects.map((p) => ({ id: `project:${p.id}`, group: "Projects", label: p.name, hint: p.key, href: `${base}/projects/${p.id}` })),
    ...r.channels.map((c) => ({ id: `channel:${c.id}`, group: "Channels", label: c.type === "DIRECT" ? c.name : `# ${c.name}`, href: `${base}/chat?c=${c.id}` })),
    ...r.people.map((p) => ({ id: `person:${p.userId}`, group: "People", label: p.name, hint: p.email, href: `${base}/members` })),
    ...r.comments.map((c) => ({ id: `comment:${c.id}`, group: "Comments", label: c.snippet, hint: c.taskKey, href: `${base}/tasks/${c.taskKey}` })),
    ...r.messages.map((m) => ({ id: `message:${m.id}`, group: "Messages", label: m.snippet, hint: m.channelName, href: `${base}/chat?c=${m.channelId}` })),
  ];
}

/** Next index when moving through `count` entries with the arrow keys, wrapping at the ends. */
export const moveSelection = (current: number, delta: 1 | -1, count: number) => (count === 0 ? 0 : (current + delta + count) % count);
