import type { Schemas } from "./api";

export type Notification = Schemas["NotificationDto"];

/** Kinds worth interrupting someone for; everything else stays in the inbox. */
export const DEFAULT_TOAST_TYPES: Notification["type"][] = ["ASSIGNED", "MENTIONED", "CHAT_MENTION", "OVERDUE", "DUE_SOON"];

/**
 * From an inbox page (newest first), the unread notifications that appeared after `lastSeen`
 * (an ISO timestamp), and the new high-water mark.
 */
export function pickNew(items: Notification[], lastSeen: string | undefined): { fresh: Notification[]; newest: string | undefined } {
  const newest = items.reduce<string | undefined>((m, n) => (!m || n.surfacedAt > m ? n.surfacedAt : m), lastSeen);
  const fresh = lastSeen === undefined ? [] : items.filter((n) => !n.read && n.surfacedAt > lastSeen);
  return { fresh, newest };
}

export interface PollerDeps {
  fetch(): Promise<Notification[]>;
  getLastSeen(): string | undefined;
  setLastSeen(value: string): void | Promise<void>;
  onNew(fresh: Notification[]): void;
  onError?(e: unknown): void;
  intervalMs: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Polls the inbox. The first poll only records where things stand, so installing the extension
 * does not flood the editor with old notifications; later polls announce what is new.
 */
export class NotificationPoller {
  private handle: unknown;
  private running = false;

  constructor(private readonly d: PollerDeps) {}

  async pollOnce(): Promise<Notification[]> {
    try {
      const items = await this.d.fetch();
      const { fresh, newest } = pickNew(items, this.d.getLastSeen());
      if (newest && newest !== this.d.getLastSeen()) await this.d.setLastSeen(newest);
      if (fresh.length > 0) this.d.onNew(fresh);
      return fresh;
    } catch (e) {
      this.d.onError?.(e);
      return [];
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const schedule = this.d.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    const tick = async () => {
      if (!this.running) return;
      await this.pollOnce();
      if (this.running) this.handle = schedule(() => void tick(), this.d.intervalMs);
    };
    void tick();
  }

  stop() {
    this.running = false;
    (this.d.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.handle);
  }
}
