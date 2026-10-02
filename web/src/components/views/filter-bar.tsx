"use client";

import { Input, Select } from "@/components/ui/form";
import { useProjectOptional } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useSprints } from "@/lib/use-agile";
import { PRIORITIES, TASK_TYPES } from "@/lib/tasks";
import type { ViewState } from "@/lib/view-state";

interface Props {
  state: ViewState;
  onChange(next: ViewState): void;
  statuses?: { id: string; name: string }[];
  labels?: { id: string; name: string }[];
  /** Hide the assignee filter (e.g. on "My tasks"). */
  hideAssignee?: boolean;
  /** Which sort options make sense for the current layout. */
  sorts?: { value: string; label: string }[];
}

export const LIST_SORTS = [
  { value: "position:asc", label: "Manual order" },
  { value: "createdAt:desc", label: "Newest first" },
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "priority:asc", label: "Priority" },
  { value: "dueDate:asc", label: "Due date" },
  { value: "startDate:asc", label: "Start date" },
  { value: "title:asc", label: "Title A–Z" },
];

/** Filters shared by every layout. Changes are applied immediately. */
export function FilterBar({ state, onChange, statuses, labels, hideAssignee, sorts }: Props) {
  const { workspace, members } = useWorkspace();
  const project = useProjectOptional()?.project;
  const scrum = project?.methodology === "SCRUM";
  const sprints = useSprints(workspace.id, project?.id, scrum);
  const set = (patch: Partial<ViewState["filters"]>) => onChange({ ...state, filters: { ...state.filters, ...patch } });
  const sortOptions = sorts ?? LIST_SORTS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Search tasks" placeholder="Search by title or key…" value={state.filters.q} onChange={(e) => set({ q: e.target.value })} className="w-56" />
      {statuses && state.layout === "list" && (
        <Select aria-label="Filter by status" value={state.filters.statusId} onChange={(e) => set({ statusId: e.target.value })}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      )}
      <Select aria-label="Filter by type" value={state.filters.type} onChange={(e) => set({ type: e.target.value as ViewState["filters"]["type"] })}>
        <option value="">All types</option>
        {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Select aria-label="Filter by priority" value={state.filters.priority} onChange={(e) => set({ priority: e.target.value as ViewState["filters"]["priority"] })}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </Select>
      {!hideAssignee && (
        <Select aria-label="Filter by assignee" value={state.filters.assignee} onChange={(e) => set({ assignee: e.target.value })}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
      )}
      {scrum && (
        <Select aria-label="Filter by sprint" value={state.filters.sprintId} onChange={(e) => set({ sprintId: e.target.value })}>
          <option value="">All sprints</option>
          <option value="active">Active sprint</option>
          <option value="none">Backlog</option>
          {sprints.data?.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.state === "COMPLETED" ? " (done)" : ""}</option>)}
        </Select>
      )}
      {labels && labels.length > 0 && (
        <Select aria-label="Filter by label" value={state.filters.labelId} onChange={(e) => set({ labelId: e.target.value })}>
          <option value="">Any label</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      )}
      {state.layout === "list" && (
        <Select aria-label="Sort by" value={`${state.sort}:${state.order}`} onChange={(e) => { const [sort, order] = e.target.value.split(":"); onChange({ ...state, sort: sort as ViewState["sort"], order: order as "asc" | "desc" }); }}>
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input type="checkbox" checked={state.filters.hideDone} onChange={(e) => set({ hideDone: e.target.checked })} />Hide done
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input type="checkbox" checked={state.filters.includeArchived} onChange={(e) => set({ includeArchived: e.target.checked })} />Archived
      </label>
    </div>
  );
}
