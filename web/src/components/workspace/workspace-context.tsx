"use client";

import { createContext, useContext } from "react";
import type { Schemas } from "@/lib/api/client";
import { isAdminRole } from "@/lib/permissions";

interface WorkspaceContextValue {
  workspace: Schemas["WorkspaceDto"];
  isAdmin: boolean;
  reload(): void;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspace, reload, children,
}: { workspace: Schemas["WorkspaceDto"]; reload: () => void; children: React.ReactNode }) {
  return <Ctx.Provider value={{ workspace, isAdmin: isAdminRole(workspace.role), reload }}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside a workspace route");
  return ctx;
}
