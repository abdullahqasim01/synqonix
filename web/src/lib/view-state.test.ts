import { describe, expect, it } from "vitest";
import { defaultViewState, filterParams, fromView, sameQuery, toViewQuery } from "./view-state";

describe("view state <-> saved view", () => {
  it("stores only non-default values", () => {
    expect(toViewQuery(defaultViewState())).toEqual({ display: { cardFields: ["key", "priority", "assignees", "labels", "due"] } });
    const s = defaultViewState({
      sort: "dueDate", order: "desc", swimlane: "assignee", hiddenStatusIds: ["s1"],
      filters: { ...defaultViewState().filters, priority: "HIGH", assignee: "me", q: "  login ", hideDone: true },
    });
    expect(toViewQuery(s)).toMatchObject({
      filters: { priority: "HIGH", assignee: "me", q: "login" }, sort: "dueDate", order: "desc", swimlane: "assignee",
      display: { hiddenStatusIds: ["s1"], hideDone: true },
    });
  });

  it("round-trips through a saved view", () => {
    const s = defaultViewState({
      layout: "board", sort: "priority", swimlane: "epic", hiddenColumns: ["labels"], cardFields: ["key"],
      filters: { ...defaultViewState().filters, type: "BUG", labelId: "l1", includeArchived: true, hideDone: true },
    });
    const restored = fromView({ layout: "BOARD", query: toViewQuery(s) });
    expect(restored).toEqual(s);
    expect(sameQuery(s, restored)).toBe(true);
    expect(sameQuery(s, { ...restored, layout: "list" })).toBe(false);
  });

  it("maps filters to the same parameters the API view applies", () => {
    const s = defaultViewState({ filters: { ...defaultViewState().filters, priority: "HIGH", q: "o", assignee: "none" } });
    expect(filterParams(s.filters)).toEqual({ q: "o", priority: "HIGH", assignee: "none" });
    expect(toViewQuery(s).filters).toEqual(filterParams(s.filters));
  });
});
