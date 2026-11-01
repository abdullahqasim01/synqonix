"use client";

import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef, useState } from "react";
import { Alert, Input } from "@/components/ui/form";
import { Avatar, LabelChip, PriorityLabel, TypeIcon } from "@/components/tasks/badges";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, formatDate, isOverdue } from "@/lib/tasks";
import { useProjectEvents } from "@/lib/use-project-events";
import { useQuery } from "@/lib/use-query";
import { filterParams, type ViewState } from "@/lib/view-state";
import { cn } from "@/lib/utils";

type Card = Schemas["TaskDto"];
type Board = Schemas["BoardDto"];
type Items = Record<string, string[]>; // container id -> ordered task ids

interface Lane { key: string; label: string }

const containerId = (lane: string, statusId: string) => `${lane}::${statusId}`;
const parseContainer = (id: string) => { const [lane, statusId] = id.split("::"); return { lane, statusId }; };

/** Which lane a card belongs to for the chosen grouping. */
export function laneOf(card: Card, swimlane: ViewState["swimlane"], epicIds: Set<string>): string {
  switch (swimlane) {
    case "assignee": return card.assignees[0]?.userId ?? "unassigned";
    case "priority": return card.priority;
    case "epic": return card.parentId && epicIds.has(card.parentId) ? card.parentId : "none";
    default: return "all";
  }
}

export function buildItems(board: Board, lanes: Lane[], swimlane: ViewState["swimlane"]): Items {
  const epicIds = new Set(board.epics.map((e) => e.id));
  const items: Items = {};
  for (const lane of lanes) for (const col of board.columns) items[containerId(lane.key, col.status.id)] = [];
  for (const col of board.columns) {
    for (const t of col.tasks) {
      const id = containerId(laneOf(t, swimlane, epicIds), col.status.id);
      (items[id] ??= []).push(t.id);
    }
  }
  return items;
}

