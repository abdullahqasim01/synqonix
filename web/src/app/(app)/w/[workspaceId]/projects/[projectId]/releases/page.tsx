"use client";

import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input, Select } from "@/components/ui/form";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/tasks";
import { useMilestones, useReleases } from "@/lib/use-agile";
import { useQuery } from "@/lib/use-query";

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{done}/{total} done</span>
    </div>
  );
}

function Notes({ workspaceId, projectId, release }: { workspaceId: string; projectId: string; release: Schemas["ReleaseDto"] }) {
  const notes = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases/{releaseId}/notes", { params: { path: { workspaceId, projectId, releaseId: release.id } } }), [workspaceId, projectId, release.id, release.counts.done]);
  const [copied, setCopied] = useState(false);
  if (!notes.data) return <p className="text-sm text-muted-foreground">Loading notes…</p>;
  return (
    <div className="grid gap-2 rounded-md border border-border p-3" aria-label={`Release notes for ${release.name}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Release notes</h4>
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(notes.data!.markdown).then(() => setCopied(true))}>{copied ? "Copied" : "Copy markdown"}</Button>
      </div>
      <Markdown>{notes.data.markdown}</Markdown>
      {notes.data.unfinished > 0 && <p className="text-xs text-muted-foreground">{notes.data.unfinished} unfinished task{notes.data.unfinished === 1 ? " is" : "s are"} not included.</p>}
    </div>
  );
}

function Releases() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const ws = workspace.id;
  const [version, setVersion] = useState(0);
  const releases = useReleases(ws, project.id, version);
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [shipping, setShipping] = useState<string | null>(null);
  const path = { workspaceId: ws, projectId: project.id };
  const reload = () => setVersion((v) => v + 1);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = String(f.get("date"));
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases", { params: { path }, body: { name: String(f.get("name")), ...(date ? { releaseDate: `${date}T00:00:00.000Z` } : {}) } });
    setError(error ? errorMessage(error) : null);
    if (!error) form.reset();
    reload();
  }

  async function ship(r: Schemas["ReleaseDto"], moveTo: string) {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases/{releaseId}/ship", { params: { path: { ...path, releaseId: r.id } }, body: moveTo ? { moveUnfinishedTo: moveTo } : {} });
    setError(error ? errorMessage(error) : null);
    setShipping(null);
    reload();
  }

  const unreleased = releases.data?.filter((r) => r.status === "UNRELEASED") ?? [];
  return (
    <section className="grid gap-3" aria-label="Releases">
      <h2 className="text-lg font-medium">Releases</h2>
      <p className="text-sm text-muted-foreground">A release is a fix version: assign tasks to it from the task page, then ship it to get release notes.</p>
      {error && <Alert>{error}</Alert>}
      {project.canManage && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Field label="Name" htmlFor="rel-name"><Input id="rel-name" name="name" required maxLength={60} placeholder="v1.0" className="w-48" /></Field>
          <Field label="Planned date" htmlFor="rel-date"><Input id="rel-date" name="date" type="date" /></Field>
          <Button type="submit">Create release</Button>
        </form>
      )}
      <ul className="grid gap-3">
        {releases.data?.map((r) => (
          <li key={r.id}>
            <Card className="grid gap-2" data-release={r.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <strong>{r.name}</strong>
                  <Badge>{r.status.toLowerCase()}</Badge>
                  {r.releasedAt ? <span className="text-xs text-muted-foreground">released {formatDate(r.releasedAt)}</span> : r.releaseDate && <span className="text-xs text-muted-foreground">planned {formatDate(r.releaseDate)}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNotesFor(notesFor === r.id ? null : r.id)}>{notesFor === r.id ? "Hide notes" : "Release notes"}</Button>
                  {project.canManage && r.status === "UNRELEASED" && <Button size="sm" onClick={() => setShipping(shipping === r.id ? null : r.id)}>Ship…</Button>}
                  {project.canManage && r.status !== "RELEASED" && (
                    <Button size="sm" variant="ghost" onClick={() => void api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases/{releaseId}", { params: { path: { ...path, releaseId: r.id } }, body: { status: r.status === "ARCHIVED" ? "UNRELEASED" : "ARCHIVED" } }).then(reload)}>{r.status === "ARCHIVED" ? "Unarchive" : "Archive"}</Button>
                  )}
                  {project.canManage && <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete release ${r.name}? Tasks keep existing but lose this fix version.`) && void api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases/{releaseId}", { params: { path: { ...path, releaseId: r.id } } }).then(reload)}>✕</Button>}
                </div>
              </div>
              <Progress done={r.counts.done} total={r.counts.total} label={`${r.name} progress`} />
              {shipping === r.id && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
                  <span>{r.counts.total - r.counts.done} unfinished task{r.counts.total - r.counts.done === 1 ? "" : "s"}.</span>
                  <Select aria-label="Move unfinished tasks to" defaultValue="" onChange={(e) => void ship(r, e.target.value)}>
                    <option value="" disabled>Ship and…</option>
                    <option value="">leave them on this release</option>
                    {unreleased.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>move them to {x.name}</option>)}
                  </Select>
                  <Button size="sm" onClick={() => void ship(r, "")}>Ship now</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShipping(null)}>Cancel</Button>
                </div>
              )}
              {notesFor === r.id && <Notes workspaceId={ws} projectId={project.id} release={r} />}
            </Card>
          </li>
        ))}
      </ul>
      {releases.data?.length === 0 && <p className="text-sm text-muted-foreground">No releases yet.</p>}
    </section>
  );
}

