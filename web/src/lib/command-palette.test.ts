import { describe, expect, it } from "vitest";
import { commandEntries, moveSelection, resultEntries } from "./command-palette";

describe("commands", () => {
  it("lists everything for an empty query and filters by label or keyword", () => {
    expect(commandEntries("w1", "").length).toBeGreaterThan(8);
    expect(commandEntries("w1", "chat").map((c) => c.label)).toEqual(["Chat"]);
    expect(commandEntries("w1", "invite").map((c) => c.label)).toEqual(["Members"]);
    expect(commandEntries("w1", "zzzz")).toEqual([]);
    expect(commandEntries("w1", "NEW")[0]).toMatchObject({ action: "create-task" });
  });
  it("points at this workspace", () => {
    expect(commandEntries("w1", "my tasks")[0].href).toBe("/w/w1/my-tasks");
  });
});

describe("search results", () => {
  const result = {
    query: { text: "x", filters: {} },
    tasks: [{ id: "t1", key: "SYN-1", title: "Fix login", type: "TASK", status: { id: "s", name: "To Do", category: "TODO", color: "#000" }, projectId: "p1", snippet: null }],
    comments: [{ id: "c1", taskKey: "SYN-1", taskTitle: "Fix login", authorName: "Bob", snippet: "seen on Safari", createdAt: "" }],
    projects: [{ id: "p1", key: "SYN", name: "Synqonix" }],
    channels: [{ id: "ch1", type: "PUBLIC", name: "dev", projectId: null }, { id: "ch2", type: "DIRECT", name: "Bob", projectId: null }],
    messages: [{ id: "m1", channelId: "ch1", channelName: "dev", authorName: "Ann", snippet: "login is fixed", createdAt: "" }],
    people: [{ userId: "u1", name: "Bob", email: "b@x.test" }],
  } as unknown as Parameters<typeof resultEntries>[1];

  it("links each kind to where it lives", () => {
    const hrefs = Object.fromEntries(resultEntries("w1", result).map((e) => [e.id, e.href]));
    expect(hrefs).toMatchObject({
      "task:t1": "/w/w1/tasks/SYN-1", "project:p1": "/w/w1/projects/p1", "channel:ch1": "/w/w1/chat?c=ch1",
      "comment:c1": "/w/w1/tasks/SYN-1", "message:m1": "/w/w1/chat?c=ch1", "person:u1": "/w/w1/members",
    });
  });
  it("orders tasks first and names channels sensibly", () => {
    const entries = resultEntries("w1", result);
    expect(entries[0].group).toBe("Tasks");
    expect(entries.find((e) => e.id === "channel:ch1")?.label).toBe("# dev");
    expect(entries.find((e) => e.id === "channel:ch2")?.label).toBe("Bob");
  });
});

describe("selection", () => {
  it("wraps around", () => {
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
