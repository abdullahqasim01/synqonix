"use client";

import { Suspense, useState } from "react";
import { TaskPanel, useTaskPanel } from "@/components/tasks/task-panel";
import { TaskList } from "@/components/tasks/task-list";
import { PriorityLabel, StatusBadge, TypeIcon } from "@/components/tasks/badges";
import { FilterBar } from "@/components/views/filter-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { defaultViewState, type ViewState } from "@/lib/view-state";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

function Recent({ activeKey, onOpen, version }: { activeKey: string | null; onOpen: (key: string) => void; version: number }) {
  const { workspace } = useWorkspace();
  const recent = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/recent-tasks", { params: { path: { workspaceId: workspace.id }, query: { limit: 10 } } }), [workspace.id, version, activeKey]);
  const items = recent.data?.items ?? [];
  return (
    <section className="grid gap-2" aria-label="Recently viewed">
      <h2 className="text-lg font-medium">Recently viewed</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tasks you open will show up here.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((t) => (
            <li key={t.id}>
              <button onClick={() => onOpen(t.key)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60", activeKey === t.key && "bg-muted")}>
                <span className="flex min-w-0 items-center gap-2">
                  <TypeIcon type={t.type} />
                  <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                  <span className="truncate">{t.title}</span>
                </span>
                <span className="flex items-center gap-3"><PriorityLabel priority={t.priority} /><StatusBadge status={t.status} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyTasks() {
  const { openRef, open } = useTaskPanel();
  const [state, setState] = useState<ViewState>(() => defaultViewState({ sort: "dueDate", filters: { ...defaultViewState().filters, assignee: "me", hideDone: true } }));
  const [version, setVersion] = useState(0);
  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
        <FilterBar state={state} onChange={setState} hideAssignee />
        <TaskList state={state} activeKey={openRef} onOpen={(k) => open(k)} />
      </section>
      <Recent activeKey={openRef} onOpen={(k) => open(k)} version={version} />
      <TaskPanel taskRef={openRef} onClose={() => open(null)} onNavigate={(k) => open(k)} onChanged={() => setVersion((v) => v + 1)} />
    </div>
  );
}

export default function MyTasksPage() {
  return (
    <Suspense>
      <MyTasks />
    </Suspense>
  );
}
