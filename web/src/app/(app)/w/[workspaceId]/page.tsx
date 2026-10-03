"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { canCreateProjects } from "@/lib/permissions";
import { useQuery } from "@/lib/use-query";

type Template = Schemas["CreateProjectDto"]["template"];

const TEMPLATES: { value: NonNullable<Template>; label: string; hint: string }[] = [
  { value: "SCRUM", label: "Scrum", hint: "Sprints, backlog and story points" },
  { value: "KANBAN", label: "Kanban", hint: "Continuous flow with WIP limits" },
  { value: "BUG_TRACKING", label: "Bug tracking", hint: "Triage and resolve defects" },
  { value: "BLANK", label: "Blank", hint: "To Do, In Progress, Done" },
];

export default function ProjectsPage() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projects = useQuery(
    () =>
      api.GET("/api/v1/workspaces/{workspaceId}/projects", {
        params: { path: { workspaceId: workspace.id }, query: { includeArchived: showArchived } },
      }),
    [workspace.id, showArchived],
  );

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects", {
      params: { path: { workspaceId: workspace.id } },
      body: {
        name: String(f.get("name")),
        key: String(f.get("key")).toUpperCase(),
        description: String(f.get("description") ?? "") || undefined,
        template: f.get("template") as Template,
        visibility: f.get("visibility") as Schemas["CreateProjectDto"]["visibility"],
      },
    });
    if (!data) return setError(errorMessage(error));
    router.push(`/w/${workspace.id}/projects/${data.id}`);
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {canCreateProjects(workspace.role) && (
            <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New project"}</Button>
          )}
        </div>
      </div>

      {creating && (
        <Card>
          <form onSubmit={onCreate} className="grid max-w-lg gap-4">
            {error && <Alert>{error}</Alert>}
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <Field label="Name" htmlFor="name">
                <Input id="name" name="name" required maxLength={80} placeholder="Synqonix" />
              </Field>
              <Field label="Key" htmlFor="key" hint="e.g. SYN-123">
                <Input id="key" name="key" required pattern="[A-Za-z][A-Za-z0-9]{1,9}" maxLength={10} placeholder="SYN" className="uppercase" />
              </Field>
            </div>
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" maxLength={2000} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Template" htmlFor="template">
                <Select id="template" name="template" defaultValue="SCRUM">
                  {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.hint}</option>)}
                </Select>
              </Field>
              <Field label="Visibility" htmlFor="visibility">
                <Select id="visibility" name="visibility" defaultValue="WORKSPACE">
                  <option value="WORKSPACE">Everyone in workspace</option>
                  <option value="PRIVATE">Private (members only)</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" className="w-fit">Create project</Button>
          </form>
        </Card>
      )}

      {projects.error && <Alert>{projects.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.data?.map((p) => (
          <Link key={p.id} href={`/w/${workspace.id}/projects/${p.id}`}>
            <Card className="flex h-full gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <Avatar name={p.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="flex gap-1">
                    {p.visibility === "PRIVATE" && <Badge>private</Badge>}
                    {p.archived && <Badge>archived</Badge>}
                    <Badge className="font-mono">{p.key}</Badge>
                  </span>
                </div>
                {p.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p> : <p className="mt-1 text-sm text-muted-foreground/70">No description</p>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {projects.data?.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.</p>}
    </div>
  );
}
