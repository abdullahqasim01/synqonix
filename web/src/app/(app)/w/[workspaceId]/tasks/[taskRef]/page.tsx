"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { TaskDetailView } from "@/components/tasks/task-detail";

export default function TaskPage() {
  const { workspaceId, taskRef } = useParams<{ workspaceId: string; taskRef: string }>();
  const router = useRouter();
  return (
    <div className="grid gap-4">
      <Link href={`/w/${workspaceId}`} className="text-sm text-muted-foreground hover:text-foreground">← Projects</Link>
      <TaskDetailView
        taskRef={decodeURIComponent(taskRef)}
        onNavigate={(key) => router.push(`/w/${workspaceId}/tasks/${key}`)}
        onClose={() => router.push(`/w/${workspaceId}`)}
      />
    </div>
  );
}
