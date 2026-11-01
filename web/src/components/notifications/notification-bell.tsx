"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/components/notifications/use-notifications";
import { Button } from "@/components/ui/button";

/** Header bell: unread count and a quick view of the inbox. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const feed = useNotifications({ limit: 10 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" aria-label={feed.unread ? `Notifications, ${feed.unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell aria-hidden className="h-[18px] w-[18px]" />
        {feed.unread > 0 && (
          <span aria-hidden className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">{feed.unread > 99 ? "99+" : feed.unread}</span>
        )}
      </Button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-lg border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-medium">Notifications</h2>
            <div className="flex items-center gap-3 text-xs">
              <button className="text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={feed.unread === 0} onClick={() => void feed.markAllRead()}>Mark all read</button>
              <Link href="/notifications" className="text-primary hover:underline" onClick={() => setOpen(false)}>View all</Link>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <NotificationList items={feed.items} actions={feed} onOpen={() => setOpen(false)} empty="You're all caught up." />
          </div>
        </div>
      )}
    </div>
  );
}
