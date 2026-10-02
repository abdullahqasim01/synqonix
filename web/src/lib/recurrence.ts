/** "Every day", "Every 2 weeks", "Every month". */
export function describeRecurrence(frequency: "DAILY" | "WEEKLY" | "MONTHLY", interval: number): string {
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" }[frequency];
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** Value for a `datetime-local` input: local time as `YYYY-MM-DDTHH:MM`. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
