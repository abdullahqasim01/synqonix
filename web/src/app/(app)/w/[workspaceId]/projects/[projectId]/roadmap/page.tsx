"use client";

import { Suspense, useState } from "react";
import { TaskPanel, useTaskPanel } from "@/components/tasks/task-panel";
import { Alert, Card } from "@/components/ui/form";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { roadmapLayout } from "@/lib/roadmap";
import { formatDate } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

function Roadmap() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const { openRef, open } = useTaskPanel();
  const path = { workspaceId: workspace.id, projectId: project.id };
  const epics = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/epics", { params: { path } }), [project.id]);
  const milestones = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones", { params: { path } }), [project.id]);
  const [now] = useState(() => Date.now());

  const dated = (milestones.data ?? []).filter((m) => m.dueDate);
  const layout = roadmapLayout(
    (epics.data ?? []).map((e) => ({ id: e.id, label: `${e.key} ${e.title}`, start: ms(e.startDate), end: ms(e.dueDate) })),
    now,
    dated.map((m) => new Date(m.dueDate!).getTime()),
  );
  const byId = new Map((epics.data ?? []).map((e) => [e.id, e]));

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Epics by their start and due dates, with milestones as markers. Set the dates on the epic to place it.</p>
      {(epics.error || milestones.error) && <Alert>{epics.error ?? milestones.error}</Alert>}
      <Card className="overflow-x-auto p-0" aria-label="Roadmap">
        <div className="min-w-[720px]">
          <div className="relative h-8 border-b border-border text-xs text-muted-foreground">
            {layout.months.map((m) => <span key={m.left} className="absolute top-2 border-l border-border pl-1" style={{ left: `${m.left}%` }}>{m.label}</span>)}
          </div>
          <div className="relative">
            {layout.today !== null && <div aria-label="Today" className="absolute inset-y-0 z-10 w-px bg-red-500/70" style={{ left: `${layout.today}%` }} />}
            {layout.months.map((m) => <div key={m.left} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${m.left}%` }} />)}
            {dated.length > 0 && (
              <div className="relative h-8 border-b border-border" aria-label="Milestones">
                {dated.map((m) => (
                  <span key={m.id} title={`${m.name} · ${formatDate(m.dueDate)}`} className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-xs" style={{ left: `${layout.at(new Date(m.dueDate!).getTime())}%` }}>
                    <span aria-hidden className={m.closedAt ? "text-green-600" : "text-amber-500"}>◆</span> {m.name}
                  </span>
                ))}
              </div>
            )}
            {layout.bars.map((b) => {
              const e = byId.get(b.id)!;
              return (
                <div key={b.id} className="relative h-9 border-b border-border/60">
                  <button
                    data-epic={e.key}
                    onClick={() => open(e.key)}
                    title={`${e.title} · ${e.progress}% · ${formatDate(e.startDate)} → ${formatDate(e.dueDate)}`}
                    className="absolute top-1.5 h-6 overflow-hidden rounded bg-primary/25 text-left text-xs hover:bg-primary/35"
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                  >
                    <span className="absolute inset-y-0 left-0 bg-primary/60" style={{ width: `${e.progress}%` }} />
                    <span className="relative truncate px-1.5 leading-6">{e.key} {e.title}</span>
                  </button>
                </div>
              );
            })}
            {layout.bars.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No epic has dates yet.</p>}
          </div>
        </div>
      </Card>
      {layout.unscheduled.length > 0 && (
        <section aria-label="Unscheduled epics" className="grid gap-1">
          <h2 className="text-sm font-medium">Unscheduled</h2>
          <ul className="text-sm">
            {layout.unscheduled.map((i) => <li key={i.id}><button className="text-primary hover:underline" onClick={() => open(byId.get(i.id)!.key)}>{i.label}</button></li>)}
          </ul>
        </section>
      )}
      <TaskPanel taskRef={openRef} onClose={() => open(null)} onChanged={() => epics.reload()} onNavigate={(k) => open(k)} />
    </div>
  );
}

export default function RoadmapPage() {
  return <Suspense><Roadmap /></Suspense>;
}
