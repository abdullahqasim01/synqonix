"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
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

  if (current.loading) return <p className="text-sm text-muted-foreground">Loading workspace…</p>;
  if (!current.data) return <Alert>{current.error ?? "Workspace not found"}</Alert>;

  const base = `/w/${workspaceId}`;
  const tabs = [
    { href: base, label: "Projects" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/teams`, label: "Teams" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <WorkspaceProvider workspace={current.data} reload={current.reload}>
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
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </WorkspaceProvider>
  );
}
