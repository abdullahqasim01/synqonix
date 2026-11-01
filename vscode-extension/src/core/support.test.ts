import { describe, expect, it } from "vitest";
import { SynqonixError } from "./api";
import { connectUrl, isApiToken, newState, parseAuthCallback } from "./auth";
import { cachedLoad, OfflineCache, type KeyValueStore } from "./cache";
import { NotificationPoller, pickNew, type Notification } from "./notifications";

class Mem implements KeyValueStore {
  data = new Map<string, unknown>();
  get<T>(k: string) { return this.data.get(k) as T | undefined; }
  async update(k: string, v: unknown) { if (v === undefined) this.data.delete(k); else this.data.set(k, v); }
}

describe("offline cache", () => {
  it("serves the last good answer when the server is unreachable, and says so", async () => {
    const cache = new OfflineCache(new Mem(), 40, () => 1000);
    expect(await cachedLoad(cache, "tasks", async () => ["a"])).toEqual({ data: ["a"] });
    const offline = await cachedLoad(cache, "tasks", async () => { throw new SynqonixError("offline", "down"); });
    expect(offline).toEqual({ data: ["a"], staleSince: 1000 });
  });
  it("does not hide other failures, nor invent data it never had", async () => {
    const cache = new OfflineCache(new Mem());
    await cachedLoad(cache, "k", async () => 1);
    await expect(cachedLoad(cache, "k", async () => { throw new SynqonixError("unauthorized", "no"); })).rejects.toThrow("no");
    await expect(cachedLoad(cache, "other", async () => { throw new SynqonixError("offline", "down"); })).rejects.toThrow("down");
  });
  it("forgets the oldest entries and can be cleared", async () => {
    const store = new Mem();
    const cache = new OfflineCache(store, 2);
    for (const k of ["a", "b", "c"]) await cache.save(k, k);
    expect(cache.load("a")).toBeUndefined();
    expect(cache.load("c")?.data).toBe("c");
    await cache.clear();
    expect(cache.load("b")).toBeUndefined();
  });
});

describe("browser sign-in", () => {
  const token = "sqx_" + "a".repeat(30);
  it("recognises our tokens", () => {
    expect(isApiToken(token)).toBe(true);
    expect(isApiToken(` ${token} `)).toBe(true);
    for (const bad of ["", "sqx_short", "abc", "Bearer " + token, "sqx_" + "a".repeat(20) + " x"]) expect(isApiToken(bad)).toBe(false);
  });
  it("builds the start URL and creates unguessable state", () => {
    expect(connectUrl("http://localhost:3000/", "abc")).toBe("http://localhost:3000/connect/vscode?state=abc");
    expect(newState()).toMatch(/^[a-f0-9]{32}$/);
    expect(newState()).not.toBe(newState());
  });
  it("accepts only a well-formed callback", () => {
    const state = "a".repeat(32);
    expect(parseAuthCallback({ path: "/auth", query: `token=${token}&state=${state}` })).toEqual({ token, state });
    for (const bad of [
      { path: "/other", query: `token=${token}&state=${state}` }, { path: "/auth", query: `state=${state}` }, { path: "/auth", query: `token=${token}` },
      { path: "/auth", query: `token=nope&state=${state}` }, { path: "/auth", query: `token=${token}&state=xyz` },
    ]) expect(parseAuthCallback(bad)).toBeNull();
  });
});

const note = (id: string, at: string, over: Partial<Notification> = {}): Notification => ({ id, type: "ASSIGNED", surfacedAt: at, read: false, title: id, ...over }) as Notification;

describe("notification polling", () => {
  it("announces only unread items newer than what was seen", () => {
    const items = [note("c", "2026-03-03"), note("b", "2026-03-02", { read: true }), note("a", "2026-03-01")];
    expect(pickNew(items, "2026-03-01").fresh.map((n) => n.id)).toEqual(["c"]);
    expect(pickNew(items, "2026-03-01").newest).toBe("2026-03-03");
    expect(pickNew(items, undefined)).toEqual({ fresh: [], newest: "2026-03-03" }); // first run: just record
    expect(pickNew([], "2026-03-01")).toEqual({ fresh: [], newest: "2026-03-01" });
  });

  it("records the first poll quietly, then reports new items once", async () => {
    let seen: string | undefined;
    let inbox = [note("a", "2026-03-01")];
    const got: string[][] = [];
    const poller = new NotificationPoller({ fetch: async () => inbox, getLastSeen: () => seen, setLastSeen: (v) => { seen = v; }, onNew: (f) => got.push(f.map((n) => n.id)), intervalMs: 1000 });
    expect(await poller.pollOnce()).toEqual([]);
    expect(seen).toBe("2026-03-01");
    inbox = [note("b", "2026-03-02"), ...inbox];
    expect((await poller.pollOnce()).map((n) => n.id)).toEqual(["b"]);
    await poller.pollOnce();
    expect(got).toEqual([["b"]]);
  });

  it("survives errors and schedules the next poll until stopped", async () => {
    const timers: (() => void)[] = [];
    const errors: unknown[] = [];
    let calls = 0;
    const poller = new NotificationPoller({
      fetch: async () => { calls++; if (calls === 1) throw new Error("down"); return []; }, getLastSeen: () => undefined, setLastSeen: () => {}, onNew: () => {},
      onError: (e) => errors.push(e), intervalMs: 5, schedule: (fn) => { timers.push(fn); return timers.length; }, cancel: () => {},
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
    expect(timers).toHaveLength(1);
    timers[0]();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(2);
    poller.stop();
    timers[1]?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(2);
  });
});
