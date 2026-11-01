"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Select } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

type Project = Schemas["ProjectDetailDto"];
type Linked = Schemas["LinkedRepoDto"];

/** Repositories linked to a project and what happens when their pull requests and issues change. */
export function ProjectGithub({ project }: { project: Project }) {
  const path = { workspaceId: project.workspaceId, projectId: project.id };
  const repos = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/github/repos", { params: { path } }), [project.id]);
  const available = useQuery(
    () => (project.canManage ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/github/available", { params: { path } }) : Promise.resolve({ data: [] })),
    [project.id, repos.data?.length],
  );
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const options = (available.data ?? []).filter((r) => !r.linked);
  const statuses = project.statuses;

  async function link() {
    const [installationId, githubRepoId] = choice.split("|");
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/github/repos", { params: { path }, body: { installationId, githubRepoId } });
    setError(error ? errorMessage(error) : null);
    setChoice("");
    repos.reload();
  }

  async function patch(l: Linked, body: Schemas["UpdateLinkedRepoDto"]) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/github/repos/{linkId}", { params: { path: { ...path, linkId: l.id } }, body });
    setError(error ? errorMessage(error) : null);
    repos.reload();
  }

  async function unlink(l: Linked) {
    if (!confirm(`Unlink ${l.fullName}? Its branches, commits and pull requests are removed from tasks here.`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/github/repos/{linkId}", { params: { path: { ...path, linkId: l.id } } });
    setError(error ? errorMessage(error) : null);
    repos.reload();
  }

  const statusSelect = (label: string, value: string | null, effective: string | null, key: "prOpenedStatusId" | "prMergedStatusId", l: Linked) => (
    <Field label={label} htmlFor={`${l.id}-${key}`}>
      <Select id={`${l.id}-${key}`} value={value ?? ""} disabled={!project.canManage || !l.autoTransition} onChange={(e) => void patch(l, { [key]: e.target.value || null })}>
        <option value="">Default{effective ? ` (${statuses.find((s) => s.id === effective)?.name})` : " (no change)"}</option>
        {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </Field>
  );

  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={!project.canManage} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Card>
      <h2 className="mb-1 font-medium">GitHub</h2>
      <p className="mb-4 text-sm text-muted-foreground">Mention a task key such as <code>{project.key}-12</code> in a branch name, commit message or pull request to link it.</p>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4">
        {repos.data?.map((l) => (
          <section key={l.id} aria-label={`Repository ${l.fullName}`} className="grid gap-3 rounded-md border border-border p-4">
            <div className="flex items-center justify-between">
              <a href={l.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{l.fullName}</a>
              {project.canManage && <Button size="sm" variant="outline" onClick={() => void unlink(l)}>Unlink</Button>}
            </div>
            {check("Move tasks automatically when pull requests open or merge", l.autoTransition, (v) => void patch(l, { autoTransition: v }))}
            <div className="grid gap-3 sm:grid-cols-2">
              {statusSelect("When a pull request opens, move to", l.prOpenedStatusId, l.effectiveOpenedStatusId, "prOpenedStatusId", l)}
              {statusSelect("When it is merged, move to", l.prMergedStatusId, l.effectiveMergedStatusId, "prMergedStatusId", l)}
            </div>
            {check("Create a task for each new GitHub issue", l.importIssues, (v) => void patch(l, { importIssues: v }))}
            {check("Keep issues and tasks open/closed in step", l.syncIssues, (v) => void patch(l, { syncIssues: v }))}
          </section>
        ))}
        {repos.data?.length === 0 && <p className="text-sm text-muted-foreground">No repository linked yet.</p>}
        {project.canManage && (
          <div className="flex items-end gap-2">
            <Field label="Link a repository" htmlFor="gh-link">
              <Select id="gh-link" value={choice} onChange={(e) => setChoice(e.target.value)} className="w-72">
                <option value="">{options.length ? "Choose a repository…" : "No repositories available"}</option>
                {options.map((r) => <option key={r.githubRepoId} value={`${r.installationId}|${r.githubRepoId}`}>{r.fullName}</option>)}
              </Select>
            </Field>
            <Button size="sm" disabled={!choice} onClick={() => void link()}>Link</Button>
          </div>
        )}
        {project.canManage && options.length === 0 && (repos.data?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">Connect a GitHub account in the workspace settings first.</p>
        )}
      </div>
    </Card>
  );
}
