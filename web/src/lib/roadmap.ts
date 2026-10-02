const DAY = 86_400_000;

export interface RoadmapItem { id: string; label: string; start: number | null; end: number | null }

export interface RoadmapBar { id: string; label: string; left: number; width: number }

export interface RoadmapLayout {
  start: number;
  end: number;
  /** Month boundaries inside the range, as percentages of the width. */
  months: { label: string; left: number }[];
  bars: RoadmapBar[];
  unscheduled: RoadmapItem[];
  /** Where "today" falls (0-100), or null when outside the range. */
  today: number | null;
  /** Position (0-100) of a single date. */
  at(ms: number): number;
}

const monthStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const nextMonth = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

/**
 * Lays dated items out on a shared time axis. Items with only one date get a two-week bar;
 * items with none are listed as unscheduled. `extra` dates (milestones, today) widen the range.
 */
export function roadmapLayout(items: RoadmapItem[], now: number, extra: number[] = []): RoadmapLayout {
  const scheduled = items
    .filter((i) => i.start !== null || i.end !== null)
    .map((i) => {
      const start = i.start ?? (i.end as number) - 14 * DAY;
      const end = Math.max(i.end ?? start + 14 * DAY, start + DAY);
      return { ...i, start, end };
    });
  const dates = [...scheduled.flatMap((i) => [i.start, i.end]), ...extra, now];
  const start = monthStart(Math.min(...dates));
  const end = nextMonth(Math.max(...dates));
  const span = end - start;
  const at = (ms: number) => ((ms - start) / span) * 100;

  const months: RoadmapLayout["months"] = [];
  for (let m = start; m < end; m = nextMonth(m)) {
    months.push({ label: new Date(m).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }), left: at(m) });
  }
  return {
    start, end, months, at,
    bars: scheduled.map((i) => ({ id: i.id, label: i.label, left: at(i.start), width: Math.max(0.5, at(i.end) - at(i.start)) })),
    unscheduled: items.filter((i) => i.start === null && i.end === null),
    today: now >= start && now <= end ? at(now) : null,
  };
}
