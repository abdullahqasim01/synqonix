"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/form";
import { CompleteSprintDialog } from "@/components/agile/sprint-dialogs";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatTotal } from "@/lib/estimation";
import { useProjectEvents } from "@/lib/use-project-events";
import { useSprints } from "@/lib/use-agile";

const DAY = 86_400_000;

/** Shows the running sprint above the board: goal, time left, progress and a complete button. */
export function ActiveSprintBanner() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const [version, setVersion] = useState(0);
  const [now] = useState(() => Date.now());
  const [completing, setCompleting] = useState(false);
  const sprints = useSprints(workspace.id, project.id, true, version);
  useProjectEvents(project.id, () => setVersion((v) => v + 1), 500);

  const active = sprints.data?.find((s) => s.state === "ACTIVE");
  if (sprints.loading) return null;
  if (!active) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        No active sprint. <Link className="text-primary underline" href={`/w/${workspace.id}/projects/${project.id}/backlog`}>Plan and start one from the backlog.</Link>
      </div>
    );
  }
  const left = active.endDate ? Math.ceil((new Date(active.endDate).getTime() - now) / DAY) : null;
  const pct = active.stats.points > 0 ? (active.stats.donePoints / active.stats.points) * 100 : active.stats.taskCount ? (active.stats.doneCount / active.stats.taskCount) * 100 : 0;

  return (
    <section aria-label="Active sprint" className="grid gap-2 rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{active.name}</strong>
          <Badge>{left === null ? "no end date" : left < 0 ? `${-left} day${left === -1 ? "" : "s"} overdue` : `${left} day${left === 1 ? "" : "s"} left`}</Badge>
          <span className="text-sm text-muted-foreground">
            {active.stats.doneCount}/{active.stats.taskCount} tasks · {formatTotal(active.stats.donePoints, project.estimationUnit)} of {formatTotal(active.stats.points, project.estimationUnit)}
          </span>
        </div>
        {project.canManage && <Button size="sm" variant="outline" onClick={() => setCompleting(true)}>Complete sprint…</Button>}
      </div>
      {active.goal && <p className="text-sm text-muted-foreground">Goal: {active.goal}</p>}
      <div className="h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-label="Sprint progress" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      {completing && (
        <CompleteSprintDialog
          workspaceId={workspace.id} projectId={project.id} sprint={active}
          planned={sprints.data?.filter((s) => s.state === "PLANNED") ?? []}
          onClose={() => setCompleting(false)}
          onDone={() => { setCompleting(false); setVersion((v) => v + 1); }}
        />
      )}
    </section>
  );
}
