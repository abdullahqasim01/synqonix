"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Alert, Badge } from "@/components/ui/form";
import { ProjectProvider } from "@/components/workspace/project-context";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const pathname = usePathname();
  const project = useQuery(
    () => api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}", { params: { path: { workspaceId, projectId } } }),
    [workspaceId, projectId],
  );

  if (project.loading) return <p className="text-sm text-muted-foreground">Loading project…</p>;
  if (!project.data) return <Alert>{project.error ?? "Project not found"}</Alert>;
  const p = project.data;
  const base = `/w/${workspaceId}/projects/${projectId}`;

  return (
    <ProjectProvider project={p} reload={project.reload}>
      <div className="grid gap-4">
        <div>
          <Link href={`/w/${workspaceId}`} className="text-sm text-muted-foreground hover:text-foreground">← Projects</Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <Badge className="font-mono">{p.key}</Badge>
            {p.visibility === "PRIVATE" && <Badge>private</Badge>}
            {p.archived && <Badge>archived</Badge>}
          </div>
          {p.description && <p className="mt-1 text-muted-foreground">{p.description}</p>}
        </div>
        <nav className="flex gap-4 border-b border-border text-sm">
          {[{ href: base, label: "Tasks" }, { href: `${base}/settings`, label: "Settings" }].map((t) => (
            <Link key={t.href} href={t.href} className={cn("pb-2 text-muted-foreground hover:text-foreground", pathname === t.href && "border-b-2 border-primary text-foreground")}>
              {t.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </ProjectProvider>
  );
}
