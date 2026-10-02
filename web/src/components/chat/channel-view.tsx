"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChannelSettingsDialog, MessageTaskDialog } from "@/components/chat/channel-dialogs";
import { useChat, type ChatMessageEvent } from "@/components/chat/chat-provider";
import { Composer } from "@/components/chat/composer";
import { MessageRow } from "@/components/chat/message-row";
import { Alert } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import {
  channelTitle, dayLabel, forViewer, hasGap, maxSeq, mergeMessages, startsGroup, type Channel, type Message,
} from "@/lib/chat";

const PAGE = 50;

/** One conversation: history, live updates, threads, typing and read tracking. */
export function ChannelView({ channel, onGone }: { channel: Channel; onGone: () => void }) {
  const { workspace, memberName } = useWorkspace();
  const { user } = useAuth();
  const chat = useChat();
  const ws = workspace.id;
  const path = { workspaceId: ws, channelId: channel.id };

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [taskFor, setTaskFor] = useState<Message | null>(null);
  // Where the "new messages" line goes: what the user had read when they opened the channel.
  const [firstUnreadAfter] = useState(() => (channel.isMember ? channel.lastReadSeq : Number.POSITIVE_INFINITY));

  const known = useRef(0); // highest sequence number seen, replies included
  const stick = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const lastMarked = useRef(channel.lastReadSeq);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const merge = useCallback((incoming: Message[]) => {
    setMessages((cur) => mergeMessages(cur, incoming));
    known.current = Math.max(known.current, maxSeq(incoming));
  }, []);

  // ---- initial load
  useEffect(() => {
    let cancelled = false;
    void api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages", { params: { path, query: { limit: PAGE } } }).then(({ data, error }) => {
      if (cancelled) return;
      if (!data) setError(errorMessage(error));
      else {
        merge(data.messages);
        setHasOlder(data.hasMore);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, channel.id]);

  const catchUp = useCallback(async () => {
    const { data } = await api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages", {
      params: { path: { workspaceId: ws, channelId: channel.id }, query: { after: known.current, threads: true, limit: 100 } },
    });
    if (data) merge(data.messages);
  }, [ws, channel.id, merge]);

  // ---- live updates
  useEffect(() => {
    if (channel.isMember) return;
    return chat.watchChannel(channel.id);
  }, [chat, channel.id, channel.isMember]);

  useEffect(() => {
    const handle = (e: ChatMessageEvent) => {
      if (e.channelId !== channel.id) return;
      const m = e.message;
      if (e.type === "created") {
        if (hasGap(known.current, m.seq)) void catchUp();
        const authorId = m.author?.userId;
        if (authorId) { // they sent it, so they are no longer typing
          clearTimeout(typingTimers.current.get(authorId));
          setTyping((t) => t.filter((id) => id !== authorId));
        }
      }
      if (e.type === "updated" || (e.type === "created" && m.taskKeys.length > 0)) {
        // Task cards depend on who is looking, so ask the server.
        merge([forViewer(m, user?.id)]);
        void api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}", { params: { path: { ...path, messageId: m.id } } })
          .then(({ data }) => data && merge([data]));
      } else {
        // Keep what we know about the viewer-specific parts (task cards) when only reactions changed.
        setMessages((cur) => {
          const existing = cur.find((x) => x.id === m.id);
          const next = forViewer(m, user?.id);
          return mergeMessages(cur, [existing && e.type === "reactions" ? { ...next, tasks: existing.tasks } : next]);
        });
        known.current = Math.max(known.current, m.seq);
      }
    };
    return chat.onMessage(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.onMessage, channel.id, catchUp, merge, user?.id]);

  // After a reconnect, fetch what happened while we were away.
  const firstConnection = useRef(chat.connectionVersion);
  useEffect(() => {
    if (chat.connectionVersion !== firstConnection.current) void catchUp();
  }, [chat.connectionVersion, catchUp]);

  // ---- typing
  useEffect(() => {
    const timers = typingTimers.current;
    const off = chat.onTyping((e) => {
      if (e.channelId !== channel.id || e.userId === user?.id) return;
      setTyping((t) => (t.includes(e.userId) ? t : [...t, e.userId]));
      clearTimeout(timers.get(e.userId));
      timers.set(e.userId, setTimeout(() => setTyping((t) => t.filter((id) => id !== e.userId)), 4000));
    });
    return () => { off(); timers.forEach(clearTimeout); timers.clear(); };
  }, [chat, channel.id, user?.id]);

  // ---- read tracking
  const top = maxSeq(messages);
  useEffect(() => {
    if (!channel.isMember || top <= lastMarked.current) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      lastMarked.current = known.current;
      void api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/read", { params: { path: { workspaceId: ws, channelId: channel.id } }, body: { seq: known.current } });
    };
    const t = setTimeout(mark, 400);
    window.addEventListener("focus", mark);
    return () => { clearTimeout(t); window.removeEventListener("focus", mark); };
  }, [top, channel.isMember, channel.id, ws]);

  // ---- scrolling
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function loadOlder() {
    const oldest = messages.find((m) => !m.parentId);
    if (!oldest) return;
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    stick.current = false;
    const { data, error } = await api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages", { params: { path, query: { before: oldest.seq, limit: PAGE } } });
    if (!data) return setError(errorMessage(error));
    merge(data.messages);
    setHasOlder(data.hasMore);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  async function join() {
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/channels/{channelId}/join", { params: { path } });
    if (error) setError(errorMessage(error));
    chat.reload();
  }

  const replace = (m: Message) => merge([m]);
  const topLevel = messages.filter((m) => !m.parentId);
  const thread = threadId ? messages.find((m) => m.id === threadId) ?? null : null;
  const title = channelTitle(channel, user?.id);
  const peers = typing.map(memberName);

  const dividerAt = topLevel.findIndex((m) => m.seq > firstUnreadAfter && m.author?.userId !== user?.id);

  return (
    <section aria-label={`Conversation ${title}`} className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_auto]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-medium">{channel.type === "DIRECT" ? title : `${channel.type === "PRIVATE" ? "🔒 " : "# "}${title}`}</h2>
            {channel.topic && <p className="truncate text-xs text-muted-foreground">{channel.topic}</p>}
          </div>
          {channel.archived && <span className="rounded bg-muted px-2 py-0.5 text-xs">Archived</span>}
          <Button size="sm" variant="outline" onClick={() => setShowSettings(true)}>
            {channel.type === "DIRECT" ? "People" : `Details · ${channel.memberCount}`}
          </Button>
        </header>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto py-2"
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        >
          {error && <div className="px-4"><Alert>{error}</Alert></div>}
          {hasOlder && <div className="flex justify-center py-2"><Button size="sm" variant="ghost" onClick={() => void loadOlder()}>Load earlier messages</Button></div>}
          {loading && <p className="px-4 text-sm text-muted-foreground">Loading messages…</p>}
          {!loading && topLevel.length === 0 && !hasOlder && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No messages yet. Say hello!</p>}
          {topLevel.map((m, i) => {
            const newDay = i === 0 || new Date(m.createdAt).toDateString() !== new Date(topLevel[i - 1].createdAt).toDateString();
            const showDivider = i === dividerAt;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 flex items-center gap-3 px-4 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />{dayLabel(m.createdAt)}<span className="h-px flex-1 bg-border" />
                  </div>
                )}
                {showDivider && (
                  <div role="separator" aria-label="New messages" className="my-2 flex items-center gap-3 px-4 text-xs font-medium text-red-600">
                    <span className="h-px flex-1 bg-red-500/50" />New<span className="h-px flex-1 bg-red-500/50" />
                  </div>
                )}
                <MessageRow
                  workspaceId={ws}
                  channelId={channel.id}
                  message={m}
                  header={newDay || showDivider || startsGroup(topLevel[i - 1], m)}
                  isOwn={m.author?.userId === user?.id}
                  canModerate={channel.isAdmin}
                  canPost={channel.canPost}
                  onChange={replace}
                  onReply={(msg) => {
                    setThreadId(msg.id);
                    void api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages/{messageId}/replies", { params: { path: { ...path, messageId: msg.id } } })
                      .then(({ data }) => data && merge(data.messages));
                  }}
                  onTask={channel.canPost || channel.isMember ? setTaskFor : undefined}
                />
              </div>
            );
          })}
        </div>

        <div className="border-t border-border px-4 py-3">
          <p aria-live="polite" className="h-4 text-xs text-muted-foreground">
            {peers.length === 1 ? `${peers[0]} is typing…` : peers.length > 1 ? "Several people are typing…" : ""}
          </p>
          {channel.canPost ? (
            channel.isMember || channel.type !== "PRIVATE" ? (
              <Composer
                channelId={channel.id}
                placeholder={`Message ${channel.type === "DIRECT" ? title : `#${title}`}`}
                onSent={(m) => { stick.current = true; merge([m]); }}
              />
            ) : null
          ) : (
            <p className="text-sm text-muted-foreground">{channel.archived ? "This channel is archived." : "You can read this channel but not post in it."}</p>
          )}
          {!channel.isMember && channel.type !== "DIRECT" && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              You are not following this channel. <Button size="sm" variant="outline" onClick={() => void join()}>Join channel</Button>
            </div>
          )}
        </div>
      </div>

      {thread && (
        <ThreadPanel
          root={thread}
          messages={messages.filter((m) => m.parentId === thread.id)}
          channel={channel}
          userId={user?.id}
          onChange={replace}
          onClose={() => setThreadId(null)}
          onSent={(m) => merge([m])}
        />
      )}
      {showSettings && <ChannelSettingsDialog channel={channel} onClose={() => setShowSettings(false)} onLeft={() => { setShowSettings(false); onGone(); }} />}
      {taskFor && <MessageTaskDialog channelId={channel.id} message={taskFor} onClose={() => setTaskFor(null)} onDone={replace} />}
    </section>
  );
}

