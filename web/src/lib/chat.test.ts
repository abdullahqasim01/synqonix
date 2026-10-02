import { describe, expect, it } from "vitest";
import {
  channelTitle, directPeer, forViewer, hasGap, linkifyTaskKeys, maxSeq, mentionLink, mentionQuery, mergeMessages, startsGroup,
  type Channel, type Message,
} from "./chat";

const msg = (seq: number, extra: Partial<Message> = {}): Message => ({
  id: `m${seq}`, channelId: "c", seq, parentId: null, author: { userId: "u1", name: "Ann" }, body: `b${seq}`, deleted: false, edited: false,
  createdAt: new Date(2026, 0, 1, 12, seq).toISOString(), editedAt: null, replyCount: 0, lastReplyAt: null, reactions: [], attachments: [],
  taskKeys: [], tasks: [], ...extra,
}) as Message;

describe("message merging", () => {
  it("orders by seq and replaces duplicates", () => {
    const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3, { body: "edited" })]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(merged[2].body).toBe("edited");
    expect(maxSeq(merged)).toBe(3);
    expect(maxSeq([])).toBe(0);
  });

  it("detects holes in the stream", () => {
    expect(hasGap(5, 6)).toBe(false);
    expect(hasGap(5, 5)).toBe(false);
    expect(hasGap(5, 8)).toBe(true);
  });

  it("works out who reacted from the user id", () => {
    const m = msg(1, { reactions: [{ emoji: "👍", count: 2, userIds: ["a", "b"], reacted: false }] });
    expect(forViewer(m, "b").reactions[0].reacted).toBe(true);
    expect(forViewer(m, "z").reactions[0].reacted).toBe(false);
    expect(forViewer(m, undefined).reactions[0].reacted).toBe(false);
  });
});

describe("channel titles", () => {
  const dm = (names: [string, string][]) => ({ type: "DIRECT", name: null, participants: names.map(([userId, name]) => ({ userId, name })) }) as unknown as Channel;
  it("shows the other people of a direct message", () => {
    expect(channelTitle(dm([["me", "Me"], ["a", "Ann"]]), "me")).toBe("Ann");
    expect(channelTitle(dm([["me", "Me"], ["a", "Ann"], ["b", "Bob"]]), "me")).toBe("Ann, Bob");
    expect(channelTitle(dm([["me", "Me"]]), "me")).toBe("Just you");
    expect(channelTitle({ type: "PUBLIC", name: "general" } as Channel, "me")).toBe("general");
  });
  it("only has a peer in one-to-one conversations", () => {
    expect(directPeer(dm([["me", "Me"], ["a", "Ann"]]), "me")).toBe("a");
    expect(directPeer(dm([["me", "Me"], ["a", "Ann"], ["b", "Bob"]]), "me")).toBeNull();
  });
});

describe("task keys in text", () => {
  it("links only visible keys and skips code", () => {
    const out = linkifyTaskKeys("see SYN-1, SEC-2 and `SYN-1` then\n```\nSYN-1\n```", "w1", ["SYN-1"]);
    expect(out).toContain("[SYN-1](/w/w1/tasks/SYN-1), SEC-2");
    expect(out).toContain("`SYN-1`");
    expect(out).toContain("```\nSYN-1\n```");
    expect(out.match(/\[SYN-1\]/g)).toHaveLength(1);
  });
  it("leaves text alone without visible keys", () => {
    expect(linkifyTaskKeys("SYN-1", "w", [])).toBe("SYN-1");
  });
  it("does not relink existing markdown links", () => {
    expect(linkifyTaskKeys("[SYN-1](https://x.test)", "w", ["SYN-1"])).toBe("[SYN-1](https://x.test)");
  });
});

describe("grouping and mentions", () => {
  it("groups quick consecutive messages by the same author", () => {
    expect(startsGroup(undefined, msg(1))).toBe(true);
    expect(startsGroup(msg(1), msg(2))).toBe(false);
    expect(startsGroup(msg(1), msg(2, { author: { userId: "u2", name: "Bo" } }))).toBe(true);
    expect(startsGroup(msg(1), msg(30))).toBe(true);
    expect(startsGroup(msg(1, { deleted: true }), msg(2))).toBe(true);
  });
  it("finds the mention being typed", () => {
    expect(mentionQuery("hello @Al", 9)).toEqual({ start: 6, query: "al" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("mail me@ex", 10)).toBeNull();
    expect(mentionQuery("hi @al there", 12)).toBeNull();
  });
  it("builds a mention link without breaking markdown", () => {
    expect(mentionLink("A [x]", "u1")).toBe("[@A x](mention:u1)");
  });
});
