"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { TaskList } from "@/components/tasks/task-list";

export default function ProjectTasksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <Suspense>
      <TaskList projectId={projectId} />
    </Suspense>
  );
}
