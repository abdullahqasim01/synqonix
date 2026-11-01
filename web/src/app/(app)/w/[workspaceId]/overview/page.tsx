"use client";

import Link from "next/link";
import { Alert, Card } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className="rounded-md border border-border px-4 py-3" data-stat={label}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone === "bad" && value > 0 ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}

/** Workspace dashboard: every project the person can see, and who is carrying how much. */
export default function OverviewPage() {
  const { workspace } = useWorkspace();
  const data = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/insights/overview", { params: { path: { workspaceId: workspace.id } } }), [workspace.id]);
  const d = data.data;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      {data.error && <Alert>{data.error}</Alert>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Projects" value={d.projects.length} />
            <Stat label="Open tasks" value={d.totalOpen} />
            <Stat label="Overdue" value={d.totalOverdue} tone="bad" />
            <Stat label="Resolved (14 days)" value={d.projects.reduce((n, p) => n + p.resolvedLast14Days, 0)} />
          </div>
          <Card className="overflow-x-auto" aria-label="Projects overview">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="pb-2">Project</th><th>Open</th><th>Done</th><th>Overdue</th><th>Created (14d)</th><th>Resolved (14d)</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.projects.map((p) => (
                  <tr key={p.projectId}>
                    <td className="py-2"><Link href={`/w/${workspace.id}/projects/${p.projectId}/reports`} className="font-medium text-primary hover:underline">{p.name}</Link> <span className="text-xs text-muted-foreground">{p.key}</span></td>
                    <td>{p.open}</td><td>{p.done}</td><td className={p.overdue ? "text-red-600" : ""}>{p.overdue}</td><td>{p.createdLast14Days}</td><td>{p.resolvedLast14Days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.projects.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.</p>}
          </Card>
          <Card aria-label="Workload across projects" className="overflow-x-auto">
            <h2 className="mb-2 font-medium">Workload</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2">Person</th><th>Open tasks</th><th>Open points</th><th>Overdue</th><th>Done (30d)</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.workload.map((r) => (
                  <tr key={r.userId ?? "none"}><td className="py-1.5">{r.name}</td><td>{r.openTasks}</td><td>{r.openPoints}</td><td className={r.overdueTasks ? "text-red-600" : ""}>{r.overdueTasks}</td><td>{r.doneLast30Days}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
