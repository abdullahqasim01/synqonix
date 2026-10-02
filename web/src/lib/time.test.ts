import { describe, expect, it } from "vitest";
import { formatClock, formatMinutes, parseDuration } from "./time";

describe("durations", () => {
  it("formats minutes compactly", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(-5)).toBe("0m");
  });
  it("reads what people type", () => {
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1h30m")).toBe(90);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration(" 15 min ")).toBe(15);
    for (const bad of ["", "abc", "0", "0h", "h", "-5", "1x"]) expect(parseDuration(bad)).toBeNull();
  });
  it("formats a running clock", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(1503)).toBe("00:25:03");
    expect(formatClock(3661)).toBe("01:01:01");
  });
});
