"use client";

import { useEffect, useRef } from "react";
import { subscribeToProject, type TaskEvent } from "@/lib/realtime";

/**
 * Calls `onChange` (debounced) whenever someone changes a task of the project. Used to refetch.
 */
export function useProjectEvents(projectId: string | undefined, onChange: (e: TaskEvent) => void, delay = 200) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: TaskEvent | undefined;
    const off = subscribeToProject(projectId, (e) => {
      last = e;
      clearTimeout(timer);
      timer = setTimeout(() => last && cb.current(last), delay);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [projectId, delay]);
}
