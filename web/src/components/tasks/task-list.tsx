"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Select } from "@/components/ui/form";
import { Avatar, LabelChip, PriorityLabel, StatusBadge, TypeIcon } from "@/components/tasks/badges";
import { TaskDetailView } from "@/components/tasks/task-detail";
import { useProjectOptional } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, TASK_TYPES, formatDate, isOverdue, type TaskPriority, type TaskType } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

type Sort = "createdAt" | "updatedAt" | "dueDate" | "priority" | "number" | "position" | "title";
const PAGE = 50;

/** Task table with filters, sorting, quick add, bulk edit and a side panel (`?task=SYN-1`). */
export function TaskList({ projectId, mine = false }: { projectId?: string; mine?: boolean }) {
  const { workspace, members } = useWorkspace();
  const project = useProjectOptional();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = params.get("task");
  const ws = workspace.id;

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusId, setStatusId] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState(mine ? "me" : "");
  const [showDone, setShowDone] = useState(!mine);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<Sort>(mine ? "dueDate" : "position");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const quick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setOffset(0); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const tasks = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/tasks", {
      params: {
        path: { workspaceId: ws },
        query: {
          projectId, q: debouncedQ || undefined, statusId: statusId || undefined,
          type: (type || undefined) as TaskType | undefined, priority: (priority || undefined) as TaskPriority | undefined,
          assignee: assignee || undefined, statusCategory: undefined, includeArchived: archived || undefined,
          sort, order, limit: PAGE, offset,
        },
      },
    }),
    [ws, projectId, debouncedQ, statusId, type, priority, assignee, archived, sort, order, offset],
  );

  const items = (tasks.data?.items ?? []).filter((t) => showDone || t.status.category !== "DONE");
  const total = tasks.data?.total ?? 0;
  const statuses = project?.project.statuses ?? [];

  const openTask = (key: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (key) next.set("task", key); else next.delete("task");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  // Esc closes the panel; `/` focuses the quick-add box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (e.key === "Escape" && openRef && !typing) openTask(null);
      if (e.key === "/" && !typing && quick.current) { e.preventDefault(); quick.current.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

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

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search tasks" placeholder="Search by title or key…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        {projectId && (
          <Select aria-label="Filter by status" value={statusId} onChange={(e) => { setStatusId(e.target.value); setOffset(0); }}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
        <Select aria-label="Filter by type" value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }}>
          <option value="">All types</option>
          {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Select aria-label="Filter by priority" value={priority} onChange={(e) => { setPriority(e.target.value); setOffset(0); }}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        {!mine && (
          <Select aria-label="Filter by assignee" value={assignee} onChange={(e) => { setAssignee(e.target.value); setOffset(0); }}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
        )}
        <Select aria-label="Sort by" value={`${sort}:${order}`} onChange={(e) => { const [s, o] = e.target.value.split(":"); setSort(s as Sort); setOrder(o as "asc" | "desc"); }}>
          <option value="position:asc">Manual order</option>
          <option value="createdAt:desc">Newest first</option>
          <option value="updatedAt:desc">Recently updated</option>
          <option value="priority:asc">Priority</option>
          <option value="dueDate:asc">Due date</option>
          <option value="title:asc">Title A–Z</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Done</label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setOffset(0); }} />Archived</label>
      </div>

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
          <Button size="sm" variant="outline" onClick={() => void bulk({ archived: !archived })}>{archived ? "Restore" : "Archive"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(items.map((t) => t.id)))} /></th>
              <th className="px-2 py-2">Task</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Priority</th>
              <th className="px-2 py-2">Assignees</th><th className="px-2 py-2">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((t) => (
              <tr key={t.id} className={cn("cursor-pointer hover:bg-muted/60", openRef === t.key && "bg-muted")} onClick={() => openTask(t.key)}>
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
                  {t.labels.length > 0 && <div className="mt-1 flex flex-wrap gap-1 pl-6">{t.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
                </td>
                <td className="px-2 py-2"><StatusBadge status={t.status} /></td>
                <td className="px-2 py-2"><PriorityLabel priority={t.priority} /></td>
                <td className="px-2 py-2"><div className="flex -space-x-1">{t.assignees.map((a) => <Avatar key={a.userId} name={a.name} />)}</div></td>
                <td className={cn("px-2 py-2 text-xs", isOverdue(t.dueDate, t.status.category === "DONE") ? "text-red-600" : "text-muted-foreground")}>{formatDate(t.dueDate)}</td>
              </tr>
            ))}
            {!tasks.loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No tasks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} task{total === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
        </span>
      </div>

      {openRef && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => openTask(null)} aria-hidden />
          <aside role="dialog" aria-label="Task details" className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl overflow-y-auto border-l border-border bg-background shadow-xl">
            <TaskDetailView panel taskRef={openRef} onClose={() => openTask(null)} onChanged={tasks.reload} onNavigate={(key) => openTask(key)} />
          </aside>
        </>
      )}
    </div>
  );
}
