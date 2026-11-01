"use client";

import { createContext, useContext } from "react";
import type { Schemas } from "@/lib/api/client";
import { isAdminRole } from "@/lib/permissions";

interface WorkspaceContextValue {
  workspace: Schemas["WorkspaceDto"];
  isAdmin: boolean;
  reload(): void;
  members: Schemas["MemberDto"][];
  /** Display name for a user id (falls back to "Someone"). */
  memberName(userId: string | null | undefined): string;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspace, reload, members, children,
}: { workspace: Schemas["WorkspaceDto"]; reload: () => void; members: Schemas["MemberDto"][]; children: React.ReactNode }) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const memberName = (id: string | null | undefined) => (id && names.get(id)) || "Someone";
  return <Ctx.Provider value={{ workspace, isAdmin: isAdminRole(workspace.role), reload, members, memberName }}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside a workspace route");
  return ctx;
}
