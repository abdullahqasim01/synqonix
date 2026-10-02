"use client";

import { useState } from "react";
import { useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage } from "@/lib/api/client";
import type { Channel, Message } from "@/lib/chat";
import { useQuery } from "@/lib/use-query";

/** Rename, archive, members, leave. What shows depends on what the caller may do. */
export function ChannelSettingsDialog({ channel, onClose, onLeft }: { channel: Channel; onClose: () => void; onLeft: () => void }) {
  const { workspace, members: people } = useWorkspace();
  const { reload } = useChat();
  const ws = workspace.id;
  const path = { workspaceId: ws, channelId: channel.id };
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const members = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/members", { params: { path } }),
    [ws, channel.id],
  );
  const canEdit = channel.isAdmin && channel.type !== "DIRECT";
  const taken = new Set((members.data ?? []).map((m) => m.userId));

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/channels/{channelId}", {
      params: { path },
      body: { ...(channel.projectId ? {} : { name: String(f.get("name")) }), topic: String(f.get("topic")).trim() || null },
    });
    if (error) return setError(errorMessage(error));
    reload();
    onClose();
  }

  async function run(p: Promise<{ error?: unknown }>, done?: () => void) {
    const { error } = await p;
    if (error) return setError(errorMessage(error));
    setError(null);
    reload();
    members.reload();
    done?.();
  }

  return (
    <Modal title="Channel details" onClose={onClose} wide>
      {error && <Alert>{error}</Alert>}
      {canEdit ? (
        <form onSubmit={save} className="grid gap-3">
          {!channel.projectId && <Field label="Name" htmlFor="cs-name"><Input id="cs-name" name="name" defaultValue={channel.name ?? ""} required maxLength={60} /></Field>}
          <Field label="Topic" htmlFor="cs-topic"><Textarea id="cs-topic" name="topic" rows={2} defaultValue={channel.topic ?? ""} maxLength={250} /></Field>
          <div className="flex justify-end"><Button type="submit" size="sm">Save</Button></div>
        </form>
      ) : (
        channel.topic && <p className="text-sm text-muted-foreground">{channel.topic}</p>
      )}

      <section className="grid gap-2">
        <h3 className="text-sm font-medium">Members ({members.data?.length ?? channel.memberCount})</h3>
        <ul className="divide-y divide-border rounded-md border border-border">
          {(members.data ?? []).map((m) => (
            <li key={m.userId} className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span>{m.name} {m.role === "ADMIN" && <span className="text-xs text-muted-foreground">admin</span>}</span>
              {canEdit && (
                <button aria-label={`Remove ${m.name}`} className="text-muted-foreground hover:text-foreground"
                  onClick={() => void run(api.DELETE("/api/v1/workspaces/{workspaceId}/channels/{channelId}/members/{userId}", { params: { path: { ...path, userId: m.userId } } }))}>×</button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex gap-2">
            <Select aria-label="Add a member" value={adding} onChange={(e) => setAdding(e.target.value)} className="flex-1">
              <option value="">Add someone…</option>
              {people.filter((p) => !taken.has(p.userId)).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={!adding}
              onClick={() => void run(api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/members", { params: { path }, body: { userId: adding } }), () => setAdding(""))}>Add</Button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" variant="outline"
              onClick={() => void run(api.PATCH("/api/v1/workspaces/{workspaceId}/channels/{channelId}", { params: { path }, body: { archived: !channel.archived } }), onClose)}>
              {channel.archived ? "Unarchive" : "Archive channel"}
            </Button>
          )}
          {channel.isMember && channel.type !== "DIRECT" && (
            <Button size="sm" variant="outline"
              onClick={() => void run(api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/leave", { params: { path } }), onLeft)}>Leave channel</Button>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/** Link a message to an existing task, or turn it into a new one. */
export function MessageTaskDialog({ channelId, message, onClose, onDone }: {
  channelId: string; message: Message; onClose: () => void; onDone: (m: Message) => void;
}) {
  const { workspace } = useWorkspace();
  const ws = workspace.id;
  const [mode, setMode] = useState<"link" | "create">("create");
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId: ws } } }), [ws]);
  const path = { workspaceId: ws, channelId, messageId: message.id };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (mode === "link") {
      const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/tasks", {
        params: { path }, body: { taskRef: String(f.get("taskRef")).trim() },
      });
      if (!data) return setError(errorMessage(error));
      onDone(data);
    } else {
      const title = String(f.get("title")).trim();
      const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/create-task", {
        params: { path }, body: { projectId: String(f.get("projectId")), ...(title ? { title } : {}) },
      });
      if (!data) return setError(errorMessage(error));
      onDone(data);
    }
    onClose();
  }

  const tab = (m: typeof mode, label: string) => (
    <button type="button" onClick={() => setMode(m)} className={`px-3 py-1 text-sm ${mode === m ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>{label}</button>
  );

  return (
    <Modal title="Task from message" onClose={onClose}>
      <div className="flex border-b border-border">{tab("create", "New task")}{tab("link", "Existing task")}</div>
      <form onSubmit={submit} className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        {mode === "link" ? (
          <Field label="Task key" htmlFor="mt-ref" hint="For example SYN-12"><Input id="mt-ref" name="taskRef" required autoFocus /></Field>
        ) : (
          <>
            <Field label="Project" htmlFor="mt-project">
              <Select id="mt-project" name="projectId" required>
                {(projects.data ?? []).filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.key} — {p.name}</option>)}
              </Select>
            </Field>
            <Field label="Title" htmlFor="mt-title" hint="Defaults to the first line of the message"><Input id="mt-title" name="title" maxLength={300} /></Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">{mode === "link" ? "Link task" : "Create task"}</Button>
        </div>
      </form>
    </Modal>
  );
}
