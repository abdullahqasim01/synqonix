"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input, Select } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, TASK_TYPES } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";

type Project = Schemas["ProjectDetailDto"];
type Action = { type: "SET_PRIORITY" | "ASSIGN" | "ADD_LABEL" | "MOVE_TO_STATUS" | "COMMENT"; value: string };

const ACTIONS: { value: Action["type"]; label: string }[] = [
  { value: "SET_PRIORITY", label: "Set priority" },
  { value: "ASSIGN", label: "Add assignee" },
  { value: "ADD_LABEL", label: "Add label" },
  { value: "MOVE_TO_STATUS", label: "Move to status" },
  { value: "COMMENT", label: "Add comment" },
];

/** "When a task is created / moves to X, and it matches Y, do Z." */
export function AutomationCard({ project }: { project: Project }) {
  const { members } = useWorkspace();
  const path = { workspaceId: project.workspaceId, projectId: project.id };
  const rules = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/automations", { params: { path } }), [project.id]);
  const [adding, setAdding] = useState(false);
  const [trigger, setTrigger] = useState<"TASK_CREATED" | "STATUS_CHANGED">("TASK_CREATED");
  const [actions, setActions] = useState<Action[]>([{ type: "SET_PRIORITY", value: "HIGH" }]);
  const [error, setError] = useState<string | null>(null);
  const statusName = (id: string | null) => project.statuses.find((s) => s.id === id)?.name;

  const valueInput = (a: Action, i: number) => {
    const set = (value: string) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value } : x)));
    const label = `Action ${i + 1} value`;
    if (a.type === "SET_PRIORITY") return <Select aria-label={label} value={a.value} onChange={(e) => set(e.target.value)}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>;
    if (a.type === "ASSIGN") return <Select aria-label={label} value={a.value} onChange={(e) => set(e.target.value)}><option value="">Choose a person…</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>;
    if (a.type === "ADD_LABEL") return <Select aria-label={label} value={a.value} onChange={(e) => set(e.target.value)}><option value="">Choose a label…</option>{project.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>;
    if (a.type === "MOVE_TO_STATUS") return <Select aria-label={label} value={a.value} onChange={(e) => set(e.target.value)}><option value="">Choose a status…</option>{project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>;
    return <Input aria-label={label} value={a.value} maxLength={2000} placeholder="Comment text" onChange={(e) => set(e.target.value)} className="min-w-64" />;
  };

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get("type"));
    const priority = String(f.get("priority"));
    const status = String(f.get("status") ?? "");
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/automations", {
      params: { path },
      body: {
        name: String(f.get("name")), trigger, ...(trigger === "STATUS_CHANGED" && status ? { triggerStatusId: status } : {}),
        conditions: { ...(type ? { types: [type as "BUG"] } : {}), ...(priority ? { priorities: [priority as "HIGH"] } : {}) }, actions: actions.filter((a) => a.value),
      },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setAdding(false);
    setActions([{ type: "SET_PRIORITY", value: "HIGH" }]);
    rules.reload();
  }

  async function act(p: Promise<{ error?: unknown }>) {
    const { error } = await p;
    setError(error ? errorMessage(error) : null);
    rules.reload();
  }

  return (
    <Card aria-label="Automation rules">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Automation</h2>
          <p className="text-sm text-muted-foreground">Do routine updates automatically. Rules run as the person who turned them on, and a rule&apos;s changes never start another rule.</p>
        </div>
        {project.canManage && <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "New rule"}</Button>}
      </div>
      {error && <Alert>{error}</Alert>}
      {adding && (
        <form onSubmit={create} className="mb-4 grid gap-3 rounded-md border border-border p-4">
          <Field label="Name" htmlFor="au-name"><Input id="au-name" name="name" required maxLength={80} /></Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="When" htmlFor="au-trigger">
              <Select id="au-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)}><option value="TASK_CREATED">a task is created</option><option value="STATUS_CHANGED">a task changes status</option></Select>
            </Field>
            {trigger === "STATUS_CHANGED" && (
              <Field label="to" htmlFor="au-status"><Select id="au-status" name="status" defaultValue=""><option value="">any status</option>{project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            )}
            <Field label="and its type is" htmlFor="au-type"><Select id="au-type" name="type" defaultValue=""><option value="">any</option>{TASK_TYPES.filter((t) => t.value !== "SUBTASK").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
            <Field label="and priority is" htmlFor="au-priority"><Select id="au-priority" name="priority" defaultValue=""><option value="">any</option>{PRIORITIES.filter((p) => p.value !== "NONE").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Then</legend>
            {actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select aria-label={`Action ${i + 1}`} value={a.type} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { type: e.target.value as Action["type"], value: e.target.value === "SET_PRIORITY" ? "HIGH" : "" } : x)))}>
                  {ACTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </Select>
                {valueInput(a, i)}
                {actions.length > 1 && <button type="button" aria-label={`Remove action ${i + 1}`} className="text-muted-foreground hover:text-foreground" onClick={() => setActions((all) => all.filter((_, j) => j !== i))}>×</button>}
              </div>
            ))}
            {actions.length < 5 && <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={() => setActions((all) => [...all, { type: "COMMENT", value: "" }])}>+ Add another action</button>}
          </fieldset>
          <div><Button type="submit" size="sm">Save rule</Button></div>
        </form>
      )}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {rules.data?.map((r) => (
          <li key={r.id} className="grid gap-1 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="font-medium">{r.name}</strong>{" "}
                <span className="text-muted-foreground">
                  {r.trigger === "TASK_CREATED" ? "when a task is created" : `when a task moves to ${statusName(r.triggerStatusId) ?? "any status"}`} · {r.actions.length} {r.actions.length === 1 ? "action" : "actions"} · ran {r.runCount}×{!r.enabled && " · off"}
                </span>
              </span>
              {project.canManage && (
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void act(api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/automations/{ruleId}", { params: { path: { ...path, ruleId: r.id } }, body: { enabled: !r.enabled } }))}>{r.enabled ? "Turn off" : "Turn on"}</Button>
                  <button aria-label={`Delete rule ${r.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => confirm(`Delete the rule "${r.name}"?`) && void act(api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/automations/{ruleId}", { params: { path: { ...path, ruleId: r.id } } }))}>×</button>
                </span>
              )}
            </div>
            {r.lastError && <p className="text-xs text-red-600">Last problem: {r.lastError}</p>}
          </li>
        ))}
      </ul>
      {rules.data?.length === 0 && !adding && <p className="text-sm text-muted-foreground">No rules yet.</p>}
    </Card>
  );
}
