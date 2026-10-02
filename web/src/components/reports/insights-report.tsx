"use client";

import Link from "next/link";
import { useState } from "react";
import { BarChart, Legend, StackedAreaChart } from "@/components/charts/svg-charts";
import { Card, Select } from "@/components/ui/form";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { labelIndexes } from "@/lib/charts";
import { formatDate } from "@/lib/tasks";
import { formatMinutes } from "@/lib/time";
import { useQuery } from "@/lib/use-query";

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Created vs resolved, cumulative flow, workload, overdue work and logged time for a project. */
export function InsightsReport() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const [days, setDays] = useState(30);
  const path = { workspaceId: workspace.id, projectId: project.id };
  const bucket = days > 60 ? "week" : "day";
  const created = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/insights/created-resolved", { params: { path, query: { days, bucket } } }), [project.id, days]);
  const flow = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/insights/cumulative-flow", { params: { path, query: { days } } }), [project.id, days]);
  const workload = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/insights/workload", { params: { path } }), [project.id]);
  const overdue = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/insights/overdue", { params: { path } }), [project.id]);
  const time = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/insights/time", { params: { path } }), [project.id]);

  const c = created.data;
  const f = flow.data;
  const showCreated = c ? labelIndexes(c.points.length, 8) : new Set<number>();

  return (
    <section className="grid gap-6" aria-label="Project insights">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Insights</h2>
        <Select aria-label="Insights period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </Select>
      </div>

      {c && (
        <Card className="grid gap-2" aria-label="Created vs resolved">
          <h3 className="text-sm font-medium">Created vs resolved{bucket === "week" ? " per week" : ""}</h3>
          <BarChart
            label="Created vs resolved chart"
            groups={c.points.map((p, i) => ({
              label: showCreated.has(i) ? dayLabel(p.date) : "",
              values: [{ name: "Created", value: p.created, className: "fill-muted-foreground/50" }, { name: "Resolved", value: p.resolved, className: "fill-primary" }],
            }))}
          />
          <Legend items={[{ label: "Created", className: "bg-muted-foreground/50" }, { label: "Resolved", className: "bg-primary" }]} />
          <p className="text-sm text-muted-foreground" data-testid="created-resolved-totals">{c.totalCreated} created · {c.totalResolved} resolved · {c.openNow} open now</p>
        </Card>
      )}

      {f && (
        <Card className="grid gap-2" aria-label="Cumulative flow">
          <h3 className="text-sm font-medium">Cumulative flow</h3>
          <StackedAreaChart
            label="Cumulative flow chart"
            labels={f.points.map((p) => dayLabel(p.date))}
            series={[
              { name: "Done", className: "fill-green-500/70", values: f.points.map((p) => p.done) },
              { name: "In progress", className: "fill-primary/70", values: f.points.map((p) => p.inProgress) },
              { name: "To do", className: "fill-muted-foreground/40", values: f.points.map((p) => p.todo) },
            ]}
          />
          <Legend items={[{ label: "Done", className: "bg-green-500/70" }, { label: "In progress", className: "bg-primary/70" }, { label: "To do", className: "bg-muted-foreground/40" }]} />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Data table</summary>
            <table className="mt-2 w-full text-xs" aria-label="Cumulative flow data">
              <thead className="text-left text-muted-foreground"><tr><th>Day</th><th>To do</th><th>In progress</th><th>Done</th><th>Total</th></tr></thead>
              <tbody>{f.points.map((p) => <tr key={p.date}><td>{p.date}</td><td>{p.todo}</td><td>{p.inProgress}</td><td>{p.done}</td><td>{p.total}</td></tr>)}</tbody>
            </table>
          </details>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-label="Workload" className="grid gap-2">
          <h3 className="text-sm font-medium">Workload</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Person</th><th>Open</th><th>Points</th><th>Overdue</th><th>Done (30d)</th></tr></thead>
            <tbody className="divide-y divide-border">
              {workload.data?.rows.map((r) => (
                <tr key={r.userId ?? "none"}><td className="py-1">{r.name}</td><td>{r.openTasks}</td><td>{r.openPoints}</td><td className={r.overdueTasks ? "text-red-600" : ""}>{r.overdueTasks}</td><td>{r.doneLast30Days}</td></tr>
              ))}
            </tbody>
          </table>
          {workload.data?.rows.length === 0 && <p className="text-sm text-muted-foreground">No open work.</p>}
        </Card>

        <Card aria-label="Overdue tasks" className="grid gap-2">
          <h3 className="text-sm font-medium">Overdue</h3>
          <ul className="divide-y divide-border text-sm">
            {overdue.data?.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-1.5">
                <Link href={`/w/${workspace.id}/tasks/${t.key}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs text-muted-foreground">{t.key}</span> {t.title}</Link>
                <span className="shrink-0 text-xs text-red-600">{t.daysOverdue}d · {formatDate(t.dueDate)}</span>
              </li>
            ))}
          </ul>
          {overdue.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing is overdue.</p>}
        </Card>
      </div>

      {time.data && (
        <Card aria-label="Time report" className="grid gap-3">
          <h3 className="text-sm font-medium">Time logged (last 30 days)</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border px-3 py-2" data-stat="Logged"><div className="text-xs text-muted-foreground">Logged</div><div className="text-lg font-semibold">{formatMinutes(time.data.totalMinutes)}</div></div>
            <div className="rounded-md border border-border px-3 py-2" data-stat="Estimated"><div className="text-xs text-muted-foreground">Estimated (tasks with an estimate)</div><div className="text-lg font-semibold">{formatMinutes(time.data.estimatedMinutes)}</div></div>
            <div className="rounded-md border border-border px-3 py-2" data-stat="Actual"><div className="text-xs text-muted-foreground">Actual on those tasks</div><div className="text-lg font-semibold">{formatMinutes(time.data.actualMinutesOnEstimated)}</div></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ul className="text-sm" aria-label="Time by person">
              {time.data.byUser.map((u) => <li key={u.userId} className="flex justify-between py-0.5"><span>{u.name}</span><span className="tabular-nums">{formatMinutes(u.minutes)}</span></li>)}
            </ul>
            <ul className="text-sm" aria-label="Time by task">
              {time.data.byTask.slice(0, 8).map((t) => (
                <li key={t.key} className="flex justify-between gap-2 py-0.5">
                  <Link href={`/w/${workspace.id}/tasks/${t.key}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs text-muted-foreground">{t.key}</span> {t.title}</Link>
                  <span className="shrink-0 tabular-nums">{formatMinutes(t.spentMinutes)}{t.estimateMinutes ? ` / ${formatMinutes(t.estimateMinutes)}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          {time.data.totalMinutes === 0 && <p className="text-sm text-muted-foreground">No time logged yet. Use the timer on a task.</p>}
        </Card>
      )}
    </section>
  );
}
