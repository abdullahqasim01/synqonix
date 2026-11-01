type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const DAY = 86_400_000;

/** `date` plus `months` calendar months, keeping the time of day and clamping the day to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
}

/**
 * The first occurrence of "every `interval` days/weeks/months starting at `startsAt`" that is strictly
 * after `after`. Months are counted from the original start so a 31st does not drift to the 28th for good.
 */
export function nextRunAfter(rule: { frequency: Frequency; interval: number; startsAt: Date }, after: Date): Date {
  const start = rule.startsAt;
  if (after.getTime() < start.getTime()) return start;
  if (rule.frequency !== 'MONTHLY') {
    const step = rule.interval * (rule.frequency === 'WEEKLY' ? 7 : 1) * DAY;
    const k = Math.floor((after.getTime() - start.getTime()) / step) + 1;
    return new Date(start.getTime() + k * step);
  }
  for (let k = 1; k < 2400; k++) {
    const candidate = addMonthsClamped(start, k * rule.interval);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('No next occurrence');
}

/** Fills `{date}` in a title with the run's date, so a recurring "Report {date}" makes distinct tasks. */
export const renderTitle = (title: string, at: Date) => title.replace(/\{date\}/gi, at.toISOString().slice(0, 10));
