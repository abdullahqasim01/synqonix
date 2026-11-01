"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Avatar } from "@/components/ui/avatar";
import { UserMenu } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

export interface RailWorkspace { id: string; name: string }

/** The narrow dark column of workspaces on the left, as in Slack. */
export function Rail({ workspaces, activeId }: { workspaces: RailWorkspace[]; activeId: string | null }) {
  return (
    <nav aria-label="Workspaces" className="hidden w-[68px] shrink-0 flex-col items-center gap-3 bg-rail py-3 text-rail-foreground md:flex">
      <Link href="/dashboard" aria-label="Synqonix home" className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-lg transition-transform hover:scale-105"><LogoMark size={28} /></Link>
      <div className="h-px w-8 bg-white/10" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto py-1">
        {workspaces.map((w) => {
          const active = w.id === activeId;
          return (
            <Link key={w.id} href={`/w/${w.id}`} title={w.name} aria-label={w.name} aria-current={active ? "page" : undefined} className="group relative">
              <span className={cn("absolute -left-[13px] top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all", active ? "h-8" : "h-0 group-hover:h-4")} />
              <Avatar name={w.name} size={40} className={cn("transition-all", active ? "rounded-xl ring-2 ring-white/70" : "opacity-80 group-hover:rounded-xl group-hover:opacity-100")} />
            </Link>
          );
        })}
        <Link href="/dashboard" title="Add or browse workspaces" aria-label="Add a workspace" className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-white/25 text-white/70 transition-colors hover:border-white/60 hover:text-white">
          <Plus className="h-5 w-5" />
        </Link>
      </div>
      <UserMenu placement="right" />
    </nav>
  );
}
