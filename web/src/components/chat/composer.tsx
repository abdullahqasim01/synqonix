"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useChat } from "@/components/chat/chat-provider";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Alert, Textarea } from "@/components/ui/form";
import { putToPresigned, UploadError } from "@/lib/files";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { mentionLink, mentionQuery, type Message } from "@/lib/chat";

type Attachment = Schemas["MessageAttachmentDto"];

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Message box: Enter sends, Shift+Enter adds a line, `@` suggests people, files upload before sending. */
export function Composer({
  channelId, parentId, placeholder, onSent,
}: { channelId: string; parentId?: string; placeholder: string; onSent(message: Message): void }) {
  const { workspace, members } = useWorkspace();
  const { emitTyping } = useChat();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const mention = mentionQuery(text, caret);
  const suggestions = mention ? members.filter((m) => m.name.toLowerCase().includes(mention.query)).slice(0, 5) : [];

  function choose(m: { userId: string; name: string }) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const insert = `${mentionLink(m.name, m.userId)} `;
    setText(before + insert + after);
    setPick(0);
    pendingCaret.current = before.length + insert.length;
    setCaret(pendingCaret.current);
  }

  // Put the caret after an inserted mention in the same commit as the new text, so typing that
  // follows immediately cannot land in the wrong place.
  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    if (pos === null) return;
    pendingCaret.current = null;
    area.current?.focus();
    area.current?.setSelectionRange(pos, pos);
  }, [text]);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = { workspaceId: workspace.id, channelId };
      const asked = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/attachments/upload-url", {
        params: { path }, body: { filename: file.name, size: file.size, mimeType: file.type || undefined },
      });
      if (!asked.data) throw new UploadError(errorMessage(asked.error, "Upload failed"));
      await putToPresigned(asked.data, file);
      const done = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/attachments", { params: { path }, body: { uploadToken: asked.data.uploadToken } });
      if (!done.data) throw new UploadError(errorMessage(done.error, "Upload failed"));
      setFiles((f) => [...f, done.data]);
      setError(null);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function send() {
    if (!text.trim() && files.length === 0) return;
    const draft = { text, files };
    // Clear right away so the next message can be typed while this one is on its way.
    setText("");
    setFiles([]);
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages", {
      params: { path: { workspaceId: workspace.id, channelId } },
      body: { body: draft.text, ...(parentId ? { parentId } : {}), ...(draft.files.length ? { attachmentIds: draft.files.map((f) => f.id) } : {}) },
    });
    if (!data) {
      // Give the text back unless they already started something new.
      setText((cur) => cur || draft.text);
      setFiles((cur) => (cur.length ? cur : draft.files));
      return setError(errorMessage(error));
    }
    setError(null);
    onSent(data);
  }

  return (
    <div className="relative grid gap-2">
      {error && <Alert>{error}</Alert>}
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mention suggestions" className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-md border border-border bg-background p-1 shadow-lg">
          {suggestions.map((m, i) => (
            <li key={m.userId} role="option" aria-selected={i === pick}>
              <button
                type="button"
                className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${i === pick ? "bg-muted" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
              {f.filename} <span className="text-muted-foreground">{formatSize(f.size)}</span>
              <button aria-label={`Remove ${f.filename}`} onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={area}
          aria-label={placeholder}
          value={text}
          rows={2}
          placeholder={placeholder}
          className="min-h-0 flex-1 resize-none"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setPick(0);
            if (e.target.value) emitTyping(channelId);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(suggestions[pick] ?? suggestions[0]);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <input ref={input} type="file" className="hidden" aria-label="Attach a file" onChange={(e) => void upload(e.target.files)} />
        <Button type="button" variant="outline" disabled={uploading} onClick={() => input.current?.click()} title="Attach a file">{uploading ? "…" : "📎"}</Button>
        <Button type="button" disabled={uploading || (!text.trim() && files.length === 0)} onClick={() => void send()}>Send</Button>
      </div>
    </div>
  );
}
