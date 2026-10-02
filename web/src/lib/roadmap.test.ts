import { describe, expect, it } from "vitest";
import { roadmapLayout } from "./roadmap";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

describe("roadmap layout", () => {
  it("spans whole months and positions bars proportionally", () => {
    const layout = roadmapLayout([{ id: "a", label: "A", start: d("2026-03-10"), end: d("2026-03-20") }], d("2026-03-15"));
    expect(layout.start).toBe(d("2026-03-01"));
    expect(layout.end).toBe(d("2026-04-01"));
    expect(layout.months).toHaveLength(1);
    const bar = layout.bars[0];
    expect(bar.left).toBeCloseTo((9 / 31) * 100, 1);
    expect(bar.width).toBeCloseTo((10 / 31) * 100, 1);
    expect(layout.today).toBeCloseTo((14 / 31) * 100, 1);
  });

  it("widens the range for other dates and several months", () => {
    const layout = roadmapLayout([{ id: "a", label: "A", start: d("2026-01-15"), end: d("2026-02-10") }], d("2026-02-01"), [d("2026-05-02")]);
    expect(layout.months.map((m) => m.left).every((x, i, all) => i === 0 || x > all[i - 1])).toBe(true);
    expect(layout.months).toHaveLength(5); // Jan to May
    expect(layout.at(d("2026-05-02"))).toBeLessThan(100);
  });

  it("gives half-dated items a two-week bar and lists undated ones separately", () => {
    const layout = roadmapLayout([
      { id: "due", label: "Only due", start: null, end: d("2026-03-29") },
      { id: "start", label: "Only start", start: d("2026-03-02"), end: null },
      { id: "none", label: "No dates", start: null, end: null },
    ], d("2026-03-05"));
    expect(layout.bars.map((b) => b.id)).toEqual(["due", "start"]);
    expect(layout.unscheduled.map((i) => i.id)).toEqual(["none"]);
    const one = layout.bars.find((b) => b.id === "start")!;
    expect(one.width).toBeCloseTo((14 / 31) * 100, 1);
  });

  it("keeps the axis valid with nothing scheduled and hides today when out of range", () => {
    const layout = roadmapLayout([], d("2026-03-05"));
    expect(layout.bars).toEqual([]);
    expect(layout.today).not.toBeNull();
    const far = roadmapLayout([{ id: "a", label: "A", start: d("2020-01-01"), end: d("2020-01-31") }], d("2026-03-05"));
    expect(far.today).not.toBeNull(); // today widens the range so it is always visible
  });
});
