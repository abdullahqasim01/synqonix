"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

type Project = Schemas["ProjectDetailDto"];

function useIds() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  return { workspaceId, projectId, path: { workspaceId, projectId } };
}

function Statuses({ project, reload }: { project: Project; reload: () => void }) {
  const { path } = useIds();
  const [error, setError] = useState<string | null>(null);

  async function run(p: Promise<{ error?: unknown }>) {
    const { error } = await p;
    setError(error ? errorMessage(error) : null);
    reload();
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = project.statuses.map((s) => s.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(api.PUT("/api/v1/workspaces/{workspaceId}/projects/{projectId}/statuses/order", { params: { path }, body: { ids } }));
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/statuses", {
      params: { path },
      body: { name: String(f.get("name")), category: f.get("category") as Schemas["CreateStatusDto"]["category"] },
    }));
    form.reset();
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">Workflow</h2>
      <p className="mb-4 text-sm text-muted-foreground">Statuses become the columns of your board.</p>
      {error && <Alert>{error}</Alert>}
      <ol className="divide-y divide-border">
        {project.statuses.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
              {s.name}
              <Badge>{s.category.replace("_", " ").toLowerCase()}</Badge>
            </span>
            {project.canManage && (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${s.name} down`} disabled={i === project.statuses.length - 1} onClick={() => void move(i, 1)}>↓</Button>
                <Button
                  size="sm" variant="ghost" aria-label={`Delete ${s.name}`}
                  onClick={() => void run(api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/statuses/{statusId}", { params: { path: { ...path, statusId: s.id } } }))}
                >✕</Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {project.canManage && (
        <form onSubmit={add} className="mt-4 flex gap-2">
          <Input name="name" placeholder="New status" required maxLength={40} aria-label="Status name" />
          <Select name="category" aria-label="Category" defaultValue="IN_PROGRESS">
            <option value="TODO">To do</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="DONE">Done</option>
          </Select>
          <Button type="submit">Add</Button>
        </form>
      )}
    </Card>
  );
}

function Labels({ project, reload }: { project: Project; reload: () => void }) {
  const { path } = useIds();
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/labels", {
      params: { path }, body: { name: String(new FormData(form).get("name")) },
    });
    setError(error ? errorMessage(error) : null);
    form.reset();
    reload();
  }

  return (
    <Card>
      <h2 className="mb-4 font-medium">Labels</h2>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {project.labels.map((l) => (
          <Badge key={l.id} className="gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
            {l.name}
            {project.canManage && (
              <button
                aria-label={`Delete label ${l.name}`} className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/labels/{labelId}", { params: { path: { ...path, labelId: l.id } } }).then(reload)}
              >×</button>
            )}
          </Badge>
        ))}
        {project.labels.length === 0 && <span className="text-sm text-muted-foreground">No labels yet.</span>}
      </div>
      {project.canManage && (
        <form onSubmit={add} className="mt-4 flex max-w-sm gap-2">
          <Input name="name" placeholder="New label" required maxLength={40} aria-label="Label name" />
          <Button type="submit">Add</Button>
        </form>
      )}
    </Card>
  );
}

function Members({ project }: { project: Project }) {
  const { workspaceId, projectId, path } = useIds();
  const members = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/members", { params: { path } }), [workspaceId, projectId]);
  const wsMembers = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId } } }), [workspaceId]);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await api.PUT("/api/v1/workspaces/{workspaceId}/projects/{projectId}/members", {
      params: { path }, body: { userId: String(f.get("userId")), role: f.get("role") as Schemas["SetProjectMemberDto"]["role"] },
    });
    setError(error ? errorMessage(error) : null);
    members.reload();
  }

  const taken = new Set(members.data?.map((m) => m.userId));
  return (
    <Card>
      <h2 className="mb-1 font-medium">Project members</h2>
      {project.visibility === "PRIVATE" && <p className="mb-3 text-sm text-muted-foreground">Only these people and workspace admins can see this project.</p>}
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border">
        {members.data?.map((m) => (
          <li key={m.userId} className="flex items-center justify-between py-2 text-sm">
            <span>{m.name} <span className="text-muted-foreground">{m.email}</span></span>
            <span className="flex items-center gap-2">
              <Badge>{m.role.toLowerCase()}</Badge>
              {project.canManage && m.userId !== project.leadId && (
                <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`}
                  onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}/members/{userId}", { params: { path: { ...path, userId: m.userId } } }).then(members.reload)}
                >✕</Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {project.canManage && (
        <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
          <Select name="userId" aria-label="Person" required defaultValue="">
            <option value="" disabled>Add a person…</option>
            {wsMembers.data?.filter((m) => !taken.has(m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
          <Select name="role" aria-label="Role" defaultValue="MEMBER">
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
          </Select>
          <Button type="submit">Add</Button>
        </form>
      )}
    </Card>
  );
}

function ProjectSettings({ project, reload }: { project: Project; reload: () => void }) {
  const { workspace, isAdmin } = useWorkspace();
  const { path } = useIds();
  const router = useRouter();
  const wsMembers = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId: workspace.id } } }), [workspace.id]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/projects/{projectId}", {
      params: { path },
      body: {
        name: String(f.get("name")),
        description: String(f.get("description")),
        visibility: f.get("visibility") as Schemas["UpdateProjectDto"]["visibility"],
        leadId: String(f.get("leadId")) || null,
      },
    });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Saved." });
    reload();
  }

  async function setArchived(archived: boolean) {
    await api.POST(archived ? "/api/v1/workspaces/{workspaceId}/projects/{projectId}/archive" : "/api/v1/workspaces/{workspaceId}/projects/{projectId}/restore", { params: { path } });
    reload();
  }

  async function remove() {
    if (!confirm(`Delete ${project.name} and everything in it? This cannot be undone.`)) return;
    await api.DELETE("/api/v1/workspaces/{workspaceId}/projects/{projectId}", { params: { path } });
    router.push(`/w/${workspace.id}`);
  }

  return (
    <Card>
      <h2 className="mb-4 font-medium">Settings</h2>
      {/* remount once members load so the lead <select> picks up its default */}
      <form key={`${project.id}-${project.name}-${wsMembers.data ? "loaded" : "loading"}`} onSubmit={save} className="grid max-w-lg gap-4">
        {msg && <Alert variant={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
        <Field label="Name" htmlFor="p-name"><Input id="p-name" name="name" defaultValue={project.name} required maxLength={80} /></Field>
        <Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" name="description" defaultValue={project.description ?? ""} maxLength={2000} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Visibility" htmlFor="p-vis">
            <Select id="p-vis" name="visibility" defaultValue={project.visibility}>
              <option value="WORKSPACE">Everyone in workspace</option>
              <option value="PRIVATE">Private</option>
            </Select>
          </Field>
          <Field label="Lead" htmlFor="p-lead">
            <Select id="p-lead" name="leadId" defaultValue={project.leadId ?? ""}>
              <option value="">No lead</option>
              {wsMembers.data?.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" className="w-fit">Save changes</Button>
      </form>
      <div className="mt-6 flex gap-3 border-t border-border pt-4">
        <Button variant="outline" onClick={() => void setArchived(!project.archived)}>{project.archived ? "Restore project" : "Archive project"}</Button>
        {isAdmin && <Button variant="outline" onClick={() => void remove()}>Delete project</Button>}
      </div>
    </Card>
  );
}

export default function ProjectPage() {
  const { workspaceId, projectId, path } = useIds();
  const project = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}", { params: { path } }), [workspaceId, projectId]);

  if (project.loading) return <p className="text-sm text-muted-foreground">Loading project…</p>;
  if (!project.data) return <Alert>{project.error ?? "Project not found"}</Alert>;
  const p = project.data;

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/w/${workspaceId}`} className="text-sm text-muted-foreground hover:text-foreground">← Projects</Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <Badge className="font-mono">{p.key}</Badge>
          {p.visibility === "PRIVATE" && <Badge>private</Badge>}
          {p.archived && <Badge>archived</Badge>}
        </div>
        {p.description && <p className="mt-1 text-muted-foreground">{p.description}</p>}
        <p className="mt-2 text-sm text-muted-foreground">Tasks, boards and sprints arrive in the next phases.</p>
      </div>
      <Statuses project={p} reload={project.reload} />
      <Labels project={p} reload={project.reload} />
      <Members project={p} />
      {p.canManage && <ProjectSettings project={p} reload={project.reload} />}
    </div>
  );
}