function ThreadPanel({ root, messages, channel, userId, onChange, onClose, onSent }: {
  root: Message; messages: Message[]; channel: Channel; userId: string | undefined;
  onChange(m: Message): void; onClose(): void; onSent(m: Message): void;
}) {
  const { workspace } = useWorkspace();
  const common = {
    workspaceId: workspace.id, channelId: channel.id, canModerate: channel.isAdmin, canPost: channel.canPost, inThread: true, onChange,
  };
  return (
    <aside aria-label="Thread" className="flex min-h-0 w-full flex-col border-l border-border lg:w-96">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="font-medium">Thread</h3>
        <Button size="sm" variant="ghost" aria-label="Close thread" onClick={onClose}>×</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <MessageRow {...common} message={root} header isOwn={root.author?.userId === userId} />
        <p className="px-4 py-2 text-xs text-muted-foreground">{messages.length} {messages.length === 1 ? "reply" : "replies"}</p>
        {messages.map((m, i) => (
          <MessageRow key={m.id} {...common} message={m} header={startsGroup(messages[i - 1], m)} isOwn={m.author?.userId === userId} />
        ))}
      </div>
      {channel.canPost && (
        <div className="border-t border-border px-4 py-3">
          <Composer channelId={channel.id} parentId={root.id} placeholder="Reply in thread" onSent={onSent} />
        </div>
      )}
    </aside>
  );
}
