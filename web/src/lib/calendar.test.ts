import { describe, expect, it } from "vitest";
import { addMonths, isoDay, monthGrid } from "./calendar";
import { timelineBar, weekStart } from "./timeline";

describe("monthGrid", () => {
  it("lays out whole Monday-first weeks around the month", () => {
    const weeks = monthGrid(new Date("2026-02-10T00:00:00Z")); // Feb 2026 starts on a Sunday
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].iso).toBe("2026-01-26");
    expect(weeks[0][6].iso).toBe("2026-02-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(28);
    expect(weeks.at(-1)![6].iso).toBe("2026-03-01");
  });

  it("handles six-week months and navigation", () => {
    expect(monthGrid(new Date("2026-03-15T00:00:00Z"))).toHaveLength(6);
    expect(isoDay(addMonths(new Date("2026-01-31T00:00:00Z"), 1))).toBe("2026-02-01");
    expect(isoDay(addMonths(new Date("2026-01-15T00:00:00Z"), -1))).toBe("2025-12-01");
  });
});

describe("timelineBar", () => {
  const start = Date.UTC(2026, 0, 5); // Monday Jan 5
  const days = 28;

  it("positions a task between its start and due date, inclusive", () => {
    const bar = timelineBar({ startDate: "2026-01-12T00:00:00Z", dueDate: "2026-01-14T00:00:00Z" }, start, days)!;
    expect(bar.left).toBeCloseTo((7 / 28) * 100);
    expect(bar.width).toBeCloseTo((3 / 28) * 100);
    expect(bar.clippedStart || bar.clippedEnd).toBe(false);
  });

  it("treats a single date as a one-day bar", () => {
    expect(timelineBar({ startDate: null, dueDate: "2026-01-05T00:00:00Z" }, start, days)!.width).toBeCloseTo(100 / 28);
    expect(timelineBar({ startDate: "2026-01-06T00:00:00Z", dueDate: null }, start, days)!.left).toBeCloseTo(100 / 28);
  });

  it("clips bars that cross the window edges and drops outside ones", () => {
    const wide = timelineBar({ startDate: "2025-12-01T00:00:00Z", dueDate: "2026-03-01T00:00:00Z" }, start, days)!;
    expect(wide).toMatchObject({ left: 0, clippedStart: true, clippedEnd: true });
    expect(wide.width).toBeCloseTo(100);
    expect(timelineBar({ startDate: "2025-12-01T00:00:00Z", dueDate: "2025-12-20T00:00:00Z" }, start, days)).toBeNull();
    expect(timelineBar({ startDate: "2026-03-01T00:00:00Z", dueDate: null }, start, days)).toBeNull();
    expect(timelineBar({ startDate: null, dueDate: null }, start, days)).toBeNull();
  });

  it("tolerates swapped dates", () => {
    const bar = timelineBar({ startDate: "2026-01-14T00:00:00Z", dueDate: "2026-01-12T00:00:00Z" }, start, days)!;
    expect(bar.width).toBeCloseTo((3 / 28) * 100);
  });

  it("finds the Monday of a week", () => {
    expect(new Date(weekStart(new Date("2026-01-11T10:00:00Z"))).toISOString()).toBe("2026-01-05T00:00:00.000Z"); // Sunday
    expect(new Date(weekStart(new Date("2026-01-05T23:59:00Z"))).toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });
});
