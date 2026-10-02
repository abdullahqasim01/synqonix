import type { Schemas } from "@/lib/api/client";

export type TaskType = Schemas["TaskDto"]["type"];
export type TaskPriority = Schemas["TaskDto"]["priority"];

export const TASK_TYPES: { value: TaskType; label: string; icon: string }[] = [
  { value: "TASK", label: "Task", icon: "☑" },
  { value: "STORY", label: "Story", icon: "📖" },
  { value: "BUG", label: "Bug", icon: "🐞" },
  { value: "EPIC", label: "Epic", icon: "⚡" },
  { value: "SUBTASK", label: "Sub-task", icon: "↳" },
];

export const PRIORITIES: { value: TaskPriority; label: string; className: string }[] = [
  { value: "URGENT", label: "Urgent", className: "text-red-600 dark:text-red-400" },
  { value: "HIGH", label: "High", className: "text-orange-600 dark:text-orange-400" },
  { value: "MEDIUM", label: "Medium", className: "text-yellow-600 dark:text-yellow-400" },
  { value: "LOW", label: "Low", className: "text-blue-600 dark:text-blue-400" },
  { value: "NONE", label: "No priority", className: "text-muted-foreground" },
];

export const typeInfo = (t: TaskType) => TASK_TYPES.find((x) => x.value === t) ?? TASK_TYPES[0];
export const priorityInfo = (p: TaskPriority) => PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[4];

/** `2026-03-01T00:00:00.000Z` -> `2026-03-01`, for <input type="date">. */
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const isOverdue = (iso: string | null | undefined, done: boolean) =>
  !!iso && !done && new Date(iso).getTime() < Date.now();

/** Markdown mention for a teammate; the API turns these into `task.mentioned` events. */
export const mentionMarkdown = (name: string, userId: string) => `[@${name.replace(/[\]\n]/g, "")}](mention:${userId})`;

type Activity = Schemas["ActivityDto"];

const list = (v: unknown, name: (id: string) => string) =>
  Array.isArray(v) && v.length ? v.map((x) => name(String(x))).join(", ") : "none";

/** Human sentence for an activity row. `userName` resolves assignee ids. */
export function describeActivity(a: Activity, userName: (id: string) => string): string {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));
  switch (a.type) {
    case "created": return "created this task";
    case "archived": return "archived this task";
    case "restored": return "restored this task";
    case "moved": return `moved this task from ${show(a.from)} to ${show(a.to)}`;
    case "duplicated_from": return `duplicated this from ${show(a.to)}`;
    case "checklist_added": return `added checklist “${show(a.to)}”`;
    case "checklist_removed": return `removed checklist “${show(a.from)}”`;
    case "attachment_added": return `attached ${show(a.to)}`;
    case "attachment_removed": return `removed attachment ${show(a.from)}`;
    case "relation_added": return `${show(a.to)}`;
    case "relation_removed": return "removed a relation";
    case "updated":
      switch (a.field) {
        case "description": return "updated the description";
        case "assignees": return `changed assignees from ${list(a.from, userName)} to ${list(a.to, userName)}`;
        case "labels": return `changed labels from ${list(a.from, String)} to ${list(a.to, String)}`;
        case "dueDate": return `changed the due date from ${a.from ? formatDate(String(a.from)) : "none"} to ${a.to ? formatDate(String(a.to)) : "none"}`;
        case "parent": return a.to ? "set a parent" : "removed the parent";
        default: return `changed ${a.field?.replace("custom:", "") ?? "a field"} from ${show(a.from)} to ${show(a.to)}`;
      }
    default: return a.type.replace(/_/g, " ");
  }
}
