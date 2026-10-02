"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { Channel, Message } from "@/lib/chat";
import { acquireSocket } from "@/lib/realtime";

export interface ChatMessageEvent { type: "created" | "updated" | "deleted" | "reactions"; channelId: string; message: Message }
interface TypingEvent { channelId: string; userId: string }

interface ChatContextValue {
  channels: Channel[];
  loading: boolean;
  /** Messages waiting for the user across the channels they follow. */
  totalUnread: number;
  reload(): void;
  /** Users currently online in this workspace. */
  online: Set<string>;
  /** Bumps every time the socket reconnects, so views can catch up on what they missed. */
  connectionVersion: number;
  onMessage(handler: (e: ChatMessageEvent) => void): () => void;
  onTyping(handler: (e: TypingEvent) => void): () => void;
  /** Watch a channel the user does not follow; followed channels are delivered anyway. */
  watchChannel(channelId: string): () => void;
  emitTyping(channelId: string): void;
}

const Ctx = createContext<ChatContextValue | null>(null);

/**
 * Keeps the channel list (with unread counts), presence and the live connection for a workspace.
 * Everything chat related in the UI reads from here, so the nav badge and the chat page agree.
 */
export function ChatProvider({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [connectionVersion, setConnectionVersion] = useState(0);

  const messageHandlers = useRef(new Set<(e: ChatMessageEvent) => void>());
  const typingHandlers = useRef(new Set<(e: TypingEvent) => void>());
  const watched = useRef(new Map<string, number>());
  const socketRef = useRef<ReturnType<typeof acquireSocket>["socket"] | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/v1/workspaces/{workspaceId}/channels", { params: { path: { workspaceId } } });
    if (data) setChannels(data);
    setLoading(false);
  }, [workspaceId]);

  /** Several events often arrive together (a message plus its read receipt); fetch once. */
  const reload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 250);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  useEffect(() => {
    const { socket, release } = acquireSocket();
    socketRef.current = socket;
    let first = true;

    const join = () => {
      socket.emit("presence:subscribe", { workspaceId }, (res: { ok: boolean; online?: string[] }) => {
        if (res?.ok) setOnline(new Set(res.online ?? []));
      });
      for (const channelId of watched.current.keys()) socket.emit("channel:subscribe", { workspaceId, channelId });
      if (!first) {
        setConnectionVersion((v) => v + 1);
        void load();
      }
      first = false;
    };
    const onPresence = (e: { workspaceId: string; userId: string; online: boolean }) => {
      if (e.workspaceId !== workspaceId) return;
      setOnline((prev) => {
        const next = new Set(prev);
        if (e.online) next.add(e.userId);
        else next.delete(e.userId);
        return next;
      });
    };
    const onMessage = (e: ChatMessageEvent) => {
      messageHandlers.current.forEach((h) => h(e));
      if (e.type === "created" || e.type === "deleted") reload();
    };
    const onTyping = (e: TypingEvent) => typingHandlers.current.forEach((h) => h(e));

    socket.on("connect", join);
    if (socket.connected) join();
    socket.on("presence", onPresence);
    socket.on("message", onMessage);
    socket.on("typing", onTyping);
    socket.on("channels:changed", reload);
    socket.on("channel:read", reload);
    return () => {
      socket.off("connect", join);
      socket.off("presence", onPresence);
      socket.off("message", onMessage);
      socket.off("typing", onTyping);
      socket.off("channels:changed", reload);
      socket.off("channel:read", reload);
      clearTimeout(reloadTimer.current);
      socketRef.current = null;
      release();
    };
  }, [workspaceId, load, reload]);

  const value = useMemo<ChatContextValue>(
    () => ({
      channels, loading, reload, online, connectionVersion,
      totalUnread: channels.reduce((n, c) => n + c.unreadCount, 0),
      onMessage(handler) {
        messageHandlers.current.add(handler);
        return () => void messageHandlers.current.delete(handler);
      },
      onTyping(handler) {
        typingHandlers.current.add(handler);
        return () => void typingHandlers.current.delete(handler);
      },
      watchChannel(channelId) {
        watched.current.set(channelId, (watched.current.get(channelId) ?? 0) + 1);
        const s = socketRef.current;
        if (s?.connected) s.emit("channel:subscribe", { workspaceId, channelId });
        return () => {
          const n = (watched.current.get(channelId) ?? 1) - 1;
          if (n <= 0) {
            watched.current.delete(channelId);
            socketRef.current?.emit("channel:unsubscribe", { channelId });
          } else watched.current.set(channelId, n);
        };
      },
      emitTyping: (channelId) => socketRef.current?.emit("typing", { channelId }),
    }),
    [channels, loading, reload, online, connectionVersion, workspaceId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat must be used inside a workspace route");
  return ctx;
}
