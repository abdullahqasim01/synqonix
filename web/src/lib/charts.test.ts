import { describe, expect, it } from "vitest";
import { bandPath, labelIndexes, linePath, niceMax, scaleLinear, stackBands, stepPath, ticks } from "./charts";

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

describe("stacked areas", () => {
  it("stacks values and ignores negatives", () => {
    expect(stackBands([[1, 2, 3], [0, 4, -1]])).toEqual([
      [{ lower: 0, upper: 1 }, { lower: 1, upper: 3 }, { lower: 3, upper: 6 }],
      [{ lower: 0, upper: 0 }, { lower: 0, upper: 4 }, { lower: 4, upper: 4 }],
    ]);
  });
  it("draws a closed band", () => {
    expect(bandPath([0, 10], [5, 6], [1, 2])).toBe("M0,5 L10,6 L10,2 L0,1 Z");
    expect(bandPath([], [], [])).toBe("");
  });
  it("picks a readable subset of labels", () => {
    expect([...labelIndexes(5)]).toEqual([0, 1, 2, 3, 4]);
    const many = labelIndexes(30, 8);
    expect(many.size).toBeLessThanOrEqual(9);
    expect(many.has(0) && many.has(29)).toBe(true);
  });
});
