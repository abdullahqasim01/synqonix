"use client";

import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef, useState } from "react";
import { CompleteSprintDialog, StartSprintDialog } from "@/components/agile/sprint-dialogs";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Avatar, PriorityLabel, StatusBadge, TypeIcon } from "@/components/tasks/badges";
import { TaskPanel, useTaskPanel } from "@/components/tasks/task-panel";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { formatEstimate, formatTotal, type EstimationUnit } from "@/lib/estimation";
import { formatDate } from "@/lib/tasks";
import { useProjectEvents } from "@/lib/use-project-events";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

type Task = Schemas["TaskDto"];
type Sprint = Schemas["SprintDto"];
type Backlog = Schemas["BacklogDto"];
type Items = Record<string, string[]>;

const BACKLOG = "backlog";

function Row({ task, container, unit, epicKey, selected, onToggle, onOpen, active }: {
  task: Task; container: string; unit: EstimationUnit; epicKey?: string; selected: boolean;
  onToggle: () => void; onOpen: () => void; active: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { container } });
  const done = task.status.category === "DONE";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={cn("flex cursor-grab items-center gap-3 border-b border-border bg-background px-3 py-2 text-sm last:border-b-0 active:cursor-grabbing", active && "bg-muted")}
      aria-label={`${task.key} ${task.title}`}
      data-row-key={task.key}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <input type="checkbox" aria-label={`Select ${task.key}`} checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />
      <TypeIcon type={task.type} />
      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{task.key}</span>
      <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>{task.title}</span>
      {epicKey && <Badge className="font-mono">{epicKey}</Badge>}
      <PriorityLabel priority={task.priority} />
      <StatusBadge status={task.status} />
      {task.estimate !== null && <span className="min-w-8 rounded-full bg-muted px-2 py-0.5 text-center text-xs" title="Estimate">{formatEstimate(task.estimate, unit)}</span>}
      <span className="flex -space-x-1">{task.assignees.map((a) => <Avatar key={a.userId} name={a.name} />)}</span>
    </div>
  );
}

function Section({ id, header, ids, byId, empty, children, ...row }: {
  id: string; header: React.ReactNode; ids: string[]; byId: Map<string, Task>; empty: string; children?: React.ReactNode;
  unit: EstimationUnit; epicOf: (t: Task) => string | undefined; selected: Set<string>; onToggle: (id: string) => void;
  onOpen: (key: string) => void; activeKey: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section aria-label={id === BACKLOG ? "Backlog" : undefined} data-container={id} className="rounded-lg border border-border">
      <header className="border-b border-border bg-muted/40 px-3 py-2">{header}</header>
      <div ref={setNodeRef} className={cn("min-h-12", isOver && "bg-primary/5")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((tid) => {
            const t = byId.get(tid);
            return t ? (
              <Row key={tid} task={t} container={id} unit={row.unit} epicKey={row.epicOf(t)} selected={row.selected.has(tid)}
                onToggle={() => row.onToggle(tid)} onOpen={() => row.onOpen(t.key)} active={row.activeKey === t.key} />
            ) : null;
          })}
        </SortableContext>
        {ids.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p>}
      </div>
      {children}
    </section>
  );
}

function QuickAdd({ label, onAdd }: { label: string; onAdd: (title: string) => Promise<void> }) {
  return (
    <form
      className="border-t border-border p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const title = String(new FormData(form).get("title")).trim();
        if (!title) return;
        await onAdd(title);
        form.reset();
      }}
    >
      <Input name="title" aria-label={label} placeholder="+ Create an issue" maxLength={300} className="h-8" />
    </form>
  );
}

