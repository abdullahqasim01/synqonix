import { describe, expect, it } from 'vitest';
import { idealBurndown, percentile, summarize, weekStart, weeklyThroughput } from './stats.js';

describe('percentile & summarize', () => {
  it('interpolates between ranks', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([4], 85)).toBe(4);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 85)).toBeCloseTo(4.4);
  });

  it('summarises a list, tolerating empty input', () => {
    expect(summarize([3, 1, 2, 10])).toEqual({ avg: 4, median: 2.5, p85: 6.85 });
    expect(summarize([])).toEqual({ avg: null, median: null, p85: null });
  });
});

describe('idealBurndown', () => {
  it('falls linearly from the committed scope to zero', () => {
    const line = idealBurndown(new Date('2026-03-02T09:00:00Z'), new Date('2026-03-06T17:00:00Z'), 20);
    expect(line.map((p) => p.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
    expect(line.map((p) => p.remaining)).toEqual([20, 15, 10, 5, 0]);
  });

  it('handles one-day sprints and empty scope', () => {
    expect(idealBurndown(new Date('2026-03-02T00:00:00Z'), new Date('2026-03-02T12:00:00Z'), 8).map((p) => p.remaining)).toEqual([8, 0]);
    expect(idealBurndown(new Date('2026-03-02T00:00:00Z'), new Date('2026-03-04T00:00:00Z'), 0).every((p) => p.remaining === 0)).toBe(true);
  });
});

describe('weekly throughput', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart(new Date('2026-03-08T10:00:00Z'))).toBe('2026-03-02'); // Sunday
    expect(weekStart(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03-02');
  });

  it('counts per week and fills empty weeks', () => {
    const now = new Date('2026-03-18T12:00:00Z'); // Wednesday
    const rows = weeklyThroughput(
      [new Date('2026-03-03T10:00:00Z'), new Date('2026-03-04T10:00:00Z'), new Date('2026-03-17T10:00:00Z')], now, 21,
    );
    expect(rows).toEqual([
      { weekStart: '2026-02-23', count: 0 },
      { weekStart: '2026-03-02', count: 2 },
      { weekStart: '2026-03-09', count: 0 },
      { weekStart: '2026-03-16', count: 1 },
    ]);
  });
});
