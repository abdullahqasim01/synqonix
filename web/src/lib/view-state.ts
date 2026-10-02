import type { Schemas } from "@/lib/api/client";
import type { TaskPriority, TaskType } from "@/lib/tasks";

export type Layout = "list" | "board" | "calendar" | "timeline";
export type Swimlane = "none" | "assignee" | "priority" | "epic";
export type SortField = "createdAt" | "updatedAt" | "dueDate" | "startDate" | "priority" | "number" | "position" | "title";

export const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
  { value: "calendar", label: "Calendar" },
  { value: "timeline", label: "Timeline" },
];

export const LIST_COLUMNS = [
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "assignees", label: "Assignees" },
  { id: "labels", label: "Labels" },
  { id: "due", label: "Due date" },
];

export const CARD_FIELDS = [
  { id: "key", label: "Key" },
  { id: "priority", label: "Priority" },
  { id: "assignees", label: "Assignees" },
  { id: "labels", label: "Labels" },
  { id: "due", label: "Due date" },
  { id: "estimate", label: "Estimate" },
];
export const DEFAULT_CARD_FIELDS = ["key", "priority", "assignees", "labels", "due"];

export interface ViewFilters {
  q: string;
  statusId: string;
  type: "" | TaskType;
  priority: "" | TaskPriority;
  /** `me`, `none`, a user id, or empty for anyone. */
  assignee: string;
  labelId: string;
  includeArchived: boolean;
  /** Hide finished tasks (client-side). */
  hideDone: boolean;
}

export interface ViewState {
  layout: Layout;
  filters: ViewFilters;
  sort: SortField;
  order: "asc" | "desc";
  swimlane: Swimlane;
  hiddenStatusIds: string[];
  hiddenColumns: string[];
  cardFields: string[];
}

export const DEFAULT_FILTERS: ViewFilters = {
  q: "", statusId: "", type: "", priority: "", assignee: "", labelId: "", includeArchived: false, hideDone: false,
};

export const defaultViewState = (overrides: Partial<ViewState> = {}): ViewState => ({
  layout: "list",
  filters: { ...DEFAULT_FILTERS },
  sort: "position",
  order: "asc",
  swimlane: "none",
  hiddenStatusIds: [],
  hiddenColumns: [],
  cardFields: DEFAULT_CARD_FIELDS,
  ...overrides,
});

type ListQuery = {
  projectId?: string; statusId?: string; type?: TaskType; priority?: TaskPriority; assignee?: string; labelId?: string;
  q?: string; includeArchived?: boolean; excludeSubtasks?: boolean;
};

/** Task-list query parameters for the current filters (the same ones a saved view stores). */
export function filterParams(f: ViewFilters): ListQuery {
  return {
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.statusId ? { statusId: f.statusId } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.assignee ? { assignee: f.assignee } : {}),
    ...(f.labelId ? { labelId: f.labelId } : {}),
    ...(f.includeArchived ? { includeArchived: true } : {}),
  };
}

type StoredQuery = Schemas["ViewDto"]["query"];

/** What gets saved in a view. Only non-default values are stored, so views stay small. */
export function toViewQuery(s: ViewState): StoredQuery {
  const filters = filterParams(s.filters);
  delete filters.excludeSubtasks;
  return {
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(s.sort !== "position" ? { sort: s.sort } : {}),
    ...(s.order !== "asc" ? { order: s.order } : {}),
    ...(s.swimlane !== "none" ? { swimlane: s.swimlane } : {}),
    display: {
      ...(s.hiddenStatusIds.length ? { hiddenStatusIds: s.hiddenStatusIds } : {}),
      ...(s.hiddenColumns.length ? { hiddenColumns: s.hiddenColumns } : {}),
      cardFields: s.cardFields,
      ...(s.filters.hideDone ? { hideDone: true } : {}),
    },
  };
}

const LAYOUT_FROM_API: Record<string, Layout> = { LIST: "list", BOARD: "board", CALENDAR: "calendar", TIMELINE: "timeline" };
export const layoutToApi = (l: Layout) => l.toUpperCase() as "LIST" | "BOARD" | "CALENDAR" | "TIMELINE";

/** Rebuilds the UI state from a saved view. */
export function fromView(view: Pick<Schemas["ViewDto"], "layout" | "query">): ViewState {
  const { filters, sort, order, swimlane, display } = view.query;
  const d = display;
  return defaultViewState({
    layout: LAYOUT_FROM_API[view.layout] ?? "list",
    filters: {
      ...DEFAULT_FILTERS,
      q: filters?.q ?? "",
      statusId: filters?.statusId ?? "",
      type: (filters?.type ?? "") as ViewFilters["type"],
      priority: (filters?.priority ?? "") as ViewFilters["priority"],
      assignee: filters?.assignee ?? "",
      labelId: filters?.labelId ?? "",
      includeArchived: filters?.includeArchived ?? false,
      hideDone: d?.hideDone ?? false,
    },
    sort: (sort ?? "position") as SortField,
    order: order ?? "asc",
    swimlane: (swimlane ?? "none") as Swimlane,
    hiddenStatusIds: d?.hiddenStatusIds ?? [],
    hiddenColumns: d?.hiddenColumns ?? [],
    cardFields: d?.cardFields ?? DEFAULT_CARD_FIELDS,
  });
}

/** Stable comparison used to tell whether the UI has drifted from the applied saved view. */
export const sameQuery = (a: ViewState, b: ViewState) =>
  JSON.stringify(toViewQuery(a)) === JSON.stringify(toViewQuery(b)) && a.layout === b.layout;
