import { describe, expect, it } from "vitest";
import { snoozeOptions, timeAgo, TYPE_INFO } from "./notifications";

describe("timeAgo", () => {
  const now = new Date("2026-03-10T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("is compact and never negative", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3h");
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe("2d");
    expect(timeAgo(new Date(now + 5000).toISOString(), now)).toBe("just now");
    expect(timeAgo(ago(30 * 86_400_000), now)).toMatch(/\d/);
  });
});

describe("snoozeOptions", () => {
  it("offers future times, mornings at 9 and a Monday", () => {
    const now = new Date(2026, 2, 11, 15, 30); // a Wednesday
    const [hour, three, tomorrow, monday] = snoozeOptions(now);
    expect(hour.until.getTime() - now.getTime()).toBe(3_600_000);
    expect(three.until.getTime() - now.getTime()).toBe(3 * 3_600_000);
    expect(tomorrow.until.getDate()).toBe(12);
    expect(tomorrow.until.getHours()).toBe(9);
    expect(monday.until.getDay()).toBe(1);
    expect(monday.until.getDate()).toBe(16);
    for (const o of [hour, three, tomorrow, monday]) expect(o.until.getTime()).toBeGreaterThan(now.getTime());
  });
  it("picks the following Monday when today is Monday", () => {
    const monday = new Date(2026, 2, 9, 10, 0);
    expect(snoozeOptions(monday)[3].until.getDate()).toBe(16);
  });
});

it("describes every notification type", () => {
  expect(Object.keys(TYPE_INFO)).toHaveLength(12);
});
