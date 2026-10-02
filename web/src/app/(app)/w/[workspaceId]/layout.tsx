"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatProvider, useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { TimerPill } from "@/components/time/time-tracking";
import { CommandPalette } from "@/components/command-palette";
import { QuickCreate } from "@/components/tasks/quick-create";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Alert, Select } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const router = useRouter();

  const current = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}", { params: { path: { workspaceId } } }),
    [workspaceId],
  );
  const all = useQuery(() => api.GET("/api/v1/workspaces"), []);
  const members = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId } } }),
    [workspaceId],
  );

  const [creating, setCreating] = useState(false);

  // `c` opens the quick-create dialog from anywhere in the workspace (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      setCreating(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (current.loading) return <p className="text-sm text-muted-foreground">Loading workspace…</p>;
  if (!current.data) return <Alert>{current.error ?? "Workspace not found"}</Alert>;

  const base = `/w/${workspaceId}`;
  const tabs = [
    { href: base, label: "Projects" },
    { href: `${base}/overview`, label: "Overview" },
    { href: `${base}/my-tasks`, label: "My tasks" },
    { href: `${base}/chat`, label: "Chat" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/teams`, label: "Teams" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <WorkspaceProvider workspace={current.data} reload={current.reload} members={members.data ?? []}>
      <ChatProvider workspaceId={workspaceId}>
      <div className="mb-6 flex flex-wrap items-center gap-4 border-b border-border pb-3">
        <Select
          aria-label="Switch workspace"
          value={workspaceId}
          onChange={(e) => router.push(e.target.value === "new" ? "/dashboard" : `/w/${e.target.value}`)}
        >
          {(all.data ?? [current.data]).map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
          <option value="new">+ New workspace…</option>
        </Select>
        <nav className="flex gap-4 text-sm">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "pb-1 text-muted-foreground hover:text-foreground",
                (t.href === base ? pathname === base || pathname.startsWith(`${base}/projects`) : pathname.startsWith(t.href)) &&
                  "border-b-2 border-primary text-foreground",
              )}
            >
              {t.label}
              {t.label === "Chat" && <UnreadBadge />}
            </Link>
          ))}
        </nav>
        <span className="ml-auto"><TimerPill ws={workspaceId} /></span>
        <button
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          aria-label="Search"
        >
          Search <kbd className="rounded border border-border px-1 text-xs">Ctrl K</kbd>
        </button>
        <Button size="sm" onClick={() => setCreating(true)} title="Press C">New task</Button>
      </div>
      {children}
      <QuickCreate open={creating} onClose={() => setCreating(false)} />
      <CommandPalette workspaceId={workspaceId} onCreateTask={() => setCreating(true)} />
      </ChatProvider>
    </WorkspaceProvider>
  );
}

function UnreadBadge() {
  const { totalUnread } = useChat();
  if (totalUnread === 0) return null;
  return <span aria-label={`${totalUnread} unread messages`} className="ml-1.5 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">{totalUnread}</span>;
}
