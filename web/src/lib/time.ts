/** `90` → "1h 30m", `45` → "45m", `0` → "0m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/**
 * Reads "1h 30m", "90m", "1.5h", "2h" or a bare number of minutes ("45") as minutes.
 * Null when it cannot be understood or is not positive.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) || null;
  const decimalHours = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/.exec(text);
  if (decimalHours) return Math.round(Number(decimalHours[1]) * 60) || null;
  const match = /^(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) || null;
}

/** "00:25:03" style clock for a running timer. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
