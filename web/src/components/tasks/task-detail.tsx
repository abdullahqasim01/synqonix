"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Select } from "@/components/ui/form";
import { MultiSelect } from "@/components/tasks/multi-select";
import { Attachments, Checklists, Description, Relations, Subtasks, type TaskDetail } from "@/components/tasks/task-sections";
import { Timeline } from "@/components/tasks/task-timeline";
import { LabelChip, TypeIcon } from "@/components/tasks/badges";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, TASK_TYPES, formatDate, isOverdue, toDateInput, type TaskPriority, type TaskType } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

type UpdateBody = Schemas["UpdateTaskDto"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Full task view. Used both as a page and as the side panel on lists.
 * `onNavigate` is called when the task's key changes (moved to another project) or a related task is opened.
 */
export function TaskDetailView({
  taskRef, onClose, onChanged, onNavigate, panel = false,
}: {
  taskRef: string;
  onClose?: () => void;
  /** Fired after any edit so a surrounding list can refresh. */
  onChanged?: () => void;
  onNavigate?: (key: string) => void;
  panel?: boolean;
}) {
  const { workspace, members } = useWorkspace();
  const ws = workspace.id;
  const taskQuery = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path: { workspaceId: ws, taskId: taskRef } } }), [ws, taskRef]);
  const task = taskQuery.data;
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  // Title being edited; tied to the task it belongs to so navigating away discards it.
  const [titleDraft, setTitleDraft] = useState<{ ref: string; value: string } | null>(null);
  const title = titleDraft?.ref === taskRef ? titleDraft.value : null;
  const setTitle = (value: string | null) => setTitleDraft(value === null ? null : { ref: taskRef, value });

  const projectId = task?.projectId;
  const project = useQuery(
    async () => (projectId ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}", { params: { path: { workspaceId: ws, projectId } } }) : { data: undefined }),
    [ws, projectId],
  );
  const fields = useQuery(
    async () => (projectId ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/custom-fields", { params: { path: { workspaceId: ws, projectId } } }) : { data: undefined }),
    [ws, projectId],
  );
  const allProjects = useQuery(async () => (moving ? api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId: ws } } }) : { data: undefined }), [ws, moving]);
  const needsEpic = task && (task.type === "STORY" || task.type === "TASK" || task.type === "BUG");
  const epics = useQuery(
    async () => (needsEpic && projectId ? api.GET("/api/v1/workspaces/{workspaceId}/tasks", { params: { path: { workspaceId: ws }, query: { projectId, type: "EPIC", limit: 100 } } }) : { data: undefined }),
    [ws, projectId, needsEpic],
  );

  // Remember the visit for "Recently viewed" (once per task).
  const taskId = task?.id;
  useEffect(() => {
    if (taskId) void api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/viewed", { params: { path: { workspaceId: ws, taskId } } });
  }, [ws, taskId]);

  const reload = () => { taskQuery.reload(); setVersion((v) => v + 1); onChanged?.(); };

  if (taskQuery.loading) return <p className="p-4 text-sm text-muted-foreground">Loading task…</p>;
  if (!task) return <Alert>{taskQuery.error ?? "Task not found"}</Alert>;

  const path = { workspaceId: ws, taskId: task.id };
  const canManage = project.data?.canManage ?? false;
  const done = task.status.category === "DONE";

  async function update(body: UpdateBody) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path }, body });
    setError(error ? errorMessage(error) : null);
    reload();
  }

  async function act(call: Promise<{ error?: unknown; data?: unknown }>, then?: () => void) {
    const { error } = await call;
    if (error) return setError(errorMessage(error));
    setError(null);
    if (then) then();
    else reload();
  }

  async function moveTo(projectId: string) {
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/move", { params: { path }, body: { projectId } });
    if (!data) return setError(errorMessage(error));
    setMoving(false);
    onChanged?.();
    onNavigate?.(data.key);
  }

  const statuses = project.data?.statuses ?? [];
  const labels = project.data?.labels ?? [];
  const sectionProps = { task, reload, ws };

  return (
    <div className={cn("grid gap-6", panel ? "p-4" : "")}>
      <header className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TypeIcon type={task.type} />
            <Link href={`/w/${ws}/tasks/${task.key}`} className="font-mono hover:underline">{task.key}</Link>
            {task.parent && <>
              <span>/</span>
              <button className="hover:underline" onClick={() => onNavigate?.(task.parent!.key)}>{task.parent.key}</button>
            </>}
            {task.archived && <Badge>archived</Badge>}
          </div>
          <div className="relative flex items-center gap-2">
            <Button size="sm" variant={task.isWatching ? "secondary" : "outline"} onClick={() => void act(task.isWatching
              ? api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/watch", { params: { path } })
              : api.PUT("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/watch", { params: { path } }))}>
              {task.isWatching ? "Watching" : "Watch"}
            </Button>
            {task.canEdit && (
              <>
                <Button size="sm" variant="outline" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>Actions ▾</Button>
                {menu && (
                  <div role="menu" className="absolute right-0 top-9 z-20 grid w-44 rounded-md border border-border bg-background p-1 text-sm shadow-lg">
                    <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setMenu(false); void act(api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/duplicate", { params: { path } }), () => { onChanged?.(); }); }}>Duplicate</button>
                    {task.type !== "SUBTASK" && <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setMenu(false); setMoving(true); }}>Move to project…</button>}
                    <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setMenu(false); void act(api.POST(task.archived ? "/api/v1/workspaces/{workspaceId}/tasks/{taskId}/restore" : "/api/v1/workspaces/{workspaceId}/tasks/{taskId}/archive", { params: { path } })); }}>{task.archived ? "Restore" : "Archive"}</button>
                    <button role="menuitem" className="rounded px-2 py-1.5 text-left text-red-600 hover:bg-muted" onClick={() => { setMenu(false); if (confirm(`Delete ${task.key}? This cannot be undone.`)) void act(api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path } }), () => { onChanged?.(); onClose?.(); }); }}>Delete</button>
                  </div>
                )}
              </>
            )}
            {onClose && <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}>✕</Button>}
          </div>
        </div>
        {task.canEdit ? (
          <input
            aria-label="Task title"
            className={cn("w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold tracking-tight hover:border-border focus:border-border focus:outline-none focus:ring-2 focus:ring-ring", done && "text-muted-foreground")}
            value={title ?? task.title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== null && title.trim() && title.trim() !== task.title) void update({ title }); setTitle(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTitle(null); e.currentTarget.blur(); } }}
          />
        ) : (
          <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
        )}
        {error && <Alert>{error}</Alert>}
        {moving && (
          <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
            <span>Move {task.key} (and its sub-tasks) to</span>
            <Select aria-label="Destination project" defaultValue="" onChange={(e) => e.target.value && void moveTo(e.target.value)}>
              <option value="" disabled>Choose a project…</option>
              {allProjects.data?.filter((p) => p.id !== task.projectId && !p.archived).map((p) => <option key={p.id} value={p.id}>{p.key} — {p.name}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>Cancel</Button>
          </div>
        )}
      </header>

      <div className={cn("grid gap-6", panel ? "" : "lg:grid-cols-[1fr_20rem]")}>
        <div className="grid min-w-0 content-start gap-6">
          <Description {...sectionProps} />
          <Subtasks {...sectionProps} />
          <Checklists {...sectionProps} />
          <Relations {...sectionProps} />
          <Attachments {...sectionProps} />
          <Timeline task={task} ws={ws} canManage={canManage} version={version} />
        </div>

        <aside className={cn("grid content-start gap-3 rounded-lg border border-border p-4", panel && "order-first")}>
          <Row label="Status">
            <Select aria-label="Status" value={task.status.id} disabled={!task.canEdit} onChange={(e) => void update({ statusId: e.target.value })} className="w-full">
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select aria-label="Type" value={task.type} disabled={!task.canEdit} onChange={(e) => void update({ type: e.target.value as TaskType })} className="w-full">
              {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Row>
          <Row label="Priority">
            <Select aria-label="Priority" value={task.priority} disabled={!task.canEdit} onChange={(e) => void update({ priority: e.target.value as TaskPriority })} className="w-full">
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Row>
          <Row label="Assignees">
            <MultiSelect
              placeholder="Unassigned" disabled={!task.canEdit}
              options={members.map((m) => ({ id: m.userId, label: m.name }))}
              value={task.assignees.map((a) => a.userId)}
              onChange={(ids) => void update({ assigneeIds: ids })}
            />
          </Row>
          <Row label="Labels">
            {task.canEdit ? (
              <MultiSelect
                placeholder="No labels"
                options={labels.map((l) => ({ id: l.id, label: l.name }))}
                value={task.labels.map((l) => l.id)}
                onChange={(ids) => void update({ labelIds: ids })}
              />
            ) : (
              <div className="flex flex-wrap gap-1">{task.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>
            )}
          </Row>
          {needsEpic && (
            <Row label="Epic">
              <Select aria-label="Epic" value={task.parentId ?? ""} disabled={!task.canEdit} className="w-full"
                onChange={(e) => void update({ parentId: e.target.value || null })}>
                <option value="">None</option>
                {epics.data?.items.map((e) => <option key={e.id} value={e.id}>{e.key} — {e.title}</option>)}
              </Select>
            </Row>
          )}
          <Row label="Estimate">
            <Input aria-label="Estimate" type="number" min={0} max={1000} step="0.5" disabled={!task.canEdit} defaultValue={task.estimate ?? ""} key={`est-${task.estimate}`}
              onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== task.estimate) void update({ estimate: v }); }} />
          </Row>
          <Row label="Start date">
            <Input aria-label="Start date" type="date" disabled={!task.canEdit} defaultValue={toDateInput(task.startDate)} key={`start-${task.startDate}`}
              onChange={(e) => void update({ startDate: e.target.value ? e.target.value : null })} />
          </Row>
          <Row label="Due date">
            <div className="flex items-center gap-2">
              <Input aria-label="Due date" type="date" disabled={!task.canEdit} defaultValue={toDateInput(task.dueDate)} key={`due-${task.dueDate}`}
                onChange={(e) => void update({ dueDate: e.target.value ? e.target.value : null })} />
              {isOverdue(task.dueDate, done) && <Badge className="border-red-500/40 text-red-600">overdue</Badge>}
            </div>
          </Row>

          {(fields.data?.length ?? 0) > 0 && (
            <div className="mt-2 grid gap-3 border-t border-border pt-3">
              {fields.data?.map((f) => (
                <CustomFieldRow key={f.id} field={f} value={(task.customFields.find((v) => v.fieldId === f.id)?.value ?? null) as string | number | boolean | null} disabled={!task.canEdit}
                  onChange={(value) => void update({ customFields: { [f.id]: value } })} />
              ))}
            </div>
          )}

          <div className="mt-2 grid gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>Created {formatDate(task.createdAt)} by {members.find((m) => m.userId === task.reporterId)?.name ?? "someone"}</span>
            <span>Updated {formatDate(task.updatedAt)}</span>
            {task.completedAt && <span>Completed {formatDate(task.completedAt)}</span>}
            {task.watchers.length > 0 && <span>Watching: {task.watchers.map((w) => w.name).join(", ")}</span>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function CustomFieldRow({
  field, value, disabled, onChange,
}: { field: Schemas["CustomFieldDto"]; value: string | number | boolean | null; disabled: boolean; onChange(v: string | number | boolean | null): void }) {
  const label = field.name;
  return (
    <Row label={label}>
      {field.type === "CHECKBOX" ? (
        <input type="checkbox" aria-label={label} checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      ) : field.type === "SELECT" ? (
        <Select aria-label={label} className="w-full" value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : field.type === "DATE" ? (
        <Input aria-label={label} type="date" disabled={disabled} defaultValue={typeof value === "string" ? value.slice(0, 10) : ""} key={String(value)} onChange={(e) => onChange(e.target.value || null)} />
      ) : field.type === "NUMBER" ? (
        <Input aria-label={label} type="number" disabled={disabled} defaultValue={typeof value === "number" ? value : ""} key={String(value)}
          onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== value) onChange(v); }} />
      ) : (
        <Input aria-label={label} disabled={disabled} maxLength={1000} defaultValue={typeof value === "string" ? value : ""} key={String(value)}
          onBlur={(e) => { const v = e.target.value || null; if (v !== value) onChange(v); }} />
      )}
    </Row>
  );
}

export type { TaskDetail };
