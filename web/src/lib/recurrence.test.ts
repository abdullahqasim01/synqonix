import { describe, expect, it } from "vitest";
import { describeRecurrence, toLocalInput } from "./recurrence";

describe("recurrence labels", () => {
  it("reads naturally", () => {
    expect(describeRecurrence("DAILY", 1)).toBe("Every day");
    expect(describeRecurrence("WEEKLY", 2)).toBe("Every 2 weeks");
    expect(describeRecurrence("MONTHLY", 1)).toBe("Every month");
  });
  it("formats a local date-time for inputs", () => {
    expect(toLocalInput(new Date(2026, 2, 5, 9, 7))).toBe("2026-03-05T09:07");
  });
});
