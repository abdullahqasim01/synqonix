import { describe, expect, it } from "vitest";
import { linePath, niceMax, scaleLinear, stepPath, ticks } from "./charts";

describe("chart helpers", () => {
  it("scales linearly", () => {
    const y = scaleLinear([0, 10], [100, 0]);
    expect(y(0)).toBe(100);
    expect(y(10)).toBe(0);
    expect(y(2.5)).toBe(75);
    expect(scaleLinear([5, 5], [0, 10])(5)).toBe(0); // degenerate domain does not divide by zero
  });

  it("rounds axis maxima up to 1, 2, 5 or 10 times a power of ten", () => {
    expect([0, 1, 1.2, 2, 3, 7, 11, 23, 55, 101].map(niceMax)).toEqual([1, 1, 2, 2, 5, 10, 20, 50, 100, 200]);
  });

  it("builds step and line paths", () => {
    const pts = [{ x: 0, y: 10 }, { x: 5, y: 6 }, { x: 8, y: 2 }];
    expect(stepPath(pts)).toBe("M0,10 H5 V6 H8 V2");
    expect(stepPath(pts, 12)).toBe("M0,10 H5 V6 H8 V2 H12");
    expect(stepPath([])).toBe("");
    expect(linePath(pts)).toBe("M0,10 L5,6 L8,2");
  });

  it("produces readable ticks", () => {
    expect(ticks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(ticks(10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(1)).toEqual([0, 1]);
  });
});
