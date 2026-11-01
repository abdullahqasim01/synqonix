"use client";

import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Input } from "@/components/ui/form";
import { TaskPanel, useTaskPanel } from "@/components/tasks/task-panel";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate } from "@/lib/tasks";
import { formatTotal } from "@/lib/estimation";
import { useQuery } from "@/lib/use-query";

function Epics() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const { openRef, open } = useTaskPanel();
  const [error, setError] = useState<string | null>(null);
  const epics = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/epics", { params: { path: { workspaceId: workspace.id, projectId: project.id } } }),
    [workspace.id, project.id],
  );

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", { params: { path: { workspaceId: workspace.id, projectId: project.id } }, body: { title, type: "EPIC" } });
    setError(error ? errorMessage(error) : null);
    if (!error) form.reset();
    epics.reload();
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Epics group related stories. Progress counts finished child issues, weighted by estimate when they have one.</p>
      {error && <Alert>{error}</Alert>}
      {project.archived !== true && (
        <form onSubmit={create} className="flex max-w-md gap-2">
          <Input name="title" placeholder="New epic, e.g. Authentication" aria-label="New epic title" maxLength={300} />
          <Button type="submit">Create epic</Button>
        </form>
      )}
      <ul className="grid gap-3">
        {epics.data?.map((e) => (
          <li key={e.id}>
            <Card className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button className="flex items-center gap-2 text-left" onClick={() => open(e.key)}>
                  <span className="font-mono text-xs text-muted-foreground">{e.key}</span>
                  <strong>{e.title}</strong>
                  <Badge>{e.status}</Badge>
                </button>
                <span className="text-sm text-muted-foreground">
                  {e.doneCount}/{e.childCount} issues{e.points > 0 && ` · ${formatTotal(e.donePoints, project.estimationUnit)} of ${formatTotal(e.points, project.estimationUnit)}`}
                  {e.dueDate && ` · due ${formatDate(e.dueDate)}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted" role="progressbar" aria-label={`${e.key} progress`} aria-valuenow={e.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-green-500" style={{ width: `${e.progress}%` }} />
                </div>
                <span className="w-10 text-right text-sm tabular-nums" data-testid={`progress-${e.key}`}>{e.progress}%</span>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {epics.data?.length === 0 && <p className="text-sm text-muted-foreground">No epics yet.</p>}
      <TaskPanel taskRef={openRef} onClose={() => open(null)} onNavigate={(k) => open(k)} onChanged={() => epics.reload()} />
    </div>
  );
}

export default function EpicsPage() {
  return (
    <Suspense>
      <Epics />
    </Suspense>
  );
}
