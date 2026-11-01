"use client";

import { createContext, useContext } from "react";
import type { Schemas } from "@/lib/api/client";

interface ProjectContextValue {
  project: Schemas["ProjectDetailDto"];
  reload(): void;
}

const Ctx = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ project, reload, children }: ProjectContextValue & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ project, reload }}>{children}</Ctx.Provider>;
}

export function useProject() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProject must be used inside a project route");
  return ctx;
}

/** Like `useProject`, but returns null outside a project route (e.g. the "My tasks" page). */
export function useProjectOptional() {
  return useContext(Ctx);
}
