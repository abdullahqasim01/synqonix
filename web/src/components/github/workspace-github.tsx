"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Select } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "GitHub connected." },
  taken: { ok: false, text: "That GitHub installation is already connected to another workspace." },
  error: { ok: false, text: "We could not finish connecting GitHub. Try again." },
};

/** Connect GitHub accounts and map GitHub logins to workspace members. */
export function WorkspaceGithub() {
  const { workspace, isAdmin, members } = useWorkspace();
  const params = useSearchParams();
  const path = { workspaceId: workspace.id };
  const status = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/github", { params: { path } }), [workspace.id]);
  const contributors = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/github/contributors", { params: { path } }), [workspace.id]);
  const [error, setError] = useState<string | null>(null);
  const notice = NOTICES[params.get("github") ?? ""];

  async function connect() {
    const { data, error } = await api.GET("/api/v1/workspaces/{workspaceId}/github/install-url", { params: { path } });
    if (!data) return setError(errorMessage(error));
    window.location.href = data.url;
  }

  async function disconnect(id: string, account: string) {
    if (!confirm(`Disconnect ${account}? Linked repositories and their GitHub history in Synqonix are removed. Uninstall the app on GitHub to stop its access completely.`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/github/installations/{installationId}", { params: { path: { ...path, installationId: id } } });
    setError(error ? errorMessage(error) : null);
    status.reload();
  }

  async function map(login: string, userId: string) {
    const { error } = await api.PUT("/api/v1/workspaces/{workspaceId}/github/contributors/{login}", { params: { path: { ...path, login } }, body: { userId: userId || null } });
    setError(error ? errorMessage(error) : null);
    contributors.reload();
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">GitHub</h2>
      <p className="mb-4 text-sm text-muted-foreground">Link repositories to projects to see branches, commits, pull requests and CI on tasks, and to move tasks automatically.</p>
      {notice && <Alert variant={notice.ok ? "success" : "error"}>{notice.text}</Alert>}
      {error && <Alert>{error}</Alert>}
      {status.data && !status.data.configured && (
        <Alert variant="info">The GitHub App is not configured on this server yet. Set the <code>GITHUB_APP_*</code> and <code>GITHUB_WEBHOOK_SECRET</code> variables (see docs).</Alert>
      )}
      <ul className="my-3 divide-y divide-border rounded-md border border-border empty:hidden">
        {status.data?.installations.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span><strong className="font-medium">{i.accountLogin}</strong> <span className="text-muted-foreground">{i.accountType.toLowerCase()} · {i.repositoryCount} linked {i.repositoryCount === 1 ? "repository" : "repositories"}{i.suspended && " · suspended"}</span></span>
            {isAdmin && <Button size="sm" variant="outline" onClick={() => void disconnect(i.id, i.accountLogin)}>Disconnect</Button>}
          </li>
        ))}
      </ul>
      {isAdmin && status.data?.configured && <Button size="sm" onClick={() => void connect()}>Connect a GitHub account</Button>}

      {(contributors.data?.length ?? 0) > 0 && (
        <div className="mt-6 grid gap-2">
          <h3 className="text-sm font-medium">GitHub contributors</h3>
          <p className="text-xs text-muted-foreground">Map GitHub logins to people so automatic updates and pull requests are credited to them.</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {contributors.data?.map((c) => (
              <li key={c.login} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-xs">{c.login}</span>
                <Select aria-label={`Member for ${c.login}`} value={c.userId ?? ""} disabled={!isAdmin} onChange={(e) => void map(c.login, e.target.value)} className="w-48">
                  <option value="">Not mapped</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