function SprintHeader({ sprint, unit, canManage, hasActive, onStart, onComplete, onEdit, onDelete }: {
  sprint: Sprint; unit: EstimationUnit; canManage: boolean; hasActive: boolean;
  onStart: () => void; onComplete: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const over = sprint.capacity !== null && sprint.stats.points > sprint.capacity;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <strong>{sprint.name}</strong>
        <Badge>{sprint.state.toLowerCase()}</Badge>
        {sprint.startDate && sprint.endDate && <span className="text-xs text-muted-foreground">{formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}</span>}
        <span className="text-xs text-muted-foreground">{sprint.stats.taskCount} issues</span>
        <span data-testid={`points-${sprint.name}`} className={cn("rounded-full px-2 py-0.5 text-xs", over ? "bg-red-500/15 font-semibold text-red-600" : "bg-muted text-muted-foreground")} title={sprint.capacity !== null ? `Capacity ${sprint.capacity}` : undefined}>
          {formatTotal(sprint.stats.points, unit)}{sprint.capacity !== null && ` / ${sprint.capacity}`}
        </span>
        {sprint.goal && <span className="truncate text-xs italic text-muted-foreground">{sprint.goal}</span>}
      </div>
      {canManage && (
        <div className="flex gap-2">
          {sprint.state === "PLANNED" && <Button size="sm" variant="outline" disabled={hasActive} title={hasActive ? "Complete the active sprint first" : undefined} onClick={onStart}>Start sprint</Button>}
          {sprint.state === "ACTIVE" && <Button size="sm" variant="outline" onClick={onComplete}>Complete sprint</Button>}
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          {sprint.state === "PLANNED" && <Button size="sm" variant="ghost" aria-label={`Delete ${sprint.name}`} onClick={onDelete}>✕</Button>}
        </div>
      )}
    </div>
  );
}

