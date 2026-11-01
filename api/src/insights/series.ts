const DAY = 86_400_000;

export const utcDayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The `days` UTC days ending with the day of `end`, oldest first, as start-of-day timestamps. */
export function lastDays(end: Date, days: number): number[] {
  const last = utcDayStart(end);
  return Array.from({ length: days }, (_, i) => last - (days - 1 - i) * DAY);
}

/** Start of the Monday (UTC) of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(utcDayStart(new Date(ms)));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return d.getTime() - sinceMonday * DAY;
}

/** Bucket starts covering the last `days` days: every day, or every week (Mondays) that overlaps. */
export function bucketStarts(end: Date, days: number, bucket: 'day' | 'week'): number[] {
  const all = lastDays(end, days);
  if (bucket === 'day') return all;
  return [...new Set(all.map(weekStart))];
}

/** The start of the bucket `ms` falls into. */
export const bucketOf = (ms: number, bucket: 'day' | 'week') => (bucket === 'day' ? utcDayStart(new Date(ms)) : weekStart(ms));

export interface StatusChange { at: Date; from: string | null; to: string }

/**
 * Which status a task was in at `at`, from its history of changes (oldest first). Before the
 * first recorded change it was in that change's `from` status; with no changes, its current one.
 * Null when the task did not exist yet.
 */
export function statusAt(task: { createdAt: Date; currentStatus: string }, changes: StatusChange[], at: Date): string | null {
  if (task.createdAt.getTime() > at.getTime()) return null;
  let status = changes[0]?.from ?? task.currentStatus;
  for (const c of changes) {
    if (c.at.getTime() > at.getTime()) break;
    status = c.to;
  }
  return status;
}
