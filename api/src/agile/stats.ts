const DAY = 24 * 60 * 60 * 1000;

/** Percentile (0-100) of an ascending-sorted list using linear interpolation. Null for empty input. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** Average, median and 85th percentile of `values`, rounded to 2 decimals. */
export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: round(values.length ? values.reduce((a, b) => a + b, 0) / values.length : null),
    median: round(percentile(sorted, 50)),
    p85: round(percentile(sorted, 85)),
  };
}

export const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Ideal burndown: a straight line from `committed` on the first day to 0 on the last day (inclusive, UTC days). */
export function idealBurndown(start: Date, end: Date, committed: number): { date: string; remaining: number }[] {
  const first = utcMidnight(start);
  const last = utcMidnight(end);
  const span = Math.max(1, Math.round((last - first) / DAY));
  const points: { date: string; remaining: number }[] = [];
  for (let i = 0; i <= span; i++) {
    points.push({ date: isoDay(new Date(first + i * DAY)), remaining: Math.round(committed * (1 - i / span) * 100) / 100 });
  }
  return points;
}

/** Monday (UTC) of the week containing `d`, as `YYYY-MM-DD`. */
export function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return isoDay(new Date(utcMidnight(d) - day * DAY));
}

/** Completion counts per week for the weeks overlapping the last `days` days, oldest first, zeros included. */
export function weeklyThroughput(completed: Date[], now: Date, days: number): { weekStart: string; count: number }[] {
  const firstWeek = new Date(weekStart(new Date(now.getTime() - days * DAY)) + 'T00:00:00Z').getTime();
  const lastWeek = new Date(weekStart(now) + 'T00:00:00Z').getTime();
  const counts = new Map<string, number>();
  for (const d of completed) counts.set(weekStart(d), (counts.get(weekStart(d)) ?? 0) + 1);
  const out: { weekStart: string; count: number }[] = [];
  for (let t = firstWeek; t <= lastWeek; t += 7 * DAY) {
    const key = isoDay(new Date(t));
    out.push({ weekStart: key, count: counts.get(key) ?? 0 });
  }
  return out;
}
