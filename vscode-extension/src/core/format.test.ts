import { describe, expect, it } from "vitest";
import { compareTasks, describeTask, dueLabel, formatClock, formatMinutes, startStatus, type Task } from "./format";

const t = (over: Partial<Task>): Task => ({
  key: "SYN-1", number: 1, projectKey: "SYN", priority: "NONE", dueDate: null, status: { id: "s", name: "To Do", category: "TODO", color: "" },
  estimate: null, timeSpentMinutes: 0, ...over,
}) as Task;

describe("task ordering", () => {
  it("puts urgent work first, then the soonest due date, then keys", () => {
    const list = [t({ key: "SYN-3", number: 3 }), t({ key: "SYN-2", number: 2, priority: "HIGH", dueDate: "2026-03-10T00:00:00Z" }),
      t({ key: "SYN-9", number: 9, priority: "HIGH", dueDate: "2026-03-05T00:00:00Z" }), t({ key: "SYN-1", number: 1, priority: "URGENT" }), t({ key: "SYN-10", number: 10 })];
    expect(list.sort(compareTasks).map((x) => x.key)).toEqual(["SYN-1", "SYN-9", "SYN-2", "SYN-3", "SYN-10"]);
  });
});

describe("labels", () => {
  const now = new Date("2026-03-10T12:00:00Z").getTime();
  it("describes due dates", () => {
    expect(dueLabel(null, now)).toBe("");
    expect(dueLabel("2026-03-07T12:00:00Z", now)).toBe("overdue 3d");
    expect(dueLabel("2026-03-10T20:00:00Z", now)).toBe("due today");
    expect(dueLabel("2026-03-11T20:00:00Z", now)).toBe("due tomorrow");
    expect(dueLabel("2026-03-25T00:00:00Z", now)).toBe("due Mar 25");
    expect(dueLabel("2026-03-01T00:00:00Z", now, true)).toBe("");
  });
  it("summarises a task for a tree row", () => {
    expect(describeTask(t({ estimate: 3, dueDate: "2026-03-11T20:00:00Z", timeSpentMinutes: 90 }), now)).toBe("To Do · 3 pt · due tomorrow · 1h 30m");
    expect(describeTask(t({}), now)).toBe("To Do");
  });
  it("formats time", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatClock(3725)).toBe("01:02:05");
  });
});

describe("starting work", () => {
  const statuses = [
    { id: "a", name: "To Do", category: "TODO" as const, position: 0 }, { id: "c", name: "In Review", category: "IN_PROGRESS" as const, position: 2 },
    { id: "b", name: "In Progress", category: "IN_PROGRESS" as const, position: 1 }, { id: "d", name: "Done", category: "DONE" as const, position: 3 },
  ];
  it("picks the first in-progress status only for tasks not yet started", () => {
    expect(startStatus(statuses, { id: "a", category: "TODO" })?.name).toBe("In Progress");
    expect(startStatus(statuses, { id: "b", category: "IN_PROGRESS" })).toBeNull();
    expect(startStatus(statuses, { id: "d", category: "DONE" })).toBeNull();
    expect(startStatus([statuses[0], statuses[3]], { id: "a", category: "TODO" })).toBeNull();
  });
});
