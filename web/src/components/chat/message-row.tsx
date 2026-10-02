"use client";

import Link from "next/link";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/tasks/badges";
import { Button } from "@/components/ui/button";
import { Alert, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { linkifyTaskKeys, QUICK_REACTIONS, type Message } from "@/lib/chat";
import { cn } from "@/lib/utils";

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

interface Props {
  workspaceId: string;
  channelId: string;
  message: Message;
  /** Show the author and avatar (first of a run). */
  header: boolean;
  isOwn: boolean;
  canModerate: boolean;
  canPost: boolean;
  /** Inside the thread panel: no "reply" action, no reply count. */
  inThread?: boolean;
  onChange(m: Message): void;
  onReply?(m: Message): void;
  onTask?(m: Message): void;
}

export function MessageRow({ workspaceId, channelId, message: m, header, isOwn, canModerate, canPost, inThread, onChange, onReply, onTask }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = { workspaceId, channelId, messageId: m.id };

  async function react(emoji: string, reacted: boolean) {
    setPicking(false);
    const params = { path: { ...path, emoji } };
    const res = reacted
      ? await api.DELETE("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/reactions/{emoji}", { params })
      : await api.PUT("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/reactions/{emoji}", { params });
    if (res.data) onChange(res.data);
    else setError(errorMessage(res.error));
  }

  async function saveEdit() {
    const { data, error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}", { params: { path }, body: { body: draft } });
    if (!data) return setError(errorMessage(error));
    setError(null);
    setEditing(false);
    onChange(data);
  }

  async function remove() {
    if (!window.confirm("Delete this message?")) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}", { params: { path } });
    if (error) return setError(errorMessage(error));
    onChange({ ...m, deleted: true, body: "", reactions: [], attachments: [], tasks: [], taskKeys: [] });
  }

  async function unlink(key: string) {
    const { data } = await api.DELETE("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/tasks/{taskRef}", { params: { path: { ...path, taskRef: key } } });
    if (data) onChange(data);
  }

  async function download(a: Message["attachments"][number]) {
    const { data, error } = await api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/attachments/{attachmentId}/download", {
      params: { path: { workspaceId, channelId, attachmentId: a.id } }, parseAs: "blob",
    });
    if (!data) return setError(errorMessage(error, "Download failed"));
    const url = URL.createObjectURL(data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const action = "rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
  const name = m.author?.name ?? "Deleted user";

  return (
    <article data-seq={m.seq} aria-label={`Message from ${name}`} className={cn("group relative flex gap-3 px-3 py-0.5 hover:bg-muted/40", header && "mt-3")}>
      <div className="w-8 shrink-0 pt-0.5">
        {header && <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-sm font-medium text-primary">{name.charAt(0).toUpperCase()}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {header && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{name}</span>
            <time className="text-xs text-muted-foreground" dateTime={m.createdAt}>{time(m.createdAt)}</time>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {m.deleted ? (
          <p className="text-sm italic text-muted-foreground">This message was deleted</p>
        ) : editing ? (
          <div className="grid gap-2">
            <Textarea aria-label="Edit message" value={draft} rows={3} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === "Escape") setEditing(false); }} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void saveEdit()} disabled={!draft.trim()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(m.body); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {m.body && <Markdown>{linkifyTaskKeys(m.body, workspaceId, m.tasks.map((t) => t.key))}</Markdown>}
            {m.edited && <span className="text-xs text-muted-foreground">(edited)</span>}
            {m.attachments.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <button className="rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-muted" onClick={() => void download(a)}>
                      📎 {a.filename} <span className="text-muted-foreground">{formatSize(a.size)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {m.tasks.length > 0 && (
              <ul className="mt-1 grid gap-1">
                {m.tasks.map((t) => (
                  <li key={t.id} className="flex max-w-md items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                    <Link href={`/w/${workspaceId}/tasks/${t.key}`} className="font-medium text-primary hover:underline">{t.key}</Link>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <StatusBadge status={t.status} />
                    {canPost && !m.taskKeys.includes(t.key) && (
                      <button aria-label={`Unlink ${t.key}`} className="text-muted-foreground hover:text-foreground" onClick={() => void unlink(t.key)}>×</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(m.reactions.length > 0 || (!inThread && m.replyCount > 0)) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    aria-pressed={r.reacted}
                    aria-label={`${r.emoji} ${r.count}`}
                    disabled={!canPost && !r.reacted}
                    onClick={() => void react(r.emoji, r.reacted)}
                    className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", r.reacted ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
                  >
                    {r.emoji} {r.count}
                  </button>
                ))}
                {!inThread && m.replyCount > 0 && (
                  <button className="ml-1 text-xs text-primary hover:underline" onClick={() => onReply?.(m)}>
                    {m.replyCount} {m.replyCount === 1 ? "reply" : "replies"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!m.deleted && !editing && (
        <div role="toolbar" aria-label="Message actions" className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 shadow-sm focus-within:flex group-hover:flex">
          {canPost && (
            <span className="relative">
              <button aria-label="Add reaction" className={action} onClick={() => setPicking((p) => !p)}>😊</button>
              {picking && (
                <span role="menu" aria-label="Reactions" className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-md border border-border bg-background p-1 shadow-lg">
                  {QUICK_REACTIONS.map((e) => (
                    <button key={e} role="menuitem" aria-label={`React ${e}`} className="rounded px-1 hover:bg-muted"
                      onClick={() => void react(e, m.reactions.find((r) => r.emoji === e)?.reacted ?? false)}>{e}</button>
                  ))}
                </span>
              )}
            </span>
          )}
          {!inThread && canPost && <button aria-label="Reply in thread" className={action} onClick={() => onReply?.(m)}>↩ Reply</button>}
          {canPost && onTask && <button aria-label="Task actions" className={action} onClick={() => onTask(m)}>☑ Task</button>}
          {isOwn && canPost && <button aria-label="Edit message" className={action} onClick={() => { setDraft(m.body); setEditing(true); }}>Edit</button>}
          {(isOwn || canModerate) && <button aria-label="Delete message" className={action} onClick={() => void remove()}>Delete</button>}
        </div>
      )}
    </article>
  );
}
