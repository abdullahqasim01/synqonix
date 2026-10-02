import { describe, expect, it } from 'vitest';
import { bucketOf, bucketStarts, isoDay, lastDays, statusAt, weekStart } from './series.js';

const d = (iso: string) => new Date(iso);

describe('day and week buckets', () => {
  it('lists the last days oldest first', () => {
    expect(lastDays(d('2026-03-10T15:00:00Z'), 3).map(isoDay)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
  });
  it('starts weeks on Monday', () => {
    expect(isoDay(weekStart(d('2026-03-11T12:00:00Z').getTime()))).toBe('2026-03-09'); // Wednesday
    expect(isoDay(weekStart(d('2026-03-09T00:00:00Z').getTime()))).toBe('2026-03-09');
    expect(isoDay(weekStart(d('2026-03-15T23:59:00Z').getTime()))).toBe('2026-03-09'); // Sunday
  });
  it('groups days into the weeks they touch', () => {
    expect(bucketStarts(d('2026-03-11T00:00:00Z'), 10, 'week').map(isoDay)).toEqual(['2026-03-02', '2026-03-09']);
    expect(bucketStarts(d('2026-03-11T00:00:00Z'), 3, 'day')).toHaveLength(3);
    expect(isoDay(bucketOf(d('2026-03-11T08:00:00Z').getTime(), 'week'))).toBe('2026-03-09');
    expect(isoDay(bucketOf(d('2026-03-11T08:00:00Z').getTime(), 'day'))).toBe('2026-03-11');
  });
});

describe('status history', () => {
  const task = { createdAt: d('2026-03-01T10:00:00Z'), currentStatus: 'Done' };
  const changes = [
    { at: d('2026-03-03T09:00:00Z'), from: 'To Do', to: 'In Progress' },
    { at: d('2026-03-05T09:00:00Z'), from: 'In Progress', to: 'Done' },
  ];
  it('replays the changes up to a moment', () => {
    expect(statusAt(task, changes, d('2026-02-28T00:00:00Z'))).toBeNull();
    expect(statusAt(task, changes, d('2026-03-02T00:00:00Z'))).toBe('To Do');
    expect(statusAt(task, changes, d('2026-03-03T09:00:00Z'))).toBe('In Progress');
    expect(statusAt(task, changes, d('2026-03-04T00:00:00Z'))).toBe('In Progress');
    expect(statusAt(task, changes, d('2026-04-01T00:00:00Z'))).toBe('Done');
  });
  it('uses the current status when nothing ever changed', () => {
    expect(statusAt({ createdAt: d('2026-03-01T00:00:00Z'), currentStatus: 'To Do' }, [], d('2026-03-02T00:00:00Z'))).toBe('To Do');
  });
});
