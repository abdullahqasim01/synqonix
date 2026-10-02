"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { acquireSocket } from "@/lib/realtime";

export type Notification = Schemas["NotificationDto"];

/**
 * The signed-in user's inbox, kept fresh by the live connection (the server only says "something
 * changed", so the list is refetched), with a slow poll as a safety net.
 */
export function useNotifications({ workspaceId, unreadOnly = false, limit = 20 }: { workspaceId?: string; unreadOnly?: boolean; limit?: number }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = { limit, ...(workspaceId ? { workspaceId } : {}), ...(unreadOnly ? { unread: true } : {}) };
    const [list, count] = await Promise.all([
      api.GET("/api/v1/notifications", { params: { query } }),
      api.GET("/api/v1/notifications/unread-count", { params: { query: workspaceId ? { workspaceId } : {} } }),
    ]);
    if (list.data) { setItems(list.data.items); setHasMore(list.data.hasMore); setError(null); }
    else setError(errorMessage(list.error));
    if (count.data) setUnread(count.data.count);
    setLoading(false);
  }, [workspaceId, unreadOnly, limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
    const { socket, release } = acquireSocket();
    const refresh = () => void load();
    socket.on("notification", refresh);
    socket.on("connect", refresh);
    const poll = setInterval(refresh, 60_000);
    return () => {
      socket.off("notification", refresh);
      socket.off("connect", refresh);
      clearInterval(poll);
      release();
    };
  }, [load]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    const query = { limit, before: last.surfacedAt, ...(workspaceId ? { workspaceId } : {}), ...(unreadOnly ? { unread: true } : {}) };
    const { data } = await api.GET("/api/v1/notifications", { params: { query } });
    if (data) { setItems((cur) => [...cur, ...data.items]); setHasMore(data.hasMore); }
  }

  const act = async (run: () => Promise<{ error?: unknown }>) => {
    const { error } = await run();
    setError(error ? errorMessage(error) : null);
    await load();
  };

  return {
    items, hasMore, unread, loading, error, reload: load, loadMore,
    markRead: (id: string, read: boolean) =>
      act(() => (read
        ? api.POST("/api/v1/notifications/{id}/read", { params: { path: { id } } })
        : api.POST("/api/v1/notifications/{id}/unread", { params: { path: { id } } }))),
    markAllRead: () => act(() => api.POST("/api/v1/notifications/read-all", { body: workspaceId ? { workspaceId } : {} })),
    snooze: (id: string, until: Date) => act(() => api.POST("/api/v1/notifications/{id}/snooze", { params: { path: { id } }, body: { until: until.toISOString() } })),
    dismiss: (id: string) => act(() => api.DELETE("/api/v1/notifications/{id}", { params: { path: { id } } })),
  };
}
