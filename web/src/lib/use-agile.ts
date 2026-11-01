"use client";

import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

/** Sprints of a project (all states), active first. Pass `enabled=false` to skip the request. */
export function useSprints(workspaceId: string, projectId: string | undefined, enabled = true, version = 0) {
  return useQuery(
    async () => (enabled && projectId
      ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/sprints", { params: { path: { workspaceId, projectId } } })
      : { data: undefined }),
    [workspaceId, projectId, enabled, version],
  );
}

export function useReleases(workspaceId: string, projectId: string | undefined, version = 0) {
  return useQuery(
    async () => (projectId ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/releases", { params: { path: { workspaceId, projectId } } }) : { data: undefined }),
    [workspaceId, projectId, version],
  );
}

export function useMilestones(workspaceId: string, projectId: string | undefined, version = 0) {
  return useQuery(
    async () => (projectId ? api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones", { params: { path: { workspaceId, projectId } } }) : { data: undefined }),
    [workspaceId, projectId, version],
  );
}
