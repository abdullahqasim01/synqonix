"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { PRIORITIES, TASK_TYPES, type TaskPriority, type TaskType } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";

const LAST_PROJECT = "sx_last_project";

/** Global "new task" dialog: press `c` anywhere in a workspace, type a title, hit Enter. */
export function QuickCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const params = useParams<{ projectId?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");

  const projects = useQuery(
    async () => (open ? api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId: workspace.id } } }) : { data: undefined }),
    [workspace.id, open],
  );

  const projectForTemplates = chosenProject ?? params.projectId ?? null;
  const templates = useQuery(
    async () => (open && projectForTemplates
      ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates", { params: { path: { workspaceId: workspace.id, projectId: projectForTemplates } } })
      : { data: [] as Schemas["TemplateDto"][] }),
    [workspace.id, open, projectForTemplates],
  );

  useEffect(() => {
    if (!open) return;
    title.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;

  let remembered: string | null = null;
  try { remembered = localStorage.getItem(LAST_PROJECT); } catch { /* storage unavailable */ }
  const choices = projects.data ?? [];
  const defaultProject = choices.find((p) => p.id === params.projectId) ?? choices.find((p) => p.id === remembered) ?? choices[0];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const projectId = String(f.get("project"));
    setBusy(true);
    const typed = String(f.get("title")).trim();
    const { data, error } = templateId
      ? await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates/{templateId}/create-task", {
        params: { path: { workspaceId: workspace.id, projectId, templateId } }, body: typed ? { title: typed } : {},
      })
      : await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", {
        params: { path: { workspaceId: workspace.id, projectId } },
        body: { title: typed, type: f.get("type") as TaskType, priority: f.get("priority") as TaskPriority },
      });
    setBusy(false);
    if (!data) return setError(errorMessage(error));
    try { localStorage.setItem(LAST_PROJECT, projectId); } catch { /* ignore */ }
    onClose();
    router.push(`/w/${workspace.id}/tasks/${data.key}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form role="dialog" aria-label="Create task" onSubmit={submit} className="grid w-full max-w-lg gap-4 rounded-lg border border-border bg-background p-5 shadow-xl">
        <h2 className="font-medium">New task</h2>
        {error && <Alert>{error}</Alert>}
        <Field label="Title" htmlFor="qc-title"><Input id="qc-title" ref={title} name="title" required={!templateId} maxLength={300} placeholder={templateId ? "Leave empty to use the template title" : "What needs doing?"} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Project" htmlFor="qc-project">
            <Select id="qc-project" name="project" required defaultValue={defaultProject?.id} key={defaultProject?.id} className="w-full" onChange={(e) => { setChosenProject(e.target.value); setTemplateId(""); }}>
              {choices.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.key}</option>)}
            </Select>
          </Field>
          <Field label="Type" htmlFor="qc-type">
            <Select id="qc-type" name="type" defaultValue="TASK" className="w-full">{TASK_TYPES.filter((t) => t.value !== "SUBTASK").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </Field>
          <Field label="Priority" htmlFor="qc-priority">
            <Select id="qc-priority" name="priority" defaultValue="NONE" className="w-full">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </Field>
        </div>
        {(templates.data?.length ?? 0) > 0 && (
          <Field label="Template" htmlFor="qc-template">
            <Select id="qc-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full">
              <option value="">No template</option>
              {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || choices.length === 0}>{busy ? "Creating…" : "Create task"}</Button>
        </div>
      </form>
    </div>
  );
}
