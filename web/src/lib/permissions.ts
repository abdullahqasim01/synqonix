import type { Schemas } from "@/lib/api/client";

export type WorkspaceRole = Schemas["WorkspaceDto"]["role"];

/** UI hints only; the API enforces permissions. Mirrors api/src/permissions/permissions.ts. */
export const isAdminRole = (role: WorkspaceRole) => role === "OWNER" || role === "ADMIN";
export const canCreateProjects = (role: WorkspaceRole) => role !== "VIEWER";
export const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
