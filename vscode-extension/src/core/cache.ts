import { SynqonixError } from "./api";

/** The slice of VS Code's `Memento` the cache needs, so it can be tested without VS Code. */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | Promise<void>;
}

interface Entry { at: number; data: unknown }

/**
 * Remembers the last successful answer per key so trees and pickers still show something when the
 * network or server is down. Old entries are dropped beyond `maxEntries`.
 */
export class OfflineCache {
  private static readonly INDEX = "sx.cache.index";

  constructor(
    private readonly store: KeyValueStore,
    private readonly maxEntries = 40,
    private readonly now: () => number = Date.now,
  ) {}

  private k = (key: string) => `sx.cache.v1:${key}`;

  async save(key: string, data: unknown): Promise<void> {
    const index = (this.store.get<string[]>(OfflineCache.INDEX) ?? []).filter((x) => x !== key);
    index.push(key);
    for (const old of index.splice(0, Math.max(0, index.length - this.maxEntries))) await this.store.update(this.k(old), undefined);
    await this.store.update(this.k(key), { at: this.now(), data } satisfies Entry);
    await this.store.update(OfflineCache.INDEX, index);
  }

  load<T>(key: string): { data: T; at: number } | undefined {
    const e = this.store.get<Entry>(this.k(key));
    return e ? { data: e.data as T, at: e.at } : undefined;
  }

  async clear(): Promise<void> {
    for (const key of this.store.get<string[]>(OfflineCache.INDEX) ?? []) await this.store.update(this.k(key), undefined);
    await this.store.update(OfflineCache.INDEX, []);
  }
}

export interface Loaded<T> { data: T; /** Epoch ms of the cached copy when the server could not be reached. */ staleSince?: number }

/**
 * Loads fresh data and remembers it; when the server is unreachable falls back to the remembered
 * copy (flagged stale). Other errors (signed out, not allowed, server errors) are not hidden.
 */
export async function cachedLoad<T>(cache: OfflineCache, key: string, loader: () => Promise<T>): Promise<Loaded<T>> {
  try {
    const data = await loader();
    await cache.save(key, data);
    return { data };
  } catch (e) {
    if (e instanceof SynqonixError && e.kind === "offline") {
      const hit = cache.load<T>(key);
      if (hit) return { data: hit.data, staleSince: hit.at };
    }
    throw e;
  }
}
