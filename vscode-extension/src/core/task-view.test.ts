import { describe, expect, it } from "vitest";
import type { Schemas } from "./api";
import { renderTaskHtml, type TaskViewModel } from "./task-view";

const model = (over: Partial<Schemas["TaskDetailDto"]> = {}, extra: Partial<TaskViewModel> = {}): TaskViewModel => ({
  task: {
    key: "SYN-1", type: "BUG", title: "Fix <b>login</b>", status: { id: "s1", name: "To Do", category: "TODO", color: "" }, priority: "HIGH", estimate: 3, dueDate: null,
    timeSpentMinutes: 90, assignees: [{ userId: "u1", name: "Ann" }], description: "Steps:\n- one\n\n<script>alert(1)</script>", acceptanceCriteria: null, checklists: [], canEdit: true, ...over,
  } as never,
  statuses: [{ id: "s1", name: "To Do" }, { id: "s2", name: "Done" }] as never, comments: [], activity: [], github: null, names: new Map([["u1", "Ann"]]),
  timerRunning: false, now: Date.parse("2026-03-10T00:00:00Z"), webUrl: "http://localhost:3000", ...extra,
});

describe("task page", () => {
  it("escapes everything that came from the server", () => {
    const html = renderTaskHtml(model(), "N0NCE", "vscode-resource:");
    expect(html).toContain("Fix &lt;b&gt;login&lt;/b&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // only our own script block carries the nonce; nothing from task text can become a tag
    expect([...html.matchAll(/<script/g)]).toHaveLength(1);
  });

  it("locks the page down with a nonce-based policy", () => {
    const html = renderTaskHtml(model(), "abc123", "vscode-resource:");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(html.match(/<script nonce="abc123">/g)).toHaveLength(1);
  });

  it("shows meta, status choices and comments, and hides editing for read-only users", () => {
    const html = renderTaskHtml(model({}, {
      comments: [{ id: "c", authorId: "u1", body: "Looks **good**", edited: true, createdAt: "2026-03-09T10:00:00Z", editedAt: null }] as never,
    }), "n", "x");
    expect(html).toContain("To Do · 3 pt · 1h 30m logged · Ann");
    expect(html).toContain('<option value="s1" selected>To Do</option>');
    expect(html).toContain("Ann · ");
    expect(html).toContain("Looks <strong>good</strong>");
    expect(html).toContain("Start working");
    const ro = renderTaskHtml(model({ canEdit: false }), "n", "x");
    expect(ro).not.toContain("Start working");
    expect(ro).not.toContain('id="comment"');
    expect(ro).toContain("<select id=\"status\" disabled>");
  });

  it("only links https URLs from GitHub data", () => {
    const html = renderTaskHtml(model({}, {
      github: { pullRequests: [{ number: 5, title: "Fix", state: "OPEN", draft: false, url: "javascript:alert(1)", ci: "SUCCESS", reviewState: "APPROVED" }], branches: [{ name: "syn-1-x", url: "https://github.com/a/b/tree/syn-1-x" }], commits: [] } as never,
    }), "n", "x");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<a href="https://github.com/a/b/tree/syn-1-x">syn-1-x</a>');
    expect(html).toContain("checks success");
  });

  it("offers to stop a running timer", () => {
    expect(renderTaskHtml(model({}, { timerRunning: true }), "n", "x")).toContain("Stop timer");
  });
});
