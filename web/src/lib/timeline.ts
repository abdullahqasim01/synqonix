const DAY = 24 * 60 * 60 * 1000;

export interface Bar {
  /** Percent of the window width. */
  left: number;
  width: number;
  /** The task starts before / ends after the visible window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

const midnight = (iso: string) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * Bar for a task over a window of `days` days starting at `windowStart` (UTC midnight, ms).
 * A task runs from its start date to its due date (inclusive); with only one of them it is a single day.
 * Returns null when the task has no dates or lies completely outside the window.
 */
export function timelineBar(
  task: { startDate: string | null; dueDate: string | null },
  windowStart: number,
  days: number,
): Bar | null {
  const rawStart = task.startDate ? midnight(task.startDate) : task.dueDate ? midnight(task.dueDate) : null;
  const rawEnd = task.dueDate ? midnight(task.dueDate) : task.startDate ? midnight(task.startDate) : null;
  if (rawStart === null || rawEnd === null) return null;
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd) + DAY; // exclusive
  const windowEnd = windowStart + days * DAY;
  if (end <= windowStart || start >= windowEnd) return null;
  const from = Math.max(start, windowStart);
  const to = Math.min(end, windowEnd);
  return {
    left: ((from - windowStart) / (days * DAY)) * 100,
    width: ((to - from) / (days * DAY)) * 100,
    clippedStart: start < windowStart,
    clippedEnd: end > windowEnd,
  };
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): number {
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}
