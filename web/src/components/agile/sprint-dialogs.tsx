"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";

type Sprint = Schemas["SprintDto"];

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.000Z`).toISOString();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="grid w-full max-w-md gap-4 rounded-lg border border-border bg-background p-5 shadow-xl">
        <h2 className="font-medium">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Start a planned sprint: pick its dates and capacity. */
export function StartSprintDialog({ workspaceId, projectId, sprint, defaultDays, onClose, onDone }: {
  workspaceId: string; projectId: string; sprint: Sprint; defaultDays: number; onClose: () => void; onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const start = sprint.startDate ? isoDay(new Date(sprint.startDate)) : isoDay(new Date());
  const end = sprint.endDate ? isoDay(new Date(sprint.endDate)) : isoDay(new Date(new Date(start).getTime() + defaultDays * 86_400_000));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const capacity = String(f.get("capacity"));
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints/{sprintId}/start", {
      params: { path: { workspaceId, projectId, sprintId: sprint.id } },
      body: { startDate: dayStart(String(f.get("start"))), endDate: dayEnd(String(f.get("end"))), ...(capacity ? { capacity: Number(capacity) } : {}) },
    });
    if (error) return setError(errorMessage(error));
    onDone();
  }

  return (
    <Modal title={`Start ${sprint.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{sprint.stats.taskCount} tasks · {sprint.stats.points} points committed.</p>
      <form onSubmit={submit} className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" htmlFor="ss-start"><Input id="ss-start" name="start" type="date" defaultValue={start} required /></Field>
          <Field label="End" htmlFor="ss-end"><Input id="ss-end" name="end" type="date" defaultValue={end} required /></Field>
        </div>
        <Field label="Capacity" htmlFor="ss-cap"><Input id="ss-cap" name="capacity" type="number" min={0} step="0.5" defaultValue={sprint.capacity ?? ""} className="w-32" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Start sprint</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Complete the active sprint and decide what happens to unfinished work. */
export function CompleteSprintDialog({ workspaceId, projectId, sprint, planned, onClose, onDone }: {
  workspaceId: string; projectId: string; sprint: Sprint; planned: Sprint[]; onClose: () => void; onDone: () => void;
}) {
  const [carry, setCarry] = useState<"BACKLOG" | "NEXT_SPRINT" | "SPRINT">("NEXT_SPRINT");
  const [target, setTarget] = useState(planned[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const open = sprint.stats.taskCount - sprint.stats.doneCount;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints/{sprintId}/complete", {
      params: { path: { workspaceId, projectId, sprintId: sprint.id } },
      body: { carryOver: carry, ...(carry === "SPRINT" ? { targetSprintId: target } : {}) },
    });
    if (error) return setError(errorMessage(error));
    onDone();
  }

  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        {sprint.stats.doneCount} of {sprint.stats.taskCount} tasks are done ({sprint.stats.donePoints} of {sprint.stats.points} points).
      </p>
      <form onSubmit={submit} className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        {open > 0 ? (
          <Field label={`What should happen to the ${open} unfinished task${open === 1 ? "" : "s"}?`} htmlFor="cs-carry">
            <Select id="cs-carry" value={carry} onChange={(e) => setCarry(e.target.value as typeof carry)} className="w-full">
              <option value="NEXT_SPRINT">Move to the next sprint</option>
              <option value="BACKLOG">Move to the backlog</option>
              <option value="SPRINT" disabled={planned.length === 0}>Move to a specific sprint…</option>
            </Select>
          </Field>
        ) : <p className="text-sm">Everything is done. Nice work!</p>}
        {open > 0 && carry === "SPRINT" && (
          <Select aria-label="Target sprint" value={target} onChange={(e) => setTarget(e.target.value)}>
            {planned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Complete sprint</Button>
        </div>
      </form>
    </Modal>
  );
}
