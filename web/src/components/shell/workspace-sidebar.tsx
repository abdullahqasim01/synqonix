"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, ChevronDown, Hash, Home, LayoutDashboard, Lock, MessageSquare, Plus, Settings, Users, UsersRound } from "lucide-react";
import { useState } from "react";
import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TimerPill } from "@/components/time/time-tracking";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

const row = "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors";
const idle = "text-muted-foreground hover:bg-muted hover:text-foreground";
const on = "bg-primary/10 font-medium text-primary";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4">
      <div className="group flex items-center px-2.5">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex flex-1 items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5 grid gap-0.5">{children}</div>}
    </div>
  );
}

/** Slack/ClickUp-style navigation: workspace header, main sections, projects and channels. */
export function WorkspaceSidebar({ workspaceId, onNewTask, onNavigate }: { workspaceId: string; onNewTask(): void; onNavigate?(): void }) {
  const { workspace } = useWorkspace();
  const pathname = usePathname();
  const { channels, totalUnread } = useChat();
  const projects = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId }, query: { includeArchived: false } } }),
    [workspaceId],
  );

  const base = `/w/${workspaceId}`;
  const nav = [
    { href: base, label: "Home", icon: Home, exact: true },
    { href: `${base}/my-tasks`, label: "My tasks", icon: CheckSquare },
    { href: `${base}/overview`, label: "Overview", icon: LayoutDashboard },
    { href: `${base}/chat`, label: "Chat", icon: MessageSquare, badge: totalUnread },
    { href: `${base}/members`, label: "Members", icon: Users },
    { href: `${base}/teams`, label: "Teams", icon: UsersRound },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];
  const isOn = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const shownChannels = channels.filter((c) => c.isMember && !c.archived && c.type !== "DIRECT").slice(0, 8);

  return (
    <div className="flex h-full flex-col" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
        <Avatar name={workspace.name} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{workspace.name}</p>
          <p className="text-xs capitalize text-muted-foreground">{workspace.role.toLowerCase()}</p>
        </div>
      </div>

      <div className="px-3 pt-3">
        <Button className="w-full justify-start gap-2" onClick={() => { onNewTask(); onNavigate?.(); }} title="Press C">
          <Plus className="h-4 w-4" /> New task <kbd className="ml-auto rounded bg-white/20 px-1.5 text-[11px] font-normal">C</kbd>
        </Button>
      </div>

      <nav aria-label="Workspace" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3">
        <div className="grid gap-0.5">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isOn(n.href, n.exact) ? "page" : undefined} className={cn(row, isOn(n.href, n.exact) ? on : idle)}>
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{n.label}</span>
              {n.badge ? <span aria-label={`${n.badge} unread messages`} className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">{n.badge}</span> : null}
            </Link>
          ))}
        </div>

        <Section title="Projects" action={<Link href={base} aria-label="All projects" title="All projects" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="h-3.5 w-3.5" /></Link>}>
          {projects.loading && <p className="px-2.5 py-1 text-xs text-muted-foreground">Loading…</p>}
          {projects.data?.map((p) => {
            const href = `${base}/projects/${p.id}`;
            return (
              <Link key={p.id} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={cn(row, pathname.startsWith(href) ? on : idle)}>
                <Avatar name={p.name} size={20} className="rounded-md" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.visibility === "PRIVATE" && <Lock className="h-3 w-3 shrink-0 opacity-60" aria-label="private" />}
              </Link>
            );
          })}
          {projects.data?.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">No projects yet</p>}
        </Section>

        {shownChannels.length > 0 && (
          <Section title="Channels">
            {shownChannels.map((c) => {
              const href = `${base}/chat?c=${c.id}`;
              return (
                <Link key={c.id} href={href} className={cn(row, idle, c.unreadCount > 0 && "font-semibold text-foreground")}>
                  {c.type === "PRIVATE" ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />}
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.mentionCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-medium text-white">{c.mentionCount}</span> : c.unreadCount > 0 ? <span className="h-2 w-2 rounded-full bg-primary" aria-label="unread" /> : null}
                </Link>
              );
            })}
          </Section>
        )}
      </nav>

      <div className="border-t border-border p-3"><TimerPill ws={workspaceId} /></div>
    </div>
  );
}
