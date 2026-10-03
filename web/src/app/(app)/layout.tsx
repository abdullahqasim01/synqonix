"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect } from "react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Rail } from "@/components/shell/rail";
import { UserMenu } from "@/components/shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { useQuery } from "@/lib/use-query";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, status, retry } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = status === "authenticated" && !!user;
  const workspaces = useQuery(() => (signedIn ? api.GET("/api/v1/workspaces") : Promise.resolve({ data: [] as { id: string; name: string }[], error: undefined })), [signedIn]);

  useEffect(() => {
    if (status !== "anonymous") return;
    // Come back to where they were headed (e.g. the editor's sign-in handshake) after logging in.
    const here = window.location.pathname + window.location.search;
    router.replace(here === "/dashboard" || here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
  }, [status, router, pathname]);

  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>We could not reach Synqonix. Your session is still saved.</p>
        <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (!signedIn) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  const activeId = /^\/w\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const inWorkspace = activeId !== null;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring">Skip to content</a>
      <Rail workspaces={workspaces.data ?? []} activeId={activeId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
          <Link href="/dashboard" className="font-semibold tracking-tight md:hidden">Synqonix</Link>
          <div className="mx-auto w-full max-w-xl">
            {inWorkspace && (
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
                aria-label="Search"
                className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Search className="h-4 w-4" />
                <span>Search tasks, messages, people…</span>
                <kbd className="ml-auto rounded border border-border bg-background px-1.5 text-[11px]">Ctrl K</kbd>
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <div className="ml-1 md:hidden"><UserMenu /></div>
          </div>
        </header>
        {inWorkspace ? (
          <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 outline-none">{children}</main>
        ) : (
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
