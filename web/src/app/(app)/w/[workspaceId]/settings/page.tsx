"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { WebhooksCard } from "@/components/automation/webhooks-card";
import { WorkspaceGithub } from "@/components/github/workspace-github";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { useQuery } from "@/lib/use-query";

function AuditLog({ workspaceId }: { workspaceId: string }) {
  const log = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/audit-log", { params: { path: { workspaceId }, query: { limit: 25 } } }), [workspaceId]);
  const people = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId } } }), [workspaceId]);
  const names = new Map(people.data?.map((p) => [p.userId, p.name]));
  return (
    <Card>
      <h2 className="mb-4 font-medium">Audit log</h2>
      <ul className="divide-y divide-border text-sm">
        {log.data?.map((e) => (
          <li key={e.id} className="flex justify-between gap-4 py-2">
            <span><span className="font-mono text-xs">{e.action}</span> <span className="text-muted-foreground">by {(e.actorId && names.get(e.actorId)) ?? "someone"}</span></span>
            <time className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function WorkspaceSettingsPage() {
  const { workspace, isAdmin, reload } = useWorkspace();
  const { user } = useAuth();
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const path = { workspaceId: workspace.id };

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}", { params: { path }, body: { name } });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Saved." });
    reload();
  }

  async function leave() {
    if (!user || !confirm("Leave this workspace?")) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/members/{userId}", { params: { path: { ...path, userId: user.id } } });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    router.push("/dashboard");
  }

  async function remove() {
    if (!confirm(`Delete ${workspace.name} and all its projects? This cannot be undone.`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}", { params: { path } });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    router.push("/dashboard");
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
      <Card>
        <form key={workspace.name} onSubmit={save} className="grid max-w-sm gap-4">
          {msg && <Alert variant={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <Field label="Name" htmlFor="ws-name"><Input id="ws-name" name="name" defaultValue={workspace.name} disabled={!isAdmin} required minLength={2} maxLength={60} /></Field>
          {isAdmin && <Button type="submit" className="w-fit">Save</Button>}
        </form>
      </Card>
      <Suspense><WorkspaceGithub /></Suspense>
      <WebhooksCard />
      {isAdmin && <AuditLog workspaceId={workspace.id} />}
      <Card>
        <h2 className="mb-3 font-medium">Danger zone</h2>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => void leave()}>Leave workspace</Button>
          {workspace.role === "OWNER" && <Button variant="outline" onClick={() => void remove()}>Delete workspace</Button>}
        </div>
      </Card>
    </div>
  );
}