/** Scrum backlog: plan work by dragging issues between sprints and the ranked backlog. */
export function BacklogView() {
  const { workspace, members } = useWorkspace();
  const { project } = useProject();
  const ws = workspace.id;
  const { openRef, open } = useTaskPanel();
  const [q, setQ] = useState("");
  const [epic, setEpic] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [starting, setStarting] = useState<Sprint | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [override, setOverride] = useState<{ src: Backlog | undefined; items: Items } | null>(null);
  const dragging = useRef(false);

  const query = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/backlog", {
      params: { path: { workspaceId: ws, projectId: project.id }, query: { q: q.trim() || undefined, assignee: assignee || undefined, parent: epic || undefined, limit: 200 } },
    }),
    [ws, project.id, q, epic, assignee],
  );
  useProjectEvents(project.id, () => { if (!dragging.current) query.reload(); });

  const data = query.data;
  const byId = useMemo(() => {
    const m = new Map<string, Task>();
    data?.sprints.forEach((s) => s.tasks.forEach((t) => m.set(t.id, t)));
    data?.backlog.tasks.forEach((t) => m.set(t.id, t));
    return m;
  }, [data]);
  const serverItems = useMemo<Items>(() => {
    const items: Items = {};
    data?.sprints.forEach((s) => { items[s.sprint.id] = s.tasks.map((t) => t.id); });
    items[BACKLOG] = data?.backlog.tasks.map((t) => t.id) ?? [];
    return items;
  }, [data]);
  const items = override && override.src === data ? override.items : serverItems;

  const epicKeys = useMemo(() => new Map(data?.epics.map((e) => [e.id, e.key])), [data]);
  const epicOf = (t: Task) => (t.parentId ? epicKeys.get(t.parentId) : undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const findContainer = (id: string, from: Items) => (id in from ? id : Object.keys(from).find((c) => from[c].includes(id)));

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    setActiveId(String(e.active.id));
    setOverride({ src: data, items: structuredClone(items) });
  }
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !override) return;
    const cur = override.items;
    const from = findContainer(String(active.id), cur);
    const to = findContainer(String(over.id), cur);
    if (!from || !to || from === to) return;
    const target = [...cur[to]];
    const overIndex = target.indexOf(String(over.id));
    target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
    setOverride({ src: data, items: { ...cur, [from]: cur[from].filter((i) => i !== active.id), [to]: target } });
  }
  async function onDragEnd({ active, over }: DragEndEvent) {
    dragging.current = false;
    setActiveId(null);
    if (!override || !data) return;
    const taskId = String(active.id);
    const origin = findContainer(taskId, serverItems);
    let final = override.items;
    const to = over ? findContainer(String(over.id), final) : undefined;
    if (!over || !origin || !to) { setOverride(null); return; }
    if (findContainer(taskId, final) === to) {
      const list = final[to];
      const oldIndex = list.indexOf(taskId);
      const newIndex = over.id in final ? list.length - 1 : list.indexOf(String(over.id));
      if (oldIndex !== newIndex && newIndex >= 0) final = { ...final, [to]: arrayMove(list, oldIndex, newIndex) };
    }
    setOverride({ src: data, items: final });
    const list = final[to];
    const index = list.indexOf(taskId);
    if (to === origin && index === serverItems[origin].indexOf(taskId)) { setOverride(null); return; }
    const beforeId = list[index + 1];
    const afterId = list[index - 1];
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/backlog-rank", {
      params: { path: { workspaceId: ws, taskId } },
      body: { sprintId: to === BACKLOG ? null : to, ...(beforeId ? { beforeId } : afterId ? { afterId } : {}) },
    });
    setError(error ? errorMessage(error) : null);
    setOverride(null);
    query.reload();
  }

  async function create(title: string, sprintId?: string) {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", { params: { path: { workspaceId: ws, projectId: project.id } }, body: { title, ...(sprintId ? { sprintId } : {}) } });
    setError(error ? errorMessage(error) : null);
    query.reload();
  }

  async function createSprint() {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints", { params: { path: { workspaceId: ws, projectId: project.id } }, body: {} });
    setError(error ? errorMessage(error) : null);
    query.reload();
  }

  async function deleteSprint(s: Sprint) {
    if (!confirm(`Delete ${s.name}? Its issues return to the backlog.`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints/{sprintId}", { params: { path: { workspaceId: ws, projectId: project.id, sprintId: s.id } } });
    setError(error ? errorMessage(error) : null);
    query.reload();
  }

  async function saveSprint(s: Sprint, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cap = String(f.get("capacity"));
    const start = String(f.get("start"));
    const end = String(f.get("end"));
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints/{sprintId}", {
      params: { path: { workspaceId: ws, projectId: project.id, sprintId: s.id } },
      body: {
        name: String(f.get("name")), goal: String(f.get("goal")).trim() || null, capacity: cap ? Number(cap) : null,
        ...(start ? { startDate: `${start}T00:00:00.000Z` } : {}), ...(end ? { endDate: `${end}T23:59:59.000Z` } : {}),
      },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setEditing(null);
    query.reload();
  }

  async function bulkMove(target: string) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/bulk", {
      params: { path: { workspaceId: ws } }, body: { taskIds: [...selected], changes: { sprintId: target === BACKLOG ? null : target } },
    });
    setError(error ? errorMessage(error) : null);
    if (!error) setSelected(new Set());
    query.reload();
  }

  if (query.loading) return <p className="text-sm text-muted-foreground">Loading backlog…</p>;
  if (!data) return <Alert>{query.error ?? "Could not load the backlog"}</Alert>;

  const hasActive = data.sprints.some((s) => s.sprint.state === "ACTIVE");
  const planned = data.sprints.filter((s) => s.sprint.state === "PLANNED").map((s) => s.sprint);
  const activeTask = activeId ? byId.get(activeId) : undefined;
  const rowProps = {
    unit: project.estimationUnit, epicOf, selected, onToggle: (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    onOpen: (key: string) => open(key), activeKey: openRef, byId,
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search backlog" placeholder="Search issues…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <Select aria-label="Filter by epic" value={epic} onChange={(e) => setEpic(e.target.value)}>
          <option value="">All epics</option>
          {data.epics.map((e) => <option key={e.id} value={e.id}>{e.key} {e.title}</option>)}
        </Select>
        <Select aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
        {project.canManage && <Button className="ml-auto" variant="outline" onClick={() => void createSprint()}>Create sprint</Button>}
      </div>
      {error && <Alert>{error}</Alert>}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm" role="toolbar" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <Select aria-label="Move selected to" value="" onChange={(e) => e.target.value && void bulkMove(e.target.value)}>
            <option value="">Move to…</option>
            <option value={BACKLOG}>Backlog</option>
            {data.sprints.map((s) => <option key={s.sprint.id} value={s.sprint.id}>{s.sprint.name}</option>)}
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={() => { dragging.current = false; setActiveId(null); setOverride(null); }}>
        <div className="grid gap-4">
          {data.sprints.map(({ sprint }) => (
            <Section
              key={sprint.id} id={sprint.id} ids={items[sprint.id] ?? []} empty="Plan a sprint by dragging issues here." {...rowProps}
              header={editing === sprint.id ? (
                <form onSubmit={(e) => void saveSprint(sprint, e)} className="flex flex-wrap items-end gap-2">
                  <Field label="Name" htmlFor={`sp-name-${sprint.id}`}><Input id={`sp-name-${sprint.id}`} name="name" defaultValue={sprint.name} required maxLength={80} /></Field>
                  <Field label="Goal" htmlFor={`sp-goal-${sprint.id}`}><Textarea id={`sp-goal-${sprint.id}`} name="goal" defaultValue={sprint.goal ?? ""} maxLength={500} rows={1} className="min-h-9" /></Field>
                  <Field label="Start" htmlFor={`sp-start-${sprint.id}`}><Input id={`sp-start-${sprint.id}`} name="start" type="date" defaultValue={sprint.startDate?.slice(0, 10) ?? ""} /></Field>
                  <Field label="End" htmlFor={`sp-end-${sprint.id}`}><Input id={`sp-end-${sprint.id}`} name="end" type="date" defaultValue={sprint.endDate?.slice(0, 10) ?? ""} /></Field>
                  <Field label="Capacity" htmlFor={`sp-cap-${sprint.id}`}><Input id={`sp-cap-${sprint.id}`} name="capacity" type="number" min={0} step="0.5" defaultValue={sprint.capacity ?? ""} className="w-24" /></Field>
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <SprintHeader sprint={sprint} unit={project.estimationUnit} canManage={project.canManage} hasActive={hasActive}
                  onStart={() => setStarting(sprint)} onComplete={() => setCompleting(sprint)} onEdit={() => setEditing(sprint.id)} onDelete={() => void deleteSprint(sprint)} />
              )}
            >
              <QuickAdd label={`Create an issue in ${sprint.name}`} onAdd={(t) => create(t, sprint.id)} />
            </Section>
          ))}

          <Section
            id={BACKLOG} ids={items[BACKLOG] ?? []} empty="The backlog is empty." {...rowProps}
            header={
              <div className="flex items-center gap-2">
                <strong>Backlog</strong>
                <span className="text-xs text-muted-foreground">{data.backlog.total} issues</span>
                <span data-testid="points-backlog" className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatTotal(data.backlog.points, project.estimationUnit)}</span>
              </div>
            }
          >
            <QuickAdd label="Create an issue in the backlog" onAdd={(t) => create(t)} />
          </Section>
        </div>
        <DragOverlay>
          {activeTask ? <div className="rounded border border-primary bg-background px-3 py-2 text-sm shadow-lg">{activeTask.key} {activeTask.title}</div> : null}
        </DragOverlay>
      </DndContext>

      {starting && (
        <StartSprintDialog workspaceId={ws} projectId={project.id} sprint={starting} defaultDays={project.sprintDurationDays}
          onClose={() => setStarting(null)} onDone={() => { setStarting(null); query.reload(); }} />
      )}
      {completing && (
        <CompleteSprintDialog workspaceId={ws} projectId={project.id} sprint={completing} planned={planned}
          onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); query.reload(); }} />
      )}
      <TaskPanel taskRef={openRef} onClose={() => open(null)} onNavigate={(k) => open(k)} onChanged={() => query.reload()} />
    </div>
  );
}
