const DAY = 24 * 60 * 60 * 1000;

export interface Day { date: Date; iso: string; inMonth: boolean }

/** `YYYY-MM-DD` of a date in UTC (due dates are stored as UTC midnights). */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Weeks (Monday first) covering the month that contains `anchor`. */
export function monthGrid(anchor: Date): Day[][] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getTime() - offset * DAY);
  const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  const weeks = Math.ceil((offset + last.getUTCDate()) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY);
      return { date, iso: isoDay(date), inMonth: date.getUTCMonth() === first.getUTCMonth() };
    }),
  );
}

export const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
