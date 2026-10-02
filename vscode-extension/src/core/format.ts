import type { Schemas } from "./api";

export type Task = Schemas["TaskDto"];
type Priority = Task["priority"];

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

/** Most urgent first, then soonest due date, then by key. Tasks without a due date come after those with one. */
export function compareTasks(a: Task, b: Task): number {
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (da !== db) return da < db ? -1 : 1;
  return a.projectKey === b.projectKey ? a.number - b.number : a.key.localeCompare(b.key);
}

/** Codicon names (without the `$()`) for task types and priorities. */
export const typeIcon = (t: Task["type"]) => ({ BUG: "bug", STORY: "book", EPIC: "rocket", SUBTASK: "list-tree", TASK: "tasklist" })[t];
export const priorityIcon = (p: Priority) => ({ URGENT: "flame", HIGH: "arrow-up", MEDIUM: "dash", LOW: "arrow-down", NONE: "blank" })[p];

export const formatMinutes = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
};

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "due tomorrow", "overdue 3d", "due Mar 5"; empty without a due date. `now` is passed so output is stable in tests. */
export function dueLabel(dueDate: string | null, now: number, done = false): string {
  if (!dueDate || done) return "";
  const due = new Date(dueDate).getTime();
  const days = Math.floor((due - now) / 86_400_000);
  if (due < now) return `overdue ${Math.max(1, Math.ceil((now - due) / 86_400_000))}d`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due ${new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** Second line of a tree item: status, estimate, due. */
export function describeTask(t: Task, now: number): string {
  return [t.status.name, t.estimate !== null ? `${t.estimate} pt` : "", dueLabel(t.dueDate, now, t.status.category === "DONE"), t.timeSpentMinutes ? formatMinutes(t.timeSpentMinutes) : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The status a task should move to when work starts: the first in-progress one, if it is not already in progress or done. */
export function startStatus(statuses: { id: string; name: string; category: "TODO" | "IN_PROGRESS" | "DONE"; position: number }[], current: { id: string; category: string }) {
  if (current.category !== "TODO") return null;
  return [...statuses].filter((s) => s.category === "IN_PROGRESS").sort((a, b) => a.position - b.position)[0] ?? null;
}
