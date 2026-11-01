"use client";

import { Suspense } from "react";
import { BacklogView } from "@/components/agile/backlog-view";
import { useProject } from "@/components/workspace/project-context";

export default function BacklogPage() {
  const { project } = useProject();
  if (project.methodology !== "SCRUM") {
    return <p className="text-sm text-muted-foreground">This project uses Kanban, so there are no sprints. Switch to Scrum in the project settings to plan sprints.</p>;
  }
  return (
    <Suspense>
      <BacklogView />
    </Suspense>
  );
}
