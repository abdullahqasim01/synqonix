"use client";

import { Suspense } from "react";
import { TaskList } from "@/components/tasks/task-list";

export default function MyTasksPage() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
      <Suspense>
        <TaskList mine />
      </Suspense>
    </div>
  );
}
