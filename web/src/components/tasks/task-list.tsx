"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Select } from "@/components/ui/form";
import { Avatar, LabelChip, PriorityLabel, StatusBadge, TypeIcon } from "@/components/tasks/badges";
import { useProjectOptional } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, formatDate, isOverdue, type TaskPriority } from "@/lib/tasks";
import { filterParams, type ViewState } from "@/lib/view-state";
import { useProjectEvents } from "@/lib/use-project-events";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

const PAGE = 50;

/**
 * Task table driven by a `ViewState`: filters, sorting and column visibility come from the caller,
 * so the same list backs project views, "My tasks" and saved views.
 */
export function TaskList({ state, projectId, activeKey, onOpen, onLoaded }: {
  state: ViewState;
  projectId?: string;
  activeKey: string | null;
  onOpen: (key: string) => void;
  /** Called with the number of matching tasks, e.g. to show a count elsewhere. */
  onLoaded?: (total: number) => void;
}) {
  const { workspace, members } = useWorkspace();
  const project = useProjectOptional();
  const ws = workspace.id;
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const quick = useRef<HTMLInputElement>(null);

  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify([filterParams(state.filters), state.sort, state.order, projectId]);
  const [pageKey, setPageKey] = useState(filterKey);
  if (pageKey !== filterKey) {
    setPageKey(filterKey);
    setOffset(0);
  }
  const effectiveOffset = pageKey === filterKey ? offset : 0;

  const tasks = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/tasks", {
      params: {
        path: { workspaceId: ws },
        query: { ...filterParams(state.filters), projectId, sort: state.sort, order: state.order, limit: PAGE, offset: effectiveOffset },
      },
    }).then((r) => { if (r.data) onLoaded?.(r.data.total); return r; }),
    [ws, filterKey, effectiveOffset],
  );
  useProjectEvents(projectId, () => tasks.reload());

  const hidden = new Set(state.hiddenColumns);
  const items = (tasks.data?.items ?? []).filter((t) => !state.filters.hideDone || t.status.category !== "DONE");
  const total = tasks.data?.total ?? 0;
  const statuses = project?.project.statuses ?? [];

  // `/` focuses the quick-add box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName) && quick.current) {
        e.preventDefault();
        quick.current.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function quickAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title || !projectId) return;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", { params: { path: { workspaceId: ws, projectId } }, body: { title } });
    if (error) return setError(errorMessage(error));
    setError(null);
    form.reset();
    tasks.reload();
  }

  async function bulk(changes: Schemas["BulkChangesDto"]) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/bulk", { params: { path: { workspaceId: ws } }, body: { taskIds: [...selected], changes } });
    setError(error ? errorMessage(error) : null);
    if (!error) setSelected(new Set());
    tasks.reload();
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = items.length > 0 && items.every((t) => selected.has(t.id));
  const cols = 2 + ["status", "priority", "assignees", "due"].filter((c) => !hidden.has(c)).length;

  return (
    <div className="grid gap-3">
      {projectId && project?.project.archived !== true && (
        <form onSubmit={quickAdd} className="flex gap-2">
          <Input ref={quick} name="title" placeholder="Add a task and press Enter  ( / to focus )" aria-label="Quick add task" maxLength={300} />
        </form>
      )}
      {error && <Alert>{error}</Alert>}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm" role="toolbar" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          {projectId && (
            <Select aria-label="Bulk status" value="" onChange={(e) => e.target.value && void bulk({ statusId: e.target.value })}>
              <option value="">Set status…</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Select aria-label="Bulk priority" value="" onChange={(e) => e.target.value && void bulk({ priority: e.target.value as TaskPriority })}>
            <option value="">Set priority…</option>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Select aria-label="Bulk assignee" value="" onChange={(e) => e.target.value && void bulk({ assigneeIds: e.target.value === "none" ? [] : [e.target.value] })}>
            <option value="">Assign to…</option>
            <option value="none">Unassigned</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={() => void bulk({ archived: !state.filters.includeArchived })}>{state.filters.includeArchived ? "Restore" : "Archive"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(items.map((t) => t.id)))} /></th>
              <th className="px-2 py-2">Task</th>
              {!hidden.has("status") && <th className="px-2 py-2">Status</th>}
              {!hidden.has("priority") && <th className="px-2 py-2">Priority</th>}
              {!hidden.has("assignees") && <th className="px-2 py-2">Assignees</th>}
              {!hidden.has("due") && <th className="px-2 py-2">Due</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((t) => (
              <tr key={t.id} className={cn("cursor-pointer hover:bg-muted/60", activeKey === t.key && "bg-muted")} onClick={() => onOpen(t.key)}>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.key}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="max-w-md px-2 py-2">
                  <div className="flex items-center gap-2">
                    <TypeIcon type={t.type} />
                    <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                    <span className={cn("truncate", t.status.category === "DONE" && "text-muted-foreground line-through")}>{t.title}</span>
                    {t.archived && <Badge>archived</Badge>}
                    {t.subtaskCount > 0 && <span className="text-xs text-muted-foreground">{t.subtaskDoneCount}/{t.subtaskCount}</span>}
                    {t.commentCount > 0 && <span className="text-xs text-muted-foreground" title="Comments">💬{t.commentCount}</span>}
                  </div>
                  {!hidden.has("labels") && t.labels.length > 0 && <div className="mt-1 flex flex-wrap gap-1 pl-6">{t.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
                </td>
                {!hidden.has("status") && <td className="px-2 py-2"><StatusBadge status={t.status} /></td>}
                {!hidden.has("priority") && <td className="px-2 py-2"><PriorityLabel priority={t.priority} /></td>}
                {!hidden.has("assignees") && <td className="px-2 py-2"><div className="flex -space-x-1">{t.assignees.map((a) => <Avatar key={a.userId} name={a.name} />)}</div></td>}
                {!hidden.has("due") && <td className={cn("px-2 py-2 text-xs", isOverdue(t.dueDate, t.status.category === "DONE") ? "text-red-600" : "text-muted-foreground")}>{formatDate(t.dueDate)}</td>}
              </tr>
            ))}
            {!tasks.loading && items.length === 0 && (
              <tr><td colSpan={cols} className="px-3 py-8 text-center text-muted-foreground">No tasks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} task{total === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={effectiveOffset === 0} onClick={() => setOffset(Math.max(0, effectiveOffset - PAGE))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={effectiveOffset + PAGE >= total} onClick={() => setOffset(effectiveOffset + PAGE)}>Next</Button>
        </span>
      </div>
    </div>
  );
}
