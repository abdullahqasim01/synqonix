"use client";

import Link from "next/link";
import { useState } from "react";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/components/notifications/use-notifications";
import { Alert, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const workspaces = useQuery(() => api.GET("/api/v1/workspaces"), []);
  const feed = useNotifications({ unreadOnly, workspaceId: workspaceId || undefined, limit: 30 });
  const tab = (active: boolean) => `px-3 py-1 text-sm ${active ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <div className="flex items-center gap-3">
          <Select aria-label="Workspace" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">All workspaces</option>
            {workspaces.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" disabled={feed.unread === 0} onClick={() => void feed.markAllRead()}>Mark all read</Button>
          <Link href="/settings/notifications" className="text-sm text-primary hover:underline">Settings</Link>
        </div>
      </div>
      <div className="flex border-b border-border">
        <button className={tab(!unreadOnly)} onClick={() => setUnreadOnly(false)}>All</button>
        <button className={tab(unreadOnly)} onClick={() => setUnreadOnly(true)}>Unread{feed.unread > 0 ? ` (${feed.unread})` : ""}</button>
      </div>
      {feed.error && <Alert>{feed.error}</Alert>}
      <div className="rounded-lg border border-border">
        {feed.loading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : (
          <NotificationList items={feed.items} actions={feed} empty={unreadOnly ? "Nothing unread." : "No notifications yet."} />
        )}
      </div>
      {feed.hasMore && <Button variant="outline" className="mx-auto" onClick={() => void feed.loadMore()}>Load more</Button>}
    </div>
  );
}
