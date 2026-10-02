"use client";

import { Suspense } from "react";
import { ProjectViews } from "@/components/views/project-views";

export default function ProjectTasksPage() {
  return (
    <Suspense>
      <ProjectViews />
    </Suspense>
  );
}
