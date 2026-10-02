import { describe, expect, it } from 'vitest';
import { addMonthsClamped, nextRunAfter, renderTitle } from './recurrence.js';

const d = (iso: string) => new Date(iso);

describe('recurrence', () => {
  it('repeats daily and weekly from the start', () => {
    const daily = { frequency: 'DAILY' as const, interval: 1, startsAt: d('2026-03-01T09:00:00Z') };
    expect(nextRunAfter(daily, d('2026-02-01T00:00:00Z')).toISOString()).toBe('2026-03-01T09:00:00.000Z');
    expect(nextRunAfter(daily, d('2026-03-01T09:00:00Z')).toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(nextRunAfter(daily, d('2026-03-05T12:00:00Z')).toISOString()).toBe('2026-03-06T09:00:00.000Z');
    const biweekly = { frequency: 'WEEKLY' as const, interval: 2, startsAt: d('2026-03-02T08:00:00Z') };
    expect(nextRunAfter(biweekly, d('2026-03-02T08:00:00Z')).toISOString()).toBe('2026-03-16T08:00:00.000Z');
    expect(nextRunAfter(biweekly, d('2026-03-20T00:00:00Z')).toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('skips missed runs instead of replaying them', () => {
    const rule = { frequency: 'DAILY' as const, interval: 1, startsAt: d('2026-01-01T09:00:00Z') };
    expect(nextRunAfter(rule, d('2026-06-10T10:00:00Z')).toISOString()).toBe('2026-06-11T09:00:00.000Z');
  });

  it('clamps month ends without drifting', () => {
    expect(addMonthsClamped(d('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsClamped(d('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonthsClamped(d('2026-11-30T10:00:00Z'), 3).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    const monthly = { frequency: 'MONTHLY' as const, interval: 1, startsAt: d('2026-01-31T10:00:00Z') };
    expect(nextRunAfter(monthly, d('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(nextRunAfter(monthly, d('2026-02-28T10:00:00Z')).toISOString()).toBe('2026-03-31T10:00:00.000Z');
    const quarterly = { frequency: 'MONTHLY' as const, interval: 3, startsAt: d('2026-01-15T10:00:00Z') };
    expect(nextRunAfter(quarterly, d('2026-01-16T00:00:00Z')).toISOString()).toBe('2026-04-15T10:00:00.000Z');
  });

  it('puts the date in titles', () => {
    expect(renderTitle('Weekly report {date}', d('2026-03-09T09:00:00Z'))).toBe('Weekly report 2026-03-09');
    expect(renderTitle('No placeholder', d('2026-03-09T09:00:00Z'))).toBe('No placeholder');
  });
});
