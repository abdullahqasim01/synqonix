"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { TypeIcon } from "@/components/tasks/badges";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, type Schemas } from "@/lib/api/client";
import { addMonths, isoDay, monthGrid } from "@/lib/calendar";
import { useProjectEvents } from "@/lib/use-project-events";
import { useQuery } from "@/lib/use-query";
import { filterParams, type ViewState } from "@/lib/view-state";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

/** Month calendar of tasks by due date. */
export function CalendarView({ state, projectId, activeKey, onOpen }: {
  state: ViewState;
  projectId?: string;
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  const { workspace } = useWorkspace();
  const [anchor, setAnchor] = useState(() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); });
  const weeks = monthGrid(anchor);
  const first = weeks[0][0].iso;
  const last = weeks.at(-1)![6].iso;
  const today = isoDay(new Date());

  const filterKey = JSON.stringify(filterParams(state.filters));
  const tasks = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/tasks", {
      params: {
        path: { workspaceId: workspace.id },
        query: { ...filterParams(state.filters), projectId, dueAfter: `${first}T00:00:00.000Z`, dueBefore: `${last}T23:59:59.999Z`, sort: "dueDate", order: "asc", limit: 200 },
      },
    }),
    [workspace.id, projectId, first, last, filterKey],
  );
  useProjectEvents(projectId, () => tasks.reload());

  const byDay = new Map<string, Schemas["TaskDto"][]>();
  for (const t of tasks.data?.items ?? []) {
    if (state.filters.hideDone && t.status.category === "DONE") continue;
    const day = t.dueDate!.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setAnchor(addMonths(anchor, -1))}>←</Button>
        <Button size="sm" variant="outline" onClick={() => { const n = new Date(); setAnchor(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))); }}>Today</Button>
        <Button size="sm" variant="outline" aria-label="Next month" onClick={() => setAnchor(addMonths(anchor, 1))}>→</Button>
        <h2 className="ml-2 font-medium" aria-live="polite">{anchor.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
      </div>
      {tasks.error && <Alert>{tasks.error}</Alert>}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 bg-muted text-xs text-muted-foreground">
          {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="grid grid-cols-7 border-t border-border">
            {week.map((day) => {
              const list = byDay.get(day.iso) ?? [];
              return (
                <div key={day.iso} data-day={day.iso} className={cn("min-h-24 border-l border-border p-1 first:border-l-0", !day.inMonth && "bg-muted/40 text-muted-foreground")}>
                  <div className={cn("mb-1 text-xs", day.iso === today && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground")}>{day.date.getUTCDate()}</div>
                  <ul className="grid gap-0.5">
                    {list.slice(0, MAX_PER_DAY).map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => onOpen(t.key)}
                          title={`${t.key} ${t.title}`}
                          className={cn(
                            "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-muted",
                            activeKey === t.key && "ring-1 ring-primary",
                            t.status.category === "DONE" ? "text-muted-foreground line-through" : day.iso < today ? "text-red-600" : "",
                          )}
                        >
                          <TypeIcon type={t.type} className="w-3" />
                          <span className="truncate">{t.title}</span>
                        </button>
                      </li>
                    ))}
                    {list.length > MAX_PER_DAY && <li className="px-1 text-xs text-muted-foreground">+{list.length - MAX_PER_DAY} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {(tasks.data?.total ?? 0) > 200 && <p className="text-xs text-muted-foreground">Showing the first 200 tasks of this period; narrow the filters to see the rest.</p>}
    </div>
  );
}
