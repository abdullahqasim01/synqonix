"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/tasks/task-sections";
import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { formatClock, formatMinutes, parseDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

export const TIMER_CHANGED = "sx:timer-changed";
const announce = () => window.dispatchEvent(new Event(TIMER_CHANGED));

/** Seconds since `iso`, ticking every second (the clock starts from state, so renders stay pure). */
export function useElapsed(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? Math.max(0, (now - new Date(iso).getTime()) / 1000) : 0;
}

/** Spent vs estimated time, a start/stop timer, manual entries and who logged what. */
export function TimeTracking({ taskId, taskKey, ws, canEdit, estimate, onChanged }: {
  taskId: string; taskKey: string; ws: string; canEdit: boolean; estimate: number | null; onChanged(): void;
}) {
  const path = { workspaceId: ws, taskId };
  const data = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/time", { params: { path } }), [ws, taskId]);
  const timer = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/time/timer", { params: { path: { workspaceId: ws } } }), [ws, taskId]);
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [est, setEst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = timer.data?.entry ?? null;
  const here = running?.taskKey === taskKey;
  const elapsed = useElapsed(running?.startedAt);

  const refresh = () => { data.reload(); timer.reload(); onChanged(); announce(); };
  const fail = (e: unknown) => setError(e ? errorMessage(e) : null);

  async function start() {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/time/timer/start", { params: { path: { workspaceId: ws } }, body: { taskRef: taskKey } });
    fail(error);
    refresh();
  }
  async function stop() {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/time/timer/stop", { params: { path: { workspaceId: ws } } });
    fail(error);
    refresh();
  }
  async function log(e: React.FormEvent) {
    e.preventDefault();
    const minutes = parseDuration(duration);
    if (!minutes || minutes > 1440) return setError("Enter a time like 45m, 1h 30m or 1.5h (up to 24 hours).");
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/time", { params: { path }, body: { minutes, ...(note.trim() ? { note: note.trim() } : {}) } });
    fail(error);
    if (!error) { setDuration(""); setNote(""); }
    refresh();
  }
  async function saveEstimate() {
    const text = (est ?? "").trim();
    const minutes = text === "" ? null : parseDuration(text);
    if (text !== "" && minutes === null) return setError("Estimates look like 4h, 1h 30m or 90.");
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path }, body: { timeEstimateMinutes: minutes } });
    fail(error);
    setEst(null);
    refresh();
  }
  async function remove(id: string) {
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/time/{entryId}", { params: { path: { ...path, entryId: id } } });
    fail(error);
    refresh();
  }

  const d = data.data;
  const spent = d?.spentMinutes ?? 0;
  const over = estimate !== null && spent > estimate;

  return (
    <Section
      title="Time tracking"
      action={canEdit && (
        here
          ? <Button size="sm" variant="outline" onClick={() => void stop()}>Stop timer · {formatClock(elapsed)}</Button>
          : <Button size="sm" variant="outline" onClick={() => void start()}>{running ? `Switch timer from ${running.taskKey}` : "Start timer"}</Button>
      )}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-1" aria-label="Time summary">
        <div className="flex items-baseline justify-between text-sm">
          <span><span className={cn("font-medium", over && "text-red-600")}>{formatMinutes(spent)}</span> logged{estimate !== null && <> of {formatMinutes(estimate)} estimated{over && " (over)"}</>}</span>
          {canEdit && est === null && <button className="text-xs text-primary hover:underline" onClick={() => setEst(estimate !== null ? formatMinutes(estimate) : "")}>{estimate !== null ? "Change estimate" : "Set estimate"}</button>}
        </div>
        {estimate !== null && estimate > 0 && (
          <div className="h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={Math.min(100, Math.round((spent / estimate) * 100))} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full", over ? "bg-red-500" : "bg-primary")} style={{ width: `${Math.min(100, (spent / estimate) * 100)}%` }} />
          </div>
        )}
        {est !== null && (
          <div className="mt-1 flex items-center gap-2">
            <Input aria-label="Time estimate" value={est} placeholder="e.g. 4h" className="w-32" onChange={(e) => setEst(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveEstimate()} />
            <Button size="sm" onClick={() => void saveEstimate()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEst(null)}>Cancel</Button>
          </div>
        )}
      </div>
      {canEdit && (
        <form onSubmit={log} className="flex flex-wrap items-center gap-2">
          <Input aria-label="Time spent" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1h 30m" className="w-28" />
          <Input aria-label="What did you do?" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (optional)" className="min-w-48 flex-1" maxLength={500} />
          <Button type="submit" size="sm" variant="outline" disabled={!duration.trim()}>Log time</Button>
        </form>
      )}
      <ul aria-label="Time entries" className="divide-y divide-border rounded-md border border-border empty:hidden">
        {d?.entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="min-w-0 truncate"><strong className="font-medium">{e.userName}</strong>{e.note && <span className="text-muted-foreground"> — {e.note}</span>}{e.running && <span className="text-primary"> (running)</span>}</span>
            <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              {new Date(e.startedAt).toLocaleDateString()} <span className="tabular-nums text-foreground">{formatMinutes(e.minutes)}</span>
              {canEdit && !e.running && <button aria-label={`Delete ${formatMinutes(e.minutes)} entry`} className="hover:text-foreground" onClick={() => void remove(e.id)}>×</button>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Header pill for a running timer anywhere in the workspace. */
export function TimerPill({ ws }: { ws: string }) {
  const timer = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/time/timer", { params: { path: { workspaceId: ws } } }), [ws]);
  const entry = timer.data?.entry;
  const elapsed = useElapsed(entry?.startedAt);
  const { reload } = timer;

  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener(TIMER_CHANGED, onChange);
    const poll = setInterval(onChange, 60_000);
    return () => { window.removeEventListener(TIMER_CHANGED, onChange); clearInterval(poll); };
  }, [reload]);

  if (!entry) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs" role="status" aria-label="Timer running">
      <span aria-hidden>⏱</span>
      <a href={`/w/${ws}/tasks/${entry.taskKey}`} className="font-mono hover:underline">{entry.taskKey}</a>
      <span className="tabular-nums">{formatClock(elapsed)}</span>
      <button className="text-primary hover:underline" onClick={() => void api.POST("/api/v1/workspaces/{workspaceId}/time/timer/stop", { params: { path: { workspaceId: ws } } }).then(() => { reload(); window.dispatchEvent(new Event(TIMER_CHANGED)); })}>Stop</button>
    </div>
  );
}
