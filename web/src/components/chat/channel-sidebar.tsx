"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useChat } from "@/components/chat/chat-provider";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { channelTitle, directPeer, type Channel } from "@/lib/chat";
import { cn } from "@/lib/utils";

function PresenceDot({ online }: { online: boolean }) {
  return <span aria-label={online ? "Online" : "Offline"} className={cn("inline-block h-2 w-2 shrink-0 rounded-full", online ? "bg-green-500" : "bg-muted-foreground/30")} />;
}

function Row({ channel, active, base }: { channel: Channel; active: boolean; base: string }) {
  const { user } = useAuth();
  const { online } = useChat();
  const peer = directPeer(channel, user?.id);
  const unread = channel.unreadCount > 0;
  return (
    <li>
      <Link
        href={`${base}?c=${channel.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted",
          active && "bg-muted font-medium",
          !channel.isMember && "text-muted-foreground",
          unread && "font-semibold",
        )}
      >
        {channel.type === "DIRECT" ? (peer ? <PresenceDot online={online.has(peer)} /> : <span className="w-2 text-xs">+</span>) : (
          <span className="w-2 text-muted-foreground">{channel.type === "PRIVATE" ? "🔒" : "#"}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{channelTitle(channel, user?.id)}</span>
        {channel.mentionCount > 0 && (
          <span aria-label={`${channel.mentionCount} mentions`} className="rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">@{channel.mentionCount}</span>
        )}
        {unread && channel.mentionCount === 0 && (
          <span aria-label={`${channel.unreadCount} unread`} className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">{channel.unreadCount}</span>
        )}
      </Link>
    </li>
  );
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <div className="flex items-center justify-between px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {action}
      </div>
      <ul className="grid gap-0.5 empty:hidden">{children}</ul>
    </section>
  );
}

export function ChannelSidebar({ activeId, base }: { activeId: string | null; base: string }) {
  const { channels, loading } = useChat();
  const [dialog, setDialog] = useState<"channel" | "dm" | null>(null);
  const projectChannels = channels.filter((c) => c.projectId);
  const others = channels.filter((c) => !c.projectId && c.type !== "DIRECT");
  const dms = channels.filter((c) => c.type === "DIRECT");
  const add = (label: string, kind: "channel" | "dm") => (
    <button aria-label={label} title={label} className="rounded px-1 text-base leading-none hover:bg-muted" onClick={() => setDialog(kind)}>+</button>
  );
  return (
    <nav aria-label="Channels" className="grid content-start gap-4">
      {loading && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
      <Group title="Channels" action={add("New channel", "channel")}>
        {others.map((c) => <Row key={c.id} channel={c} active={c.id === activeId} base={base} />)}
      </Group>
      <Group title="Projects">
        {projectChannels.map((c) => <Row key={c.id} channel={c} active={c.id === activeId} base={base} />)}
      </Group>
      <Group title="Direct messages" action={add("New message", "dm")}>
        {dms.map((c) => <Row key={c.id} channel={c} active={c.id === activeId} base={base} />)}
      </Group>
      {dialog === "channel" && <NewChannelDialog base={base} onClose={() => setDialog(null)} />}
      {dialog === "dm" && <NewDirectDialog base={base} onClose={() => setDialog(null)} />}
    </nav>
  );
}

function PeoplePicker({ selected, onChange }: { selected: string[]; onChange(ids: string[]): void }) {
  const { members } = useWorkspace();
  const { user } = useAuth();
  return (
    <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-2">
      {members.filter((m) => m.userId !== user?.id).map((m) => (
        <li key={m.userId}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(m.userId)}
              onChange={(e) => onChange(e.target.checked ? [...selected, m.userId] : selected.filter((id) => id !== m.userId))}
            />
            {m.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

function useGo(base: string) {
  const { reload } = useChat();
  const router = useRouter();
  return (id: string) => {
    reload();
    router.push(`${base}?c=${id}`);
  };
}

export function NewChannelDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const go = useGo(base);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const topic = String(f.get("topic") ?? "").trim();
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels", {
      params: { path: { workspaceId: workspace.id } },
      body: { name: String(f.get("name")), type, ...(topic ? { topic } : {}), ...(type === "PRIVATE" ? { memberIds } : {}) },
    });
    if (!data) return setError(errorMessage(error));
    go(data.id);
    onClose();
  }

  return (
    <Modal title="New channel" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="ch-name"><Input id="ch-name" name="name" required maxLength={60} autoFocus /></Field>
        <Field label="Topic" htmlFor="ch-topic"><Textarea id="ch-topic" name="topic" rows={2} maxLength={250} /></Field>
        <Field label="Visibility" htmlFor="ch-type">
          <Select id="ch-type" value={type} onChange={(e) => setType(e.target.value as "PUBLIC" | "PRIVATE")}>
            <option value="PUBLIC">Public — anyone in the workspace can find and join</option>
            <option value="PRIVATE">Private — only people you add</option>
          </Select>
        </Field>
        {type === "PRIVATE" && <PeoplePicker selected={memberIds} onChange={setMemberIds} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Create channel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function NewDirectDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const go = useGo(base);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels/direct", {
      params: { path: { workspaceId: workspace.id } }, body: { userIds: ids },
    });
    if (!data) return setError(errorMessage(error));
    go(data.id);
    onClose();
  }

  return (
    <Modal title="New message" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-muted-foreground">Choose up to seven people. The same group always shares one conversation.</p>
        <PeoplePicker selected={ids} onChange={setIds} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={ids.length === 0}>Start conversation</Button>
        </div>
      </form>
    </Modal>
  );
}
