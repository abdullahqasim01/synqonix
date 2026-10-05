"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Select } from "@/components/ui/form";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Markdown } from "@/components/markdown";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { StatusBadge, TypeIcon } from "@/components/tasks/badges";
import { putToPresigned, startDownload, UploadError } from "@/lib/files";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

export type TaskDetail = Schemas["TaskDetailDto"];
interface SectionProps { task: TaskDetail; reload(): void; ws: string }

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- description

export function Description({ task, ws, reload }: SectionProps) {
  const { members } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", {
      params: { path: { workspaceId: ws, taskId: task.id } }, body: { description: draft.trim() || null },
    });
    if (error) return setError(errorMessage(error));
    setEditing(false);
    reload();
  }

  return (
    <Section
      title="Description"
      action={task.canEdit && !editing && (
        <Button size="sm" variant="ghost" onClick={() => { setDraft(task.description ?? ""); setError(null); setEditing(true); }}>Edit</Button>
      )}
    >
      {editing ? (
        <div className="grid gap-2">
          {error && <Alert>{error}</Alert>}
          <MarkdownEditor value={draft} onChange={setDraft} people={members} rows={8} onSubmit={() => void save()} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : task.description ? (
        <Markdown>{task.description}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- acceptance criteria

export function AcceptanceCriteria({ task, ws, reload, definitionOfDone }: SectionProps & { definitionOfDone?: string | null }) {
  const { members } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", {
      params: { path: { workspaceId: ws, taskId: task.id } }, body: { acceptanceCriteria: draft.trim() || null },
    });
    if (error) return setError(errorMessage(error));
    setEditing(false);
    reload();
  }

  if (!task.acceptanceCriteria && !task.canEdit && !definitionOfDone) return null;
  return (
    <Section
      title="Acceptance criteria"
      action={task.canEdit && !editing && (
        <Button size="sm" variant="ghost" onClick={() => { setDraft(task.acceptanceCriteria ?? ""); setError(null); setEditing(true); }}>{task.acceptanceCriteria ? "Edit" : "Add"}</Button>
      )}
    >
      {editing ? (
        <div className="grid gap-2">
          {error && <Alert>{error}</Alert>}
          <MarkdownEditor value={draft} onChange={setDraft} people={members} rows={5} placeholder="- [ ] Given… when… then…" onSubmit={() => void save()} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : task.acceptanceCriteria ? (
        <Markdown>{task.acceptanceCriteria}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">None yet.</p>
      )}
      {definitionOfDone && (
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Definition of done</summary>
          <div className="mt-2"><Markdown>{definitionOfDone}</Markdown></div>
        </details>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- subtasks

export function Subtasks({ task, ws, reload }: SectionProps) {
  const [error, setError] = useState<string | null>(null);
  if (task.type === "SUBTASK") return null;

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    // Epics contain stories/tasks; everything else contains sub-tasks.
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", {
      params: { path: { workspaceId: ws, projectId: task.projectId } },
      body: { title, type: task.type === "EPIC" ? "TASK" : "SUBTASK", parentId: task.id },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    form.reset();
    reload();
  }

  const done = task.subtaskDoneCount;
  return (
    <Section title={task.type === "EPIC" ? `Issues in this epic (${done}/${task.subtaskCount})` : `Sub-tasks (${done}/${task.subtaskCount})`}>
      {task.subtaskCount > 0 && (
        <div className="h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={done} aria-valuemax={task.subtaskCount}>
          <div className="h-full bg-green-500" style={{ width: `${(done / task.subtaskCount) * 100}%` }} />
        </div>
      )}
      <ul className="divide-y divide-border rounded-md border border-border">
        {task.subtasks.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <Link href={`/w/${ws}/tasks/${s.key}`} className="flex min-w-0 items-center gap-2 hover:underline">
              <TypeIcon type={s.type} />
              <span className="font-mono text-xs text-muted-foreground">{s.key}</span>
              <span className={cn("truncate", s.status.category === "DONE" && "text-muted-foreground line-through")}>{s.title}</span>
            </Link>
            <StatusBadge status={s.status} />
          </li>
        ))}
      </ul>
      {task.canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <Input name="title" placeholder={task.type === "EPIC" ? "Add an issue to this epic" : "Add a sub-task"} aria-label="New sub-task title" maxLength={300} />
          <Button type="submit" size="sm" variant="outline">Add</Button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </Section>
  );
}

// ---------------------------------------------------------------- checklists

export function Checklists({ task, ws, reload }: SectionProps) {
  const [error, setError] = useState<string | null>(null);
  const base = { workspaceId: ws, taskId: task.id };

  async function run(p: Promise<{ error?: unknown }>) {
    const { error } = await p;
    setError(error ? errorMessage(error) : null);
    reload();
  }

  async function addChecklist(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    await run(api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/checklists", { params: { path: base }, body: { title } }));
    form.reset();
  }

  return (
    <Section title="Checklists">
      {error && <Alert>{error}</Alert>}
      {task.checklists.map((c) => {
        const done = c.items.filter((i) => i.done).length;
        return (
          <div key={c.id} className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{c.title} <span className="text-xs text-muted-foreground">{done}/{c.items.length}</span></span>
              {task.canEdit && (
                <Button size="sm" variant="ghost" aria-label={`Delete checklist ${c.title}`} onClick={() => void run(api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/checklists/{checklistId}", { params: { path: { ...base, checklistId: c.id } } }))}>✕</Button>
              )}
            </div>
            <ul className="grid gap-1">
              {c.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox" checked={i.done} disabled={!task.canEdit}
                      onChange={(e) => void run(api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/checklists/{checklistId}/items/{itemId}", { params: { path: { ...base, checklistId: c.id, itemId: i.id } }, body: { done: e.target.checked } }))}
                    />
                    <span className={cn(i.done && "text-muted-foreground line-through")}>{i.text}</span>
                  </label>
                  {task.canEdit && (
                    <button aria-label={`Delete item ${i.text}`} className="text-muted-foreground hover:text-foreground" onClick={() => void run(api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/checklists/{checklistId}/items/{itemId}", { params: { path: { ...base, checklistId: c.id, itemId: i.id } } }))}>×</button>
                  )}
                </li>
              ))}
            </ul>
            {task.canEdit && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const text = String(new FormData(form).get("text")).trim();
                  if (!text) return;
                  await run(api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/checklists/{checklistId}/items", { params: { path: { ...base, checklistId: c.id } }, body: { text } }));
                  form.reset();
                }}
              >
                <Input name="text" placeholder="Add an item" aria-label={`New item for ${c.title}`} maxLength={300} className="h-8" />
              </form>
            )}
          </div>
        );
      })}
      {task.canEdit && (
        <form onSubmit={addChecklist} className="flex gap-2">
          <Input name="title" placeholder="New checklist title" aria-label="New checklist title" maxLength={100} />
          <Button type="submit" size="sm" variant="outline">Add checklist</Button>
        </form>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- relations

const KIND_LABEL: Record<string, string> = {
  blocks: "Blocks", blocked_by: "Blocked by", relates_to: "Relates to", duplicates: "Duplicates", duplicated_by: "Duplicated by",
};

export function Relations({ task, ws, reload }: SectionProps) {
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/relations", {
      params: { path: { workspaceId: ws, taskId: task.id } },
      body: { type: f.get("type") as "BLOCKS", targetTask: String(f.get("target")).trim() },
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    form.reset();
    reload();
  }

  return (
    <Section title="Linked tasks">
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {task.relations.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Badge>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
              <Link href={`/w/${ws}/tasks/${r.task.key}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <span className="font-mono text-xs text-muted-foreground">{r.task.key}</span>
                <span className="truncate">{r.task.title}</span>
              </Link>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={r.task.status} />
              {task.canEdit && (
                <button aria-label={`Remove link to ${r.task.key}`} className="text-muted-foreground hover:text-foreground"
                  onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/relations/{relationId}", { params: { path: { workspaceId: ws, taskId: task.id, relationId: r.id } } }).then(reload)}>×</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {task.canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <Select name="type" aria-label="Relation type" defaultValue="RELATES">
            <option value="BLOCKS">Blocks</option>
            <option value="RELATES">Relates to</option>
            <option value="DUPLICATES">Duplicates</option>
          </Select>
          <Input name="target" placeholder="Task key, e.g. SYN-12" aria-label="Linked task key" required />
          <Button type="submit" size="sm" variant="outline">Link</Button>
        </form>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- attachments

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Attachments({ task, ws, reload }: SectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = { workspaceId: ws, taskId: task.id };
      const asked = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/attachments/upload-url", {
        params: { path }, body: { filename: file.name, size: file.size, mimeType: file.type || undefined },
      });
      if (!asked.data) throw new UploadError(errorMessage(asked.error, "Upload failed"));
      await putToPresigned(asked.data, file);
      const done = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/attachments", { params: { path }, body: { uploadToken: asked.data.uploadToken } });
      if (!done.data) throw new UploadError(errorMessage(done.error, "Upload failed"));
      setError(null);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      reload();
    }
  }

  async function download(a: Schemas["AttachmentDto"]) {
    const { data, error } = await api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/attachments/{attachmentId}/download-url", {
      params: { path: { workspaceId: ws, taskId: task.id, attachmentId: a.id } },
    });
    if (!data) return setError(errorMessage(error, "Download failed"));
    startDownload(data.url, a.filename);
  }

  return (
    <Section
      title={`Attachments (${task.attachments.length})`}
      action={task.canEdit && (
        <>
          <input ref={input} type="file" className="hidden" aria-label="Attach a file" onChange={(e) => void upload(e.target.files)} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Attach file"}</Button>
        </>
      )}
    >
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
        {task.attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <button className="min-w-0 truncate text-left text-primary hover:underline" onClick={() => void download(a)}>{a.filename}</button>
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              {formatSize(a.size)}
              {task.canEdit && (
                <button aria-label={`Delete ${a.filename}`} className="hover:text-foreground"
                  onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/attachments/{attachmentId}", { params: { path: { workspaceId: ws, taskId: task.id, attachmentId: a.id } } }).then(({ error }) => { setError(error ? errorMessage(error) : null); reload(); })}>×</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}


// ---------------------------------------------------------------- discussions

/** Chat messages that mention, were linked to, or created this task. Only conversations the viewer can read appear. */
export function Discussions({ task, ws }: Pick<SectionProps, "task" | "ws">) {
  const { data } = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/discussions", { params: { path: { workspaceId: ws, taskId: task.id } } }),
    [ws, task.id],
  );
  if (!data || data.length === 0) return null;
  const how = { MENTION: "mentioned", LINKED: "linked", CREATED: "created from" } as const;
  return (
    <Section title={`Discussions (${data.length})`}>
      <ul className="divide-y divide-border rounded-md border border-border">
        {data.map((d) => (
          <li key={d.message.id} className="grid gap-0.5 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link href={`/w/${ws}/chat?c=${d.channel.id}`} className="font-medium text-primary hover:underline">
                {d.channel.type === "DIRECT" ? "Direct message" : `#${d.channel.name}`}
              </Link>
              · {d.message.author?.name ?? "Someone"} {how[d.source]} this task · {new Date(d.message.createdAt).toLocaleDateString()}
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap">{d.message.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
