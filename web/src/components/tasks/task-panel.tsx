"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { TaskDetailView } from "@/components/tasks/task-detail";

/** `?task=KEY` in the URL controls the side panel, so panels are linkable and survive reloads. Needs <Suspense>. */
export function useTaskPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRef = params.get("task");

  const open = useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (key) next.set("task", key);
      else next.delete("task");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (e.key === "Escape" && openRef && !typing) open(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openRef, open]);

  return { openRef, open };
}

export function TaskPanel({ taskRef, onClose, onChanged, onNavigate }: {
  taskRef: string | null;
  onClose: () => void;
  onChanged?: () => void;
  onNavigate: (key: string) => void;
}) {
  if (!taskRef) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Task details" className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl overflow-y-auto border-l border-border bg-background shadow-xl">
        <TaskDetailView panel taskRef={taskRef} onClose={onClose} onChanged={onChanged} onNavigate={onNavigate} />
      </aside>
    </>
  );
}
