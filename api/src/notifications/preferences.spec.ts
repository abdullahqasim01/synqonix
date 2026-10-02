import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TYPE_PREFERENCES, formatClock, isQuietNow, minutesOfDay, parseClock, resolveTypePreferences, shouldSendEmailsNow,
} from './preferences.js';

const at = (iso: string) => new Date(iso);
const quiet = (over: Partial<{ enabled: boolean; start: number; end: number; timezone: string }> = {}) => ({ enabled: true, start: 22 * 60, end: 8 * 60, timezone: 'UTC', ...over });

describe('type preferences', () => {
  it('falls back to the defaults and ignores junk', () => {
    expect(resolveTypePreferences({})).toEqual(DEFAULT_TYPE_PREFERENCES);
    expect(resolveTypePreferences(null)).toEqual(DEFAULT_TYPE_PREFERENCES);
    const r = resolveTypePreferences({ ASSIGNED: { email: false }, COMMENTED: { inApp: false, email: true }, BOGUS: { inApp: false }, MENTIONED: 'x' });
    expect(r.ASSIGNED).toEqual({ inApp: true, email: false });
    expect(r.COMMENTED).toEqual({ inApp: false, email: true });
    expect(r.MENTIONED).toEqual(DEFAULT_TYPE_PREFERENCES.MENTIONED);
  });
});

describe('quiet hours', () => {
  it('handles windows that wrap past midnight', () => {
    expect(isQuietNow(quiet(), at('2026-01-01T23:00:00Z'))).toBe(true);
    expect(isQuietNow(quiet(), at('2026-01-01T03:00:00Z'))).toBe(true);
    expect(isQuietNow(quiet(), at('2026-01-01T08:00:00Z'))).toBe(false);
    expect(isQuietNow(quiet(), at('2026-01-01T12:00:00Z'))).toBe(false);
  });
  it('handles same-day windows, disabled and empty windows', () => {
    expect(isQuietNow(quiet({ start: 12 * 60, end: 13 * 60 }), at('2026-01-01T12:30:00Z'))).toBe(true);
    expect(isQuietNow(quiet({ start: 12 * 60, end: 13 * 60 }), at('2026-01-01T13:00:00Z'))).toBe(false);
    expect(isQuietNow(quiet({ enabled: false }), at('2026-01-01T23:00:00Z'))).toBe(false);
    expect(isQuietNow(quiet({ start: 600, end: 600 }), at('2026-01-01T10:00:00Z'))).toBe(false);
  });
  it('uses the user\'s time zone', () => {
    // 23:00 UTC is 08:00 next day in Tokyo, which is outside 22:00-08:00
    expect(minutesOfDay(at('2026-01-01T23:00:00Z'), 'Asia/Tokyo')).toBe(8 * 60);
    expect(isQuietNow(quiet({ timezone: 'Asia/Tokyo' }), at('2026-01-01T23:00:00Z'))).toBe(false);
    expect(isQuietNow(quiet({ timezone: 'America/New_York' }), at('2026-01-02T03:30:00Z'))).toBe(true); // 22:30 in New York
    expect(minutesOfDay(at('2026-01-01T10:15:00Z'), 'Not/AZone')).toBe(10 * 60 + 15);
  });
  it('parses and prints clock times', () => {
    expect(parseClock('08:30')).toBe(510);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('8:30')).toBeNull();
    expect(formatClock(1320)).toBe('22:00');
  });
});

describe('when emails go out', () => {
  const now = at('2026-01-01T12:00:00Z');
  it('sends instantly outside quiet hours, never when off', () => {
    expect(shouldSendEmailsNow('INSTANT', quiet({ enabled: false }), null, now)).toBe(true);
    expect(shouldSendEmailsNow('OFF', quiet({ enabled: false }), null, now)).toBe(false);
    expect(shouldSendEmailsNow('INSTANT', quiet(), null, at('2026-01-01T23:00:00Z'))).toBe(false);
  });
  it('batches digests to one per hour', () => {
    const q = quiet({ enabled: false });
    expect(shouldSendEmailsNow('DIGEST', q, null, now)).toBe(true);
    expect(shouldSendEmailsNow('DIGEST', q, at('2026-01-01T11:30:00Z'), now)).toBe(false);
    expect(shouldSendEmailsNow('DIGEST', q, at('2026-01-01T11:00:00Z'), now)).toBe(true);
  });
});
