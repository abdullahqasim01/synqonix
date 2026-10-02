import { expect, it } from "vitest";
import { describeActivity, formatDate, isOverdue, mentionMarkdown, toDateInput } from "./tasks";

const names = (id: string) => ({ u1: "Ann", u2: "Bob" })[id as "u1" | "u2"] ?? id;
const act = (over: Record<string, unknown>) => ({ id: "1", actorId: "u1", type: "updated", field: null, from: null, to: null, createdAt: "", ...over }) as never;

it("describes activity rows", () => {
  expect(describeActivity(act({ type: "created" }), names)).toBe("created this task");
  expect(describeActivity(act({ field: "status", from: "To Do", to: "Done" }), names)).toBe("changed status from To Do to Done");
  expect(describeActivity(act({ field: "assignees", from: [], to: ["u1", "u2"] }), names)).toBe("changed assignees from none to Ann, Bob");
  expect(describeActivity(act({ field: "custom:Env", from: null, to: "prod" }), names)).toBe("changed Env from none to prod");
  expect(describeActivity(act({ type: "moved", from: "SYN-1", to: "OPS-2" }), names)).toBe("moved this task from SYN-1 to OPS-2");
});

it("formats dates and overdue state", () => {
  expect(toDateInput("2026-03-01T00:00:00.000Z")).toBe("2026-03-01");
  expect(formatDate("2026-03-01T00:00:00.000Z")).toContain("2026");
  expect(isOverdue("2000-01-01T00:00:00.000Z", false)).toBe(true);
  expect(isOverdue("2000-01-01T00:00:00.000Z", true)).toBe(false);
  expect(isOverdue(null, false)).toBe(false);
});

it("builds mention markdown without breaking the link", () => {
  expect(mentionMarkdown("Ann]ie", "u1")).toBe("[@Annie](mention:u1)");
});
