"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Avatar } from "@/components/tasks/badges";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { describeActivity } from "@/lib/tasks";
import { useQuery } from "@/lib/use-query";
import type { TaskDetail } from "./task-sections";

const when = (iso: string) => new Date(iso).toLocaleString();

/** Comments and field history, interleaved chronologically, plus the comment composer. */
export function Timeline({ task, ws, canManage, version }: { task: TaskDetail; ws: string; canManage: boolean; version: number }) {
  const { members, memberName } = useWorkspace();
  const { user } = useAuth();
  const path = { workspaceId: ws, taskId: task.id };
  const comments = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments", { params: { path } }), [task.id, version]);
  const activity = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/activity", { params: { path, query: { limit: 100 } } }), [task.id, version]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const reloadAll = () => { comments.reload(); activity.reload(); setLocalVersion((v) => v + 1); };
  void localVersion;

  const items = useMemo(() => {
    const c = (comments.data ?? []).map((x) => ({ kind: "comment" as const, at: x.createdAt, id: x.id, c: x }));
    const a = (activity.data ?? []).map((x) => ({ kind: "activity" as const, at: x.createdAt, id: x.id, a: x }));
    return [...c, ...a].sort((x, y) => x.at.localeCompare(y.at));
  }, [comments.data, activity.data]);

  async function post() {
    const body = draft.trim();
    if (!body) return;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments", { params: { path }, body: { body } });
    if (error) return setError(errorMessage(error));
    setError(null);
    setDraft("");
    reloadAll();
  }

  async function saveEdit() {
    if (!editing) return;
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments/{commentId}", {
      params: { path: { ...path, commentId: editing.id } }, body: { body: editing.body },
    });
    if (error) return setError(errorMessage(error));
    setEditing(null);
    reloadAll();
  }

  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-medium">Activity</h3>
      {error && <Alert>{error}</Alert>}
      <ol className="grid gap-3">
        {items.map((it) =>
          it.kind === "activity" ? (
            <li key={it.id} className="flex gap-2 text-xs text-muted-foreground">
              <Avatar name={it.a.actorId ? memberName(it.a.actorId) : "GitHub"} />
              <span className="pt-1"><strong className="font-medium text-foreground">{it.a.actorId ? memberName(it.a.actorId) : "GitHub"}</strong> {describeActivity(it.a, memberName)} · {when(it.at)}</span>
            </li>
          ) : (
            <li key={it.id} className="flex gap-2">
              <Avatar name={memberName(it.c.authorId)} />
              <div className="min-w-0 flex-1 rounded-md border border-border p-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span><strong className="font-medium text-foreground">{memberName(it.c.authorId)}</strong> · {when(it.at)}{it.c.edited && " · edited"}</span>
                  {task.canEdit && (it.c.authorId === user?.id || canManage) && editing?.id !== it.id && (
                    <span className="flex gap-2">
                      {it.c.authorId === user?.id && <button className="hover:text-foreground" onClick={() => setEditing({ id: it.id, body: it.c.body })}>Edit</button>}
                      <button className="hover:text-foreground" onClick={() => confirm("Delete this comment?") && void api.DELETE("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments/{commentId}", { params: { path: { ...path, commentId: it.id } } }).then(reloadAll)}>Delete</button>
                    </span>
                  )}
                </div>
                {editing?.id === it.id ? (
                  <div className="grid gap-2">
                    <MarkdownEditor value={editing.body} onChange={(body) => setEditing({ id: it.id, body })} people={members} rows={4} onSubmit={() => void saveEdit()} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveEdit()}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Markdown>{it.c.body}</Markdown>
                )}
              </div>
            </li>
          ),
        )}
      </ol>
      {task.canEdit ? (
        <div className="grid gap-2">
          <MarkdownEditor id="new-comment" value={draft} onChange={setDraft} people={members} rows={3} placeholder="Leave a comment… (Ctrl+Enter to send)" onSubmit={() => void post()} />
          <Button className="w-fit" size="sm" onClick={() => void post()} disabled={!draft.trim()}>Comment</Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You have read-only access to this task.</p>
      )}
    </section>
  );
}
