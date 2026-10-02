"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ChannelSidebar } from "@/components/chat/channel-sidebar";
import { ChannelView } from "@/components/chat/channel-view";
import { useChat } from "@/components/chat/chat-provider";
import { Alert } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useQuery } from "@/lib/use-query";

function Chat() {
  const { workspace } = useWorkspace();
  const { channels, loading } = useChat();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/w/${workspace.id}/chat`;
  const wanted = params.get("c");
  const fromList = channels.find((c) => c.id === wanted);
  // A channel we can see but that is not in the list yet (just created, or archived).
  const direct = useQuery(
    () => (wanted && !fromList && !loading
      ? api.GET("/api/v1/workspaces/{workspaceId}/channels/{channelId}", { params: { path: { workspaceId: workspace.id, channelId: wanted } } })
      : Promise.resolve({ data: undefined })),
    [wanted, fromList?.id, loading],
  );
  const active = fromList ?? (wanted ? direct.data : undefined) ?? (!wanted ? channels.find((c) => c.isMember) ?? channels[0] : undefined);

  return (
    <div className="grid h-[calc(100vh-11rem)] min-h-96 grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
      <aside className="overflow-y-auto"><ChannelSidebar activeId={active?.id ?? null} base={base} /></aside>
      <div className="min-h-0 rounded-lg border border-border">
        {active ? (
          <ChannelView key={active.id} channel={active} onGone={() => router.replace(base)} />
        ) : wanted && direct.error ? (
          <div className="p-4"><Alert>{direct.error}</Alert></div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">{loading ? "Loading…" : "No channels yet. Create one with the + next to Channels."}</p>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return <Suspense><Chat /></Suspense>;
}
