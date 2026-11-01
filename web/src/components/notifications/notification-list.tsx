"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Notification } from "@/components/notifications/use-notifications";
import { snoozeOptions, timeAgo, TYPE_INFO, type NotificationType } from "@/lib/notifications";
import { cn } from "@/lib/utils";

interface Actions {
  markRead(id: string, read: boolean): Promise<void>;
  snooze(id: string, until: Date): Promise<void>;
  dismiss(id: string): Promise<void>;
}

/** Re-renders every minute so "5m" labels stay honest without calling Date.now() while rendering. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Row({ n, actions, onOpen, now }: { n: Notification; actions: Actions; onOpen?: () => void; now: number }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const info = TYPE_INFO[n.type as NotificationType];
  const btn = "rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";

  async function open() {
    if (!n.read) await actions.markRead(n.id, true);
    onOpen?.();
    router.push(n.url);
  }

  return (
    <li className={cn("group relative flex gap-3 px-3 py-2", !n.read && "bg-primary/5")} data-unread={!n.read}>
      <span aria-hidden className="mt-0.5 w-5 shrink-0 text-center text-sm">{info?.icon ?? "•"}</span>
      <button className="min-w-0 flex-1 text-left" onClick={() => void open()}>
        <span className={cn("block truncate text-sm", !n.read && "font-medium")}>{n.title}</span>
        {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
      </button>
      <span className="shrink-0 pt-0.5 text-xs text-muted-foreground group-hover:hidden group-focus-within:hidden">{timeAgo(n.surfacedAt, now)}</span>
      <span className="relative hidden shrink-0 items-start gap-0.5 group-focus-within:flex group-hover:flex">
        <button className={btn} aria-label={n.read ? "Mark as unread" : "Mark as read"} onClick={() => void actions.markRead(n.id, !n.read)}>{n.read ? "●" : "✓"}</button>
        <button className={btn} aria-label="Snooze" onClick={() => setMenu((m) => !m)}>⏰</button>
        <button className={btn} aria-label="Dismiss" onClick={() => void actions.dismiss(n.id)}>×</button>
        {menu && (
          <span role="menu" aria-label="Snooze until" className="absolute right-0 top-full z-20 mt-1 grid w-44 rounded-md border border-border bg-background p-1 shadow-lg">
            {snoozeOptions(new Date(now)).map((o) => (
              <button key={o.label} role="menuitem" className="rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => { setMenu(false); void actions.snooze(n.id, o.until); }}>{o.label}</button>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

export function NotificationList({ items, actions, onOpen, empty }: { items: Notification[]; actions: Actions; onOpen?: () => void; empty: string }) {
  const now = useNow();
  if (items.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul aria-label="Notifications" className="divide-y divide-border">
      {items.map((n) => <Row key={n.id} n={n} actions={actions} onOpen={onOpen} now={now} />)}
    </ul>
  );
}