function CardView({ card, fields, dragging }: { card: Card; fields: Set<string>; dragging?: boolean }) {
  const done = card.status.category === "DONE";
  return (
    <div className={cn("grid gap-1.5 rounded-md border border-border bg-background p-2.5 text-sm shadow-sm", dragging && "shadow-lg ring-2 ring-primary")}>
      <div className="flex items-start gap-2">
        <TypeIcon type={card.type} className="mt-0.5" />
        <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>{card.title}</span>
      </div>
      {fields.has("labels") && card.labels.length > 0 && <div className="flex flex-wrap gap-1">{card.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {fields.has("key") && <span className="font-mono">{card.key}</span>}
          {fields.has("priority") && card.priority !== "NONE" && <PriorityLabel priority={card.priority} />}
          {fields.has("estimate") && card.estimate !== null && <span title="Estimate">⏱ {card.estimate}</span>}
          {fields.has("due") && card.dueDate && <span className={cn(isOverdue(card.dueDate, done) && "text-red-600")}>{formatDate(card.dueDate)}</span>}
          {card.subtaskCount > 0 && <span>{card.subtaskDoneCount}/{card.subtaskCount}</span>}
        </span>
        {fields.has("assignees") && <span className="flex -space-x-1">{card.assignees.map((a) => <Avatar key={a.userId} name={a.name} />)}</span>}
      </div>
    </div>
  );
}

function SortableCard({ card, container, fields, onOpen, active }: { card: Card; container: string; fields: Set<string>; onOpen: (key: string) => void; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { container } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={cn("cursor-grab touch-manipulation rounded-md active:cursor-grabbing", active && "ring-2 ring-primary")}
      aria-label={`${card.key} ${card.title}`}
      data-card-key={card.key}
      onClick={() => onOpen(card.key)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(card.key)}
      {...attributes}
      {...listeners}
    >
      <CardView card={card} fields={fields} />
    </div>
  );
}

function Column({
  id, status, total, loaded, ids, byId, fields, onOpen, activeKey, onQuickAdd, wide,
}: {
  id: string; status: Board["columns"][number]["status"]; total: number; loaded: number; ids: string[];
  byId: Map<string, Card>; fields: Set<string>; onOpen: (key: string) => void; activeKey: string | null;
  onQuickAdd?: (statusId: string, title: string) => Promise<void>; wide?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const over = status.wipLimit !== null && total > status.wipLimit;
  return (
    <section aria-label={status.name} className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40", wide && "w-64")}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: status.color }} />
          {status.name}
        </span>
        <span
          data-testid={`count-${status.name}`}
          title={status.wipLimit !== null ? `WIP limit ${status.wipLimit}` : undefined}
          className={cn("rounded-full px-2 py-0.5 text-xs", over ? "bg-red-500/15 font-semibold text-red-600" : "bg-muted text-muted-foreground")}
        >
          {status.wipLimit !== null ? `${total}/${status.wipLimit}` : total}
        </span>
      </header>
      <div ref={setNodeRef} className={cn("grid min-h-16 flex-1 content-start gap-2 px-2 pb-2", isOver && "rounded-b-lg bg-primary/5")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((tid) => {
            const card = byId.get(tid);
            return card ? <SortableCard key={tid} card={card} container={id} fields={fields} onOpen={onOpen} active={activeKey === card.key} /> : null;
          })}
        </SortableContext>
        {loaded < total && <p className="px-1 text-xs text-muted-foreground">Showing {loaded} of {total}. Narrow the filters to see the rest.</p>}
      </div>
      {onQuickAdd && (
        <form
          className="px-2 pb-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const title = String(new FormData(form).get("title")).trim();
            if (!title) return;
            await onQuickAdd(status.id, title);
            form.reset();
          }}
        >
          <Input name="title" placeholder="+ Add a card" aria-label={`Add a card to ${status.name}`} maxLength={300} className="h-8 bg-background" />
        </form>
      )}
    </section>
  );
}

/** Kanban board: drag cards between columns and lanes; every drop is persisted as a rank. */
export function BoardView({ state, projectId, activeKey, onOpen }: {
  state: ViewState;
  projectId: string;
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  const { workspace, members } = useWorkspace();
  const ws = workspace.id;
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragging = useRef(false);
  const [override, setOverride] = useState<{ src: Board | undefined; items: Items } | null>(null);

  const filterKey = JSON.stringify(filterParams(state.filters));
  const query = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/board", {
      params: { path: { workspaceId: ws, projectId }, query: { ...filterParams(state.filters), limit: 100 } },
    }),
    [ws, projectId, filterKey],
  );
  useProjectEvents(projectId, () => { if (!dragging.current) query.reload(); });

  const board = query.data;
  const hidden = new Set(state.hiddenStatusIds);
  const columns = (board?.columns ?? []).filter((c) => !hidden.has(c.status.id));
  const fields = useMemo(() => new Set(state.cardFields), [state.cardFields]);

  const byId = useMemo(() => {
    const m = new Map<string, Card>();
    board?.columns.forEach((c) => c.tasks.forEach((t) => m.set(t.id, t)));
    return m;
  }, [board]);

  const lanes: Lane[] = useMemo(() => {
    if (!board) return [];
    const used = new Set(board.columns.flatMap((c) => c.tasks.map((t) => laneOf(t, state.swimlane, new Set(board.epics.map((e) => e.id))))));
    switch (state.swimlane) {
      case "assignee":
        return [
          ...members.filter((m) => used.has(m.userId)).map((m) => ({ key: m.userId, label: m.name })),
          ...(used.has("unassigned") ? [{ key: "unassigned", label: "Unassigned" }] : []),
        ];
      case "priority":
        return PRIORITIES.filter((p) => used.has(p.value)).map((p) => ({ key: p.value, label: p.label }));
      case "epic":
        return [
          ...board.epics.filter((e) => used.has(e.id)).map((e) => ({ key: e.id, label: `${e.key} ${e.title}` })),
          ...(used.has("none") ? [{ key: "none", label: "No epic" }] : []),
        ];
      default:
        return [{ key: "all", label: "" }];
    }
  }, [board, state.swimlane, members]);

  const serverItems = useMemo(() => (board ? buildItems(board, lanes, state.swimlane) : {}), [board, lanes, state.swimlane]);
  const items = override && override.src === board ? override.items : serverItems;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (id: string, from: Items): string | undefined =>
    id in from ? id : Object.keys(from).find((c) => from[c].includes(id));

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    setActiveId(String(e.active.id));
    setOverride({ src: board, items: structuredClone(items) });
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !override) return;
    const current = override.items;
    const from = findContainer(String(active.id), current);
    const to = findContainer(String(over.id), current);
    if (!from || !to || from === to) return;
    const next: Items = { ...current, [from]: current[from].filter((i) => i !== active.id) };
    const target = [...current[to]];
    const overIndex = target.indexOf(String(over.id));
    target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
    next[to] = target;
    setOverride({ src: board, items: next });
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    dragging.current = false;
    setActiveId(null);
    if (!override || !board) return;
    let final = override.items;
    const taskId = String(active.id);
    const origin = findContainer(taskId, serverItems);
    const to = over ? findContainer(String(over.id), final) : undefined;
    if (!over || !origin || !to) { setOverride(null); return; }
    if (findContainer(taskId, final) === to) {
      const list = final[to];
      const oldIndex = list.indexOf(taskId);
      const newIndex = over.id in final ? list.length - 1 : list.indexOf(String(over.id));
      if (oldIndex !== newIndex && newIndex >= 0) final = { ...final, [to]: arrayMove(list, oldIndex, newIndex) };
    }
    setOverride({ src: board, items: final });

    const list = final[to];
    const index = list.indexOf(taskId);
    const beforeId = list[index + 1];
    const afterId = list[index - 1];
    const dest = parseContainer(to);
    const src = parseContainer(origin);
    if (to === origin && index === serverItems[origin].indexOf(taskId)) { setOverride(null); return; } // dropped where it was

    const card = byId.get(taskId)!;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/rank", {
      params: { path: { workspaceId: ws, taskId } },
      body: { statusId: dest.statusId, ...(beforeId ? { beforeId } : afterId ? { afterId } : {}) },
    });
    let failure = error ? errorMessage(error) : null;

    // Dropping into another lane also changes the grouping field.
    if (!failure && dest.lane !== src.lane && state.swimlane !== "none") {
      const patch: Schemas["UpdateTaskDto"] | null =
        state.swimlane === "assignee" ? { assigneeIds: dest.lane === "unassigned" ? [] : [dest.lane] }
        : state.swimlane === "priority" ? { priority: dest.lane as Card["priority"] }
        : card.type === "EPIC" ? null
        : { parentId: dest.lane === "none" ? null : dest.lane };
      if (patch === null) failure = "An epic cannot belong to another epic.";
      else {
        const { error: patchError } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path: { workspaceId: ws, taskId } }, body: patch });
        if (patchError) failure = errorMessage(patchError);
      }
    }
    setError(failure);
    setOverride(null);
    query.reload();
  }

  function onDragCancel() {
    dragging.current = false;
    setActiveId(null);
    setOverride(null);
  }

  async function quickAdd(statusId: string, title: string) {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", { params: { path: { workspaceId: ws, projectId } }, body: { title, statusId } });
    setError(error ? errorMessage(error) : null);
    query.reload();
  }

  if (query.loading) return <p className="text-sm text-muted-foreground">Loading board…</p>;
  if (!board) return <Alert>{query.error ?? "Could not load the board"}</Alert>;
  const activeCard = activeId ? byId.get(activeId) : undefined;
  const loadedTotal = (statusId: string) => board.columns.find((c) => c.status.id === statusId)!.tasks.length;

  return (
    <div className="grid gap-3">
      {error && <Alert>{error}</Alert>}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={onDragCancel}>
        <div className="grid gap-4 overflow-x-auto pb-2">
          {lanes.map((lane) => (
            <div key={lane.key} className="grid gap-2">
              {state.swimlane !== "none" && (
                <h3 className="sticky left-0 text-sm font-medium text-muted-foreground">{lane.label}</h3>
              )}
              <div className="flex items-start gap-3">
                {columns.map((col) => {
                  const id = containerId(lane.key, col.status.id);
                  return (
                    <Column
                      key={id} id={id} status={col.status} wide={state.swimlane !== "none"}
                      total={state.swimlane === "none" ? col.total : (items[id] ?? []).length}
                      loaded={state.swimlane === "none" ? loadedTotal(col.status.id) : (items[id] ?? []).length}
                      ids={items[id] ?? []} byId={byId} fields={fields} onOpen={onOpen} activeKey={activeKey}
                      onQuickAdd={state.swimlane === "none" ? quickAdd : undefined}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {lanes.length === 0 && <p className="text-sm text-muted-foreground">No cards match.</p>}
        </div>
        <DragOverlay>{activeCard ? <CardView card={activeCard} fields={fields} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
