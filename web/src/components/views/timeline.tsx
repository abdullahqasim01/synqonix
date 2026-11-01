"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Select } from "@/components/ui/form";
import { TypeIcon } from "@/components/tasks/badges";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { timelineBar, weekStart } from "@/lib/timeline";
import { useProjectEvents } from "@/lib/use-project-events";
import { useQuery } from "@/lib/use-query";
import { filterParams, type ViewState } from "@/lib/view-state";
import { cn } from "@/lib/utils";

const DAY = 24 * 60 * 60 * 1000;
const SCALES = [{ days: 14, label: "2 weeks" }, { days: 56, label: "8 weeks" }, { days: 112, label: "16 weeks" }];

/** Gantt-lite: each task is a bar from its start date to its due date. */
export function TimelineView({ state, projectId, activeKey, onOpen }: {
  state: ViewState;
  projectId?: string;
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  const { workspace } = useWorkspace();
  const [days, setDays] = useState(56);
  const [now] = useState(() => Date.now()); // fixed for the life of the view; avoids impure renders
  const [start, setStart] = useState(() => weekStart(new Date()) - 7 * DAY);

  const filterKey = JSON.stringify(filterParams(state.filters));
  const tasks = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/tasks", {
      params: { path: { workspaceId: workspace.id }, query: { ...filterParams(state.filters), projectId, sort: "startDate", order: "asc", limit: 200 } },
    }),
    [workspace.id, projectId, filterKey],
  );
  useProjectEvents(projectId, () => tasks.reload());

  const rows = (tasks.data?.items ?? [])
    .filter((t) => !(state.filters.hideDone && t.status.category === "DONE"))
    .map((t) => ({ t, bar: timelineBar({ startDate: t.startDate, dueDate: t.dueDate }, start, days) }));
  const scheduled = rows.filter((r) => r.bar);
  const unscheduled = (tasks.data?.items ?? []).filter((t) => !t.startDate && !t.dueDate).length;

  // header ticks: one per week for short windows, one per ~2 weeks for long ones
  const step = days > 60 ? 14 : 7;
  const ticks = Array.from({ length: Math.ceil(days / step) }, (_, i) => start + i * step * DAY);
  const todayPct = ((now - start) / (days * DAY)) * 100;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" aria-label="Earlier" onClick={() => setStart(start - (days / 2) * DAY)}>←</Button>
        <Button size="sm" variant="outline" onClick={() => setStart(weekStart(new Date()) - 7 * DAY)}>Today</Button>
        <Button size="sm" variant="outline" aria-label="Later" onClick={() => setStart(start + (days / 2) * DAY)}>→</Button>
        <Select aria-label="Time scale" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {SCALES.map((s) => <option key={s.days} value={s.days}>{s.label}</option>)}
        </Select>
      </div>
      {tasks.error && <Alert>{tasks.error}</Alert>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[48rem]">
          <div className="grid grid-cols-[16rem_1fr] border-b border-border bg-muted text-xs text-muted-foreground">
            <div className="px-3 py-2">Task</div>
            <div className="relative h-8">
              {ticks.map((t) => (
                <span key={t} className="absolute top-2 border-l border-border pl-1" style={{ left: `${((t - start) / (days * DAY)) * 100}%` }}>
                  {new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                </span>
              ))}
            </div>
          </div>
          {scheduled.map(({ t, bar }) => (
            <div key={t.id} className={cn("grid grid-cols-[16rem_1fr] items-center border-b border-border last:border-b-0 hover:bg-muted/40", activeKey === t.key && "bg-muted")}>
              <button className="flex min-w-0 items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => onOpen(t.key)}>
                <TypeIcon type={t.type} />
                <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{t.key}</span>
                <span className={cn("truncate", t.status.category === "DONE" && "text-muted-foreground line-through")}>{t.title}</span>
              </button>
              <div className="relative h-8">
                {todayPct >= 0 && todayPct <= 100 && <div className="absolute inset-y-0 w-px bg-red-500/60" style={{ left: `${todayPct}%` }} aria-hidden />}
                <button
                  data-bar={t.key}
                  onClick={() => onOpen(t.key)}
                  title={`${t.key} ${t.title}`}
                  aria-label={`${t.key} bar`}
                  className={cn(
                    "absolute top-1.5 h-5 min-w-1 border text-left text-[10px] leading-5 text-white",
                    bar!.clippedStart ? "rounded-l-none" : "rounded-l",
                    bar!.clippedEnd ? "rounded-r-none" : "rounded-r",
                  )}
                  style={{ left: `${bar!.left}%`, width: `${bar!.width}%`, background: t.status.color, borderColor: t.status.color }}
                />
              </div>
            </div>
          ))}
          {scheduled.length === 0 && !tasks.loading && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No scheduled tasks in this period.</p>
          )}
        </div>
      </div>
      {unscheduled > 0 && <p className="text-xs text-muted-foreground">{unscheduled} task{unscheduled === 1 ? " has" : "s have"} no start or due date and are not shown.</p>}
    </div>
  );
}
