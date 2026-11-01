import type { EmailMode, NotificationType } from '../generated/prisma/enums.js';

export const NOTIFICATION_TYPES = [
  'ASSIGNED', 'MENTIONED', 'COMMENTED', 'STATUS_CHANGED', 'DUE_SOON', 'OVERDUE',
  'SPRINT_STARTED', 'SPRINT_COMPLETED', 'PR_OPENED', 'PR_MERGED', 'CI_FAILED', 'CHAT_MENTION',
] as const satisfies readonly NotificationType[];

export interface TypePreference { inApp: boolean; email: boolean }

/** Everything shows up in the inbox; email is reserved for things that ask for your attention. */
export const DEFAULT_TYPE_PREFERENCES: Record<NotificationType, TypePreference> = {
  ASSIGNED: { inApp: true, email: true },
  MENTIONED: { inApp: true, email: true },
  CHAT_MENTION: { inApp: true, email: true },
  DUE_SOON: { inApp: true, email: true },
  OVERDUE: { inApp: true, email: true },
  COMMENTED: { inApp: true, email: false },
  STATUS_CHANGED: { inApp: true, email: false },
  SPRINT_STARTED: { inApp: true, email: false },
  SPRINT_COMPLETED: { inApp: true, email: false },
  PR_OPENED: { inApp: true, email: false },
  PR_MERGED: { inApp: true, email: false },
  CI_FAILED: { inApp: true, email: false },
};

/** Stored overrides on top of the defaults; unknown or malformed entries are ignored. */
export function resolveTypePreferences(stored: unknown): Record<NotificationType, TypePreference> {
  const out = { ...DEFAULT_TYPE_PREFERENCES };
  if (stored && typeof stored === 'object') {
    for (const type of NOTIFICATION_TYPES) {
      const v = (stored as Record<string, { inApp?: unknown; email?: unknown } | undefined>)[type];
      if (v && typeof v === 'object') {
        out[type] = {
          inApp: typeof v.inApp === 'boolean' ? v.inApp : out[type].inApp,
          email: typeof v.email === 'boolean' ? v.email : out[type].email,
        };
      }
    }
  }
  return out;
}

export interface QuietHours {
  enabled: boolean;
  /** Minutes after midnight. */
  start: number;
  end: number;
  timezone: string;
}

export const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Minutes after midnight at `now` in `timezone` (UTC if the zone is unknown). */
export function minutesOfDay(now: Date, timezone: string): number {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Whether emails should be held: inside the window, which may wrap past midnight. Equal bounds mean no window. */
export function isQuietNow(q: QuietHours, now: Date): boolean {
  if (!q.enabled || q.start === q.end) return false;
  const m = minutesOfDay(now, q.timezone);
  return q.start < q.end ? m >= q.start && m < q.end : m >= q.start || m < q.end;
}

export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const DIGEST_INTERVAL_MS = 60 * 60_000;

/** Whether a user's pending emails go out now, given their mode, quiet hours and the last digest. */
export function shouldSendEmailsNow(mode: EmailMode, quiet: QuietHours, lastDigestAt: Date | null, now: Date): boolean {
  if (mode === 'OFF' || isQuietNow(quiet, now)) return false;
  if (mode === 'DIGEST') return !lastDigestAt || now.getTime() - lastDigestAt.getTime() >= DIGEST_INTERVAL_MS;
  return true;
}