function Milestones() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const [version, setVersion] = useState(0);
  const milestones = useMilestones(workspace.id, project.id, version);
  const [error, setError] = useState<string | null>(null);
  const path = { workspaceId: workspace.id, projectId: project.id };
  const reload = () => setVersion((v) => v + 1);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = String(f.get("date"));
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones", { params: { path }, body: { name: String(f.get("name")), ...(date ? { dueDate: `${date}T00:00:00.000Z` } : {}) } });
    setError(error ? errorMessage(error) : null);
    if (!error) form.reset();
    reload();
  }

  return (
    <section className="grid gap-3" aria-label="Milestones">
      <h2 className="text-lg font-medium">Milestones</h2>
      <p className="text-sm text-muted-foreground">Dated goals that tasks can contribute to, independent of sprints and releases.</p>
      {error && <Alert>{error}</Alert>}
      {project.canManage && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Field label="Name" htmlFor="ms-name"><Input id="ms-name" name="name" required maxLength={60} placeholder="Public beta" className="w-48" /></Field>
          <Field label="Due" htmlFor="ms-date"><Input id="ms-date" name="date" type="date" /></Field>
          <Button type="submit">Create milestone</Button>
        </form>
      )}
      <ul className="grid gap-3">
        {milestones.data?.map((m) => (
          <li key={m.id}>
            <Card className="grid gap-2" data-milestone={m.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <strong>{m.name}</strong>
                  {m.closedAt ? <Badge>closed</Badge> : m.dueDate && <span className="text-xs text-muted-foreground">due {formatDate(m.dueDate)}</span>}
                </div>
                {project.canManage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}", { params: { path: { ...path, milestoneId: m.id } }, body: { closed: !m.closedAt } }).then(reload)}>{m.closedAt ? "Reopen" : "Close"}</Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => confirm(`Delete milestone ${m.name}?`) && void api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}", { params: { path: { ...path, milestoneId: m.id } } }).then(reload)}>✕</Button>
                  </div>
                )}
              </div>
              <Progress done={m.counts.done} total={m.counts.total} label={`${m.name} progress`} />
            </Card>
          </li>
        ))}
      </ul>
      {milestones.data?.length === 0 && <p className="text-sm text-muted-foreground">No milestones yet.</p>}
    </section>
  );
}

export default function ReleasesPage() {
  return (
    <div className="grid gap-8">
      <Releases />
      <Milestones />
    </div>
  );
}
