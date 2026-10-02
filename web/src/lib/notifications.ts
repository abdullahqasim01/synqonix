export type NotificationType =
  | "ASSIGNED" | "MENTIONED" | "COMMENTED" | "STATUS_CHANGED" | "DUE_SOON" | "OVERDUE"
  | "SPRINT_STARTED" | "SPRINT_COMPLETED" | "PR_OPENED" | "PR_MERGED" | "CI_FAILED" | "CHAT_MENTION";

export const TYPE_INFO: Record<NotificationType, { label: string; icon: string; hint: string }> = {
  ASSIGNED: { label: "Assigned to you", icon: "👤", hint: "A task is assigned to you" },
  MENTIONED: { label: "Mentions in tasks", icon: "@", hint: "Someone mentions you in a task or comment" },
  CHAT_MENTION: { label: "Mentions in chat", icon: "#", hint: "Someone mentions you in a channel or direct message" },
  COMMENTED: { label: "Comments", icon: "💬", hint: "New comments on tasks you watch" },
  STATUS_CHANGED: { label: "Status changes", icon: "↔", hint: "A task you watch moves to another status" },
  DUE_SOON: { label: "Due soon", icon: "⏰", hint: "A task assigned to you is due within a day" },
  OVERDUE: { label: "Overdue", icon: "⚠", hint: "A task assigned to you is overdue" },
  SPRINT_STARTED: { label: "Sprint started", icon: "🏁", hint: "A sprint you work in starts" },
  SPRINT_COMPLETED: { label: "Sprint completed", icon: "🏁", hint: "A sprint you worked in is completed" },
  PR_OPENED: { label: "Pull requests opened", icon: "⎇", hint: "A pull request is opened for a task you watch" },
  PR_MERGED: { label: "Pull requests merged", icon: "⎇", hint: "A pull request is merged for a task you watch" },
  CI_FAILED: { label: "Failing checks", icon: "✗", hint: "Checks fail on a pull request for a task you watch" },
};

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString();
}

/** Choices for "remind me": in an hour or three, tomorrow morning, and next Monday. */
export function snoozeOptions(now: Date): { label: string; until: Date }[] {
  const at9 = (d: Date) => { const x = new Date(d); x.setHours(9, 0, 0, 0); return x; };
  const tomorrow = at9(new Date(now.getTime() + 86_400_000));
  const monday = at9(new Date(now.getTime() + ((8 - now.getDay()) % 7 || 7) * 86_400_000));
  return [
    { label: "In 1 hour", until: new Date(now.getTime() + 3_600_000) },
    { label: "In 3 hours", until: new Date(now.getTime() + 3 * 3_600_000) },
    { label: "Tomorrow morning", until: tomorrow },
    { label: "Next Monday", until: monday },
  ];
}
