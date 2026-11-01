import type { Schemas } from "@/lib/api/client";

export type Channel = Schemas["ChannelDto"];
export type Message = Schemas["MessageDto"];

export const QUICK_REACTIONS = ["👍", "❤️", "😄", "🎉", "👀", "🚀"];

/** Messages sorted by sequence number, with `incoming` replacing entries of the same id. */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Largest sequence number among the messages (0 when empty). */
export const maxSeq = (messages: Message[]) => messages.reduce((n, m) => Math.max(n, m.seq), 0);

/**
 * Whether a live message at `seq` leaves a hole after what we have seen (`known`), meaning
 * something was missed and the client should fetch everything after `known`.
 */
export const hasGap = (known: number, seq: number) => seq > known + 1;

/** Recomputes `reacted` for the viewer, since live payloads are viewer-neutral. */
export function forViewer(message: Message, userId: string | undefined): Message {
  return { ...message, reactions: message.reactions.map((r) => ({ ...r, reacted: !!userId && r.userIds.includes(userId) })) };
}

/** Name of a conversation: `#name` for channels, the other people for direct messages. */
export function channelTitle(channel: Channel, userId: string | undefined): string {
  if (channel.type !== "DIRECT") return channel.name ?? "channel";
  const others = channel.participants.filter((p) => p.userId !== userId).map((p) => p.name);
  return others.length > 0 ? others.join(", ") : "Just you";
}

/** The other person in a one-to-one conversation (for presence), if it is one. */
export function directPeer(channel: Channel, userId: string | undefined): string | null {
  if (channel.type !== "DIRECT") return null;
  const others = channel.participants.filter((p) => p.userId !== userId);
  return others.length === 1 ? others[0].userId : null;
}

/**
 * Turns task keys the viewer can see into markdown links, leaving code spans and blocks alone.
 * Keys they cannot see stay plain text.
 */
export function linkifyTaskKeys(body: string, workspaceId: string, keys: string[]): string {
  if (keys.length === 0) return body;
  const known = new Set(keys.map((k) => k.toUpperCase()));
  return body
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(?<![\w/\-[])([A-Za-z][A-Za-z0-9]{1,9}-\d{1,9})(?![\w-])/g, (key) =>
            known.has(key.toUpperCase()) ? `[${key}](/w/${workspaceId}/tasks/${key.toUpperCase()})` : key,
          ),
    )
    .join("");
}

/** Messages that start a new run by the same author within five minutes are shown compactly. */
export function startsGroup(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.deleted || m.deleted) return true;
  if (prev.author?.userId !== m.author?.userId) return true;
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
}

export const dayLabel = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

/** The `@query` being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([\w.-]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1].toLowerCase() } : null;
}

export const mentionLink = (name: string, userId: string) => `[@${name.replace(/[[\]]/g, "")}](mention:${userId})`;
