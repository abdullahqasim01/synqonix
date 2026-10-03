"use client";

import { Menu } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatProvider } from "@/components/chat/chat-provider";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import { QuickCreate } from "@/components/tasks/quick-create";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Alert } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const current = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}", { params: { path: { workspaceId } } }),
    [workspaceId],
  );
  const members = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId } } }),
    [workspaceId],
  );

  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState(false);

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

  return (
    <WorkspaceProvider workspace={current.data} reload={current.reload} members={members.data ?? []}>
      <ChatProvider workspaceId={workspaceId}>
        <aside aria-label="Workspace navigation" className="hidden w-64 shrink-0 border-r border-border bg-sidebar lg:block">
          <WorkspaceSidebar workspaceId={workspaceId} onNewTask={() => setCreating(true)} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside aria-label="Workspace navigation" className="absolute inset-y-0 left-0 w-72 border-r border-border bg-sidebar shadow-xl">
              <WorkspaceSidebar workspaceId={workspaceId} onNewTask={() => setCreating(true)} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2 lg:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button>
            <span className="truncate text-sm font-medium">{current.data.name}</span>
          </div>
          <div className="mx-auto w-full max-w-7xl px-6 py-6">{children}</div>
        </div>
        <QuickCreate open={creating} onClose={() => setCreating(false)} />
        <CommandPalette workspaceId={workspaceId} onCreateTask={() => setCreating(true)} />
      </ChatProvider>
    </WorkspaceProvider>
  );
}
