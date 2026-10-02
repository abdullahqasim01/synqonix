"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, TASK_TYPES, type TaskPriority, type TaskType } from "@/lib/tasks";
import { describeRecurrence, toLocalInput } from "@/lib/recurrence";
import { useQuery } from "@/lib/use-query";

type Project = Schemas["ProjectDetailDto"];

export function Templates({ project }: { project: Project }) {
  const path = { workspaceId: project.workspaceId, projectId: project.id };
  const list = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates", { params: { path } }), [project.id]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const items = String(f.get("checklist") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const description = String(f.get("description") ?? "").trim();
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates", {
      params: { path },
      body: {
        name: String(f.get("name")), title: String(f.get("title")), type: f.get("type") as TaskType, priority: f.get("priority") as TaskPriority,
        ...(description ? { description } : {}), ...(items.length ? { checklists: [{ title: "Checklist", items }] } : {}),
      },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setAdding(false);
    list.reload();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete the template "${name}"?`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates/{templateId}", { params: { path: { ...path, templateId: id } } });
    setError(error ? errorMessage(error) : null);
    list.reload();
  }

  return (
    <Card aria-label="Task templates">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Task templates</h2>
          <p className="text-sm text-muted-foreground">Start new tasks from a saved shape: title, description, type, priority and a checklist. Pick one in the New task dialog.</p>
        </div>
        {project.canManage && <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "New template"}</Button>}
      </div>
      {error && <Alert>{error}</Alert>}
      {adding && (
        <form onSubmit={create} className="mb-4 grid gap-3 rounded-md border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Template name" htmlFor="tpl-name"><Input id="tpl-name" name="name" required maxLength={80} /></Field>
            <Field label="Task title" htmlFor="tpl-title"><Input id="tpl-title" name="title" required maxLength={300} /></Field>
            <Field label="Type" htmlFor="tpl-type"><Select id="tpl-type" name="type" defaultValue="TASK">{TASK_TYPES.filter((t) => t.value !== "SUBTASK").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
            <Field label="Priority" htmlFor="tpl-priority"><Select id="tpl-priority" name="priority" defaultValue="NONE">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          </div>
          <Field label="Description" htmlFor="tpl-desc"><Textarea id="tpl-desc" name="description" rows={3} /></Field>
          <Field label="Checklist items" htmlFor="tpl-check" hint="One per line"><Textarea id="tpl-check" name="checklist" rows={3} /></Field>
          <div><Button type="submit" size="sm">Save template</Button></div>
        </form>
      )}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {list.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span><strong className="font-medium">{t.name}</strong> <span className="text-muted-foreground">→ {t.title} · {t.type.toLowerCase()}{t.checklists.length > 0 && ` · ${t.checklists.reduce((n, c) => n + c.items.length, 0)} checklist items`}</span></span>
            {project.canManage && <button aria-label={`Delete template ${t.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => void remove(t.id, t.name)}>×</button>}
          </li>
        ))}
      </ul>
      {list.data?.length === 0 && !adding && <p className="text-sm text-muted-foreground">No templates yet. You can also save any task as a template from its Actions menu.</p>}
    </Card>
  );
}

export function RecurringTasks({ project }: { project: Project }) {
  const { members } = useWorkspace();
  const path = { workspaceId: project.workspaceId, projectId: project.id };
  const list = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/recurring", { params: { path } }), [project.id]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [defaultStart] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)));

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const assignee = String(f.get("assignee") ?? "");
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/recurring", {
      params: { path },
      body: {
        name: String(f.get("name")), title: String(f.get("title")), frequency: f.get("frequency") as "DAILY" | "WEEKLY" | "MONTHLY", interval: Number(f.get("interval")),
        startsAt: new Date(String(f.get("startsAt"))).toISOString(), ...(assignee ? { assigneeIds: [assignee] } : {}),
      },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setAdding(false);
    list.reload();
  }

  async function patch(id: string, body: Schemas["UpdateRecurringDto"]) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/recurring/{recurringId}", { params: { path: { ...path, recurringId: id } }, body });
    setError(error ? errorMessage(error) : null);
    list.reload();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Tasks it already created stay.`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/recurring/{recurringId}", { params: { path: { ...path, recurringId: id } } });
    setError(error ? errorMessage(error) : null);
    list.reload();
  }

  return (
    <Card aria-label="Recurring tasks">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Recurring tasks</h2>
          <p className="text-sm text-muted-foreground">Create a task on a schedule. Use <code>{"{date}"}</code> in the title for the day it was created.</p>
        </div>
        {project.canManage && <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "New recurring task"}</Button>}
      </div>
      {error && <Alert>{error}</Alert>}
      {adding && (
        <form onSubmit={create} className="mb-4 grid gap-3 rounded-md border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="rec-name"><Input id="rec-name" name="name" required maxLength={80} /></Field>
            <Field label="Task title" htmlFor="rec-title"><Input id="rec-title" name="title" required maxLength={300} defaultValue="Weekly triage {date}" /></Field>
            <Field label="Repeats" htmlFor="rec-freq">
              <div className="flex items-center gap-2">
                <span className="text-sm">Every</span>
                <Input id="rec-interval" aria-label="Interval" name="interval" type="number" min={1} max={52} defaultValue={1} className="w-20" />
                <Select id="rec-freq" aria-label="Frequency" name="frequency" defaultValue="WEEKLY"><option value="DAILY">day(s)</option><option value="WEEKLY">week(s)</option><option value="MONTHLY">month(s)</option></Select>
              </div>
            </Field>
            <Field label="First run" htmlFor="rec-start"><Input id="rec-start" name="startsAt" type="datetime-local" required defaultValue={defaultStart} /></Field>
            <Field label="Assign to" htmlFor="rec-assignee">
              <Select id="rec-assignee" name="assignee" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>
            </Field>
          </div>
          <div><Button type="submit" size="sm">Save</Button></div>
        </form>
      )}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {list.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>
              <strong className="font-medium">{r.name}</strong>{" "}
              <span className="text-muted-foreground">{describeRecurrence(r.frequency, r.interval)} · {r.active ? `next ${new Date(r.nextRunAt).toLocaleString()}` : "paused"}{r.lastTaskKey && ` · last ${r.lastTaskKey}`}</span>
            </span>
            {project.canManage && (
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void patch(r.id, { active: !r.active })}>{r.active ? "Pause" : "Resume"}</Button>
                <button aria-label={`Delete ${r.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => void remove(r.id, r.name)}>×</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {list.data?.length === 0 && !adding && <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
    </Card>
  );
}
