"use client";

import { useState } from "react";
import { Section } from "@/components/tasks/task-sections";
import { Badge, Alert, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

type Pr = Schemas["GithubPullRequestDto"];

const prStyle: Record<Pr["state"], string> = {
  OPEN: "bg-green-500/15 text-green-700 dark:text-green-300",
  MERGED: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  CLOSED: "bg-red-500/15 text-red-700 dark:text-red-300",
};
const ciLabel = { SUCCESS: "✓ Checks passed", FAILURE: "✗ Checks failed", PENDING: "● Checks running" } as const;
const reviewLabel = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", COMMENTED: "Reviewed" } as const;

/** Branches, pull requests (with CI and review state) and commits tied to the task. Hidden when there is nothing to show. */
export function Development({ taskId, ws, canEdit, version }: { taskId: string; ws: string; canEdit: boolean; version: number }) {
  const path = { workspaceId: ws, taskId };
  const data = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/github", { params: { path } }), [ws, taskId, version]);
  const [creating, setCreating] = useState(false);
  const [repoId, setRepoId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const d = data.data;
  if (!d) return null;
  const empty = d.pullRequests.length + d.branches.length + d.commits.length + d.issues.length === 0;
  if (empty && d.repos.length === 0) return null;

  async function create() {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/github/branches", {
      params: { path }, body: { repoId: repoId || d!.repos[0].id, ...(name.trim() ? { name: name.trim() } : {}) },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setCreating(false);
    setName("");
    data.reload();
  }

  return (
    <Section
      title="Development"
      action={canEdit && d.repos.length > 0 && <Button size="sm" variant="outline" onClick={() => { setCreating((c) => !c); setName(d.suggestedBranch); }}>Create branch</Button>}
    >
      {error && <Alert>{error}</Alert>}
      {creating && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          {d.repos.length > 1 && (
            <Select aria-label="Repository" value={repoId || d.repos[0].id} onChange={(e) => setRepoId(e.target.value)}>
              {d.repos.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
            </Select>
          )}
          <Input aria-label="Branch name" value={name} onChange={(e) => setName(e.target.value)} className="w-72 font-mono text-xs" />
          <Button size="sm" onClick={() => void create()}>Create on GitHub</Button>
        </div>
      )}
      {d.pullRequests.length > 0 && (
        <ul aria-label="Pull requests" className="divide-y divide-border rounded-md border border-border">
          {d.pullRequests.map((p) => (
            <li key={p.id} className="grid gap-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn(prStyle[p.state])}>{p.draft && p.state === "OPEN" ? "Draft" : p.state.toLowerCase()}</Badge>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">#{p.number} {p.title}</a>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{p.repo} · {p.headBranch} → {p.baseBranch} · {p.authorName ?? p.authorLogin}</span>
                {p.ci && <span className={cn(p.ci === "SUCCESS" && "text-green-600", p.ci === "FAILURE" && "text-red-600")}>{ciLabel[p.ci]}</span>}
                {p.reviewState && <span>{reviewLabel[p.reviewState]}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {d.branches.length > 0 && (
        <ul aria-label="Branches" className="grid gap-1 text-sm">
          {d.branches.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <span aria-hidden>⎇</span>
              <a href={b.url} target="_blank" rel="noopener noreferrer" className={cn("font-mono text-xs text-primary hover:underline", b.deleted && "line-through opacity-60")}>{b.name}</a>
              <span className="text-xs text-muted-foreground">{b.repo}{b.deleted && " · deleted"}</span>
            </li>
          ))}
        </ul>
      )}
      {d.commits.length > 0 && (
        <ul aria-label="Commits" className="divide-y divide-border rounded-md border border-border">
          {d.commits.map((c) => (
            <li key={`${c.repo}${c.sha}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{c.message}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {c.authorName ?? c.authorLogin}
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">{c.sha.slice(0, 7)}</a>
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.issues.length > 0 && (
        <ul aria-label="GitHub issues" className="grid gap-1 text-sm">
          {d.issues.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <Badge>{i.state.toLowerCase()}</Badge>
              <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{i.repo}#{i.number} {i.title}</a>
            </li>
          ))}
        </ul>
      )}
      {empty && <p className="text-sm text-muted-foreground">Nothing yet. Name this task in a branch, commit or pull request to link it.</p>}
    </Section>
  );
}
