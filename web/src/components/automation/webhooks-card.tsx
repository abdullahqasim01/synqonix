"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input, Select } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, API_URL, errorMessage, type Schemas } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

type Hook = Schemas["WebhookDto"];

const EVENTS = [
  { value: "task.created", label: "Task created" },
  { value: "task.updated", label: "Task updated" },
  { value: "task.status_changed", label: "Status changed" },
  { value: "task.commented", label: "Comment added" },
  { value: "task.deleted", label: "Task deleted" },
] as const;

function Deliveries({ hook }: { hook: Hook }) {
  const { workspace } = useWorkspace();
  const path = { workspaceId: workspace.id, webhookId: hook.id };
  const list = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}/deliveries", { params: { path } }), [hook.id]);
  return (
    <div className="mt-2 grid gap-1 text-xs" aria-label={`Deliveries of ${hook.name}`}>
      {list.data?.length === 0 && <p className="text-muted-foreground">Nothing sent yet.</p>}
      {list.data?.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
          <span><span className="font-mono">{d.event}</span> · <span className={d.status === "FAILED" ? "text-red-600" : d.status === "SUCCESS" ? "text-green-600" : "text-muted-foreground"}>{d.status.toLowerCase()}</span>{d.responseStatus ? ` · ${d.responseStatus}` : ""}{d.error ? ` · ${d.error}` : ""} · {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"} · {new Date(d.createdAt).toLocaleString()}</span>
          <button className="text-primary hover:underline" onClick={() => void api.POST("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver", { params: { path: { ...path, deliveryId: d.id } } }).then(list.reload)}>Resend</button>
        </div>
      ))}
    </div>
  );
}

/** Admin-only: endpoints that receive signed JSON for task events. */
export function WebhooksCard() {
  const { workspace, isAdmin } = useWorkspace();
  const path = { workspaceId: workspace.id };
  const hooks = useQuery(() => (isAdmin ? api.GET("/api/v1/workspaces/{workspaceId}/webhooks", { params: { path } }) : Promise.resolve({ data: [] as Hook[] })), [workspace.id, isAdmin]);
  const projects = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path } }), [workspace.id]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  if (!isAdmin) return null;

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const events = f.getAll("events").map(String) as (typeof EVENTS)[number]["value"][];
    const projectId = String(f.get("projectId") ?? "");
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/webhooks", {
      params: { path }, body: { name: String(f.get("name")), url: String(f.get("url")), events, ...(projectId ? { projectId } : {}) },
    });
    if (!data) return setError(errorMessage(error));
    setError(null);
    setAdding(false);
    setSecret({ name: data.name, value: data.secret });
    hooks.reload();
  }

  async function act(p: Promise<{ error?: unknown }>) {
    const { error } = await p;
    setError(error ? errorMessage(error) : null);
    hooks.reload();
  }

  async function test(h: Hook) {
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}/test", { params: { path: { ...path, webhookId: h.id } } });
    setTests((t) => ({ ...t, [h.id]: data ? (data.ok ? `Delivered (HTTP ${data.responseStatus})` : `Failed: ${data.error ?? `HTTP ${data.responseStatus}`}`) : errorMessage(error) }));
  }

  async function rotate(h: Hook) {
    if (!confirm(`Create a new signing secret for ${h.name}? The old one stops working immediately.`)) return;
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}/rotate-secret", { params: { path: { ...path, webhookId: h.id } } });
    if (!data) return setError(errorMessage(error));
    setSecret({ name: h.name, value: data.secret });
  }

  return (
    <Card aria-label="Webhooks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Send signed JSON to your own service when tasks change. Requests carry <code>X-Synqonix-Signature</code> (HMAC-SHA256 of <code>timestamp.body</code>).{" "}
            <a href={`${API_URL}/docs`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">API reference</a>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add webhook"}</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {secret && (
        <Alert variant="success">
          Signing secret for <strong>{secret.name}</strong> — copy it now, it will not be shown again:
          <code className="mt-1 block break-all rounded bg-background px-2 py-1 text-xs" data-testid="webhook-secret">{secret.value}</code>
          <button className="mt-1 text-xs underline" onClick={() => setSecret(null)}>I have saved it</button>
        </Alert>
      )}
      {adding && (
        <form onSubmit={create} className="mb-4 grid gap-3 rounded-md border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="wh-name"><Input id="wh-name" name="name" required maxLength={80} /></Field>
            <Field label="Payload URL" htmlFor="wh-url" hint="Must be public and use https"><Input id="wh-url" name="url" type="url" required placeholder="https://example.com/hooks/synqonix" /></Field>
            <Field label="Project" htmlFor="wh-project">
              <Select id="wh-project" name="projectId" defaultValue=""><option value="">All projects</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </Field>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Events</legend>
            {EVENTS.map((ev) => (
              <label key={ev.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="events" value={ev.value} defaultChecked={ev.value !== "task.updated"} />{ev.label} <span className="font-mono text-xs text-muted-foreground">{ev.value}</span></label>
            ))}
          </fieldset>
          <div><Button type="submit" size="sm">Create webhook</Button></div>
        </form>
      )}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {hooks.data?.map((h) => (
          <li key={h.id} className="grid gap-1 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><strong className="font-medium">{h.name}</strong> <span className="text-muted-foreground">{h.url} · {h.events.length} events{h.projectId ? " · one project" : ""}{!h.active && " · off"}</span></span>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <button className="text-primary hover:underline" onClick={() => void test(h)}>Send test</button>
                <button className="text-primary hover:underline" onClick={() => setOpen(open === h.id ? null : h.id)}>{open === h.id ? "Hide deliveries" : "Deliveries"}</button>
                <button className="text-primary hover:underline" onClick={() => void act(api.PATCH("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}", { params: { path: { ...path, webhookId: h.id } }, body: { active: !h.active } }))}>{h.active ? "Turn off" : "Turn on"}</button>
                <button className="text-primary hover:underline" onClick={() => void rotate(h)}>New secret</button>
                <button aria-label={`Delete ${h.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => confirm(`Delete the webhook "${h.name}"?`) && void act(api.DELETE("/api/v1/workspaces/{workspaceId}/webhooks/{webhookId}", { params: { path: { ...path, webhookId: h.id } } }))}>×</button>
              </span>
            </div>
            {h.disabledReason && <Alert>{h.disabledReason}. Turn it on again once the endpoint works.</Alert>}
            {tests[h.id] && <p className="text-xs text-muted-foreground" role="status">{tests[h.id]}</p>}
            {open === h.id && <Deliveries hook={h} />}
          </li>
        ))}
      </ul>
      {hooks.data?.length === 0 && !adding && <p className="text-sm text-muted-foreground">No webhooks yet.</p>}
    </Card>
  );
}
