"use client";

import { useState } from "react";
import { InsightsReport } from "@/components/reports/insights-report";
import { BarChart, BurndownChart, Legend } from "@/components/charts/svg-charts";
import { Alert, Card, Select } from "@/components/ui/form";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, type Schemas } from "@/lib/api/client";
import { formatTotal } from "@/lib/estimation";
import { formatDate } from "@/lib/tasks";
import { useSprints } from "@/lib/use-agile";
import { useQuery } from "@/lib/use-query";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2" data-stat={label}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SprintReport() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const sprints = useSprints(workspace.id, project.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const started = sprints.data?.filter((s) => s.state !== "PLANNED") ?? [];
  const current = started.find((s) => s.id === chosen) ?? started.find((s) => s.state === "ACTIVE") ?? started[0];

  const burn = useQuery(
    async () => (current ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints/{sprintId}/burndown", { params: { path: { workspaceId: workspace.id, projectId: project.id, sprintId: current.id } } }) : { data: undefined }),
    [workspace.id, project.id, current?.id],
  );
  const velocity = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/velocity", { params: { path: { workspaceId: workspace.id, projectId: project.id } } }), [workspace.id, project.id]);

  const b = burn.data;
  const unit = project.estimationUnit;
  const summary = current?.summary;
  // The chart spans the planned dates, widened to include every recorded point.
  const times = b?.points.map((p) => new Date(p.at).getTime()) ?? [];
  const plannedStart = b?.sprint.startDate ? new Date(b.sprint.startDate).getTime() : b?.sprint.startedAt ? new Date(b.sprint.startedAt).getTime() : now;
  const startMs = Math.min(plannedStart, ...times);
  const endMs = Math.max(b?.sprint.endDate ? new Date(b.sprint.endDate).getTime() : startMs + 14 * 86_400_000, ...times);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-label="Sprint burndown">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Sprint report</h2>
          {started.length > 0 && (
            <Select aria-label="Sprint" value={current?.id ?? ""} onChange={(e) => setChosen(e.target.value)}>
              {started.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === "ACTIVE" ? " (active)" : ""}</option>)}
            </Select>
          )}
        </div>
        {!current ? (
          <p className="text-sm text-muted-foreground">Start a sprint to see its burndown.</p>
        ) : (
          <>
            {burn.error && <Alert>{burn.error}</Alert>}
            {b && (
              <Card className="grid gap-3">
                <BurndownChart
                  now={now} start={startMs} end={endMs}
                  points={b.points.map((p) => ({ at: new Date(p.at).getTime(), scope: p.scopePoints, remaining: p.remainingPoints }))}
                  ideal={b.ideal.map((p) => ({ at: new Date(`${p.date}T00:00:00Z`).getTime(), remaining: p.remaining }))}
                />
                <Legend items={[{ label: "Remaining", className: "bg-primary" }, { label: "Scope", className: "bg-primary/50" }, { label: "Ideal", className: "bg-muted-foreground" }]} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Data points ({b.points.length})</summary>
                  <table className="mt-2 w-full text-xs" aria-label="Burndown data">
                    <thead className="text-left text-muted-foreground"><tr><th>When</th><th>Reason</th><th>Scope</th><th>Done</th><th>Remaining</th></tr></thead>
                    <tbody>
                      {b.points.map((p, i) => (
                        <tr key={i}><td>{new Date(p.at).toLocaleString()}</td><td>{p.reason.toLowerCase().replace("_", " ")}</td><td>{p.scopePoints}</td><td>{p.donePoints}</td><td>{p.remainingPoints}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </Card>
            )}
            {summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Committed" value={formatTotal(summary.committedPoints, unit)} hint={`${summary.committedTasks} issues`} />
                <Stat label="Added" value={formatTotal(summary.addedPoints, unit)} />
                <Stat label="Removed" value={formatTotal(summary.removedPoints, unit)} />
                {current.state === "COMPLETED" ? (
                  <>
                    <Stat label="Completed" value={formatTotal(summary.completedPoints, unit)} hint={`${summary.completedTasks} issues`} />
                    <Stat label="Carried over" value={formatTotal(summary.carriedOverPoints, unit)} hint={`${summary.carriedOverTasks} issues`} />
                  </>
                ) : (
                  <Stat label="Done so far" value={formatTotal(current.stats.donePoints, unit)} hint={`${current.stats.doneCount} issues`} />
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section className="grid gap-3" aria-label="Velocity">
        <h2 className="text-lg font-medium">Velocity</h2>
        {velocity.data && velocity.data.sprints.length > 0 ? (
          <Card className="grid gap-3">
            <BarChart
              label="Velocity chart"
              groups={velocity.data.sprints.map((s) => ({
                label: `S${s.number}`,
                values: [
                  { name: "Committed", value: s.committedPoints, className: "fill-muted-foreground/40" },
                  { name: "Completed", value: s.completedPoints, className: "fill-primary" },
                ],
              }))}
            />
            <Legend items={[{ label: "Committed", className: "bg-muted-foreground/40" }, { label: "Completed", className: "bg-primary" }]} />
            <p className="text-sm text-muted-foreground" data-testid="velocity-average">
              Average {velocity.data.average} · last three sprints {velocity.data.recentAverage} ({velocity.data.unit})
            </p>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">Complete a sprint to see velocity.</p>
        )}
      </section>
    </div>
  );
}

function FlowReport() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const [days, setDays] = useState(30);
  const flow = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/flow", { params: { path: { workspaceId: workspace.id, projectId: project.id }, query: { days } } }), [workspace.id, project.id, days]);
  const f = flow.data;
  const fmt = (n: number | null) => (n === null ? "—" : `${n}d`);

  return (
    <section className="grid gap-3" aria-label="Flow metrics">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Flow</h2>
        <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </Select>
      </div>
      {f && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Finished" value={String(f.stats.count)} />
            <Stat label="In progress" value={String(f.wip)} hint="work in progress" />
            <Stat label="Lead time (median)" value={fmt(f.stats.medianLeadDays)} hint={`avg ${fmt(f.stats.avgLeadDays)}`} />
            <Stat label="Lead time (85%)" value={fmt(f.stats.p85LeadDays)} />
            <Stat label="Cycle time (median)" value={fmt(f.stats.medianCycleDays)} hint={`avg ${fmt(f.stats.avgCycleDays)}`} />
            <Stat label="Cycle time (85%)" value={fmt(f.stats.p85CycleDays)} />
          </div>
          <Card className="grid gap-2">
            <h3 className="text-sm font-medium">Throughput per week</h3>
            <BarChart label="Throughput chart" groups={f.throughput.map((w) => ({ label: w.weekStart.slice(5), values: [{ name: "Finished", value: w.count, className: "fill-primary" }] }))} />
          </Card>
          {f.tasks.length > 0 && (
            <table className="w-full text-sm" aria-label="Finished tasks">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Task</th><th>Finished</th><th>Lead</th><th>Cycle</th></tr></thead>
              <tbody className="divide-y divide-border">
                {f.tasks.slice(0, 15).map((t: Schemas["FlowTaskDto"]) => (
                  <tr key={t.key}><td className="py-1"><span className="font-mono text-xs text-muted-foreground">{t.key}</span> {t.title}</td><td>{formatDate(t.completedAt)}</td><td>{fmt(t.leadTimeDays)}</td><td>{fmt(t.cycleTimeDays)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

export default function ReportsPage() {
  const { project } = useProject();
  return (
    <div className="grid gap-8">
      {project.methodology === "SCRUM" && <SprintReport />}
      <FlowReport />
      <InsightsReport />
    </div>
  );
}
