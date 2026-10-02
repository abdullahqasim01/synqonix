import { dueLabel, formatMinutes, type Task } from "./format";
import { renderMarkdownLite } from "./markdown";
import type { Schemas } from "./api";

export interface TaskViewModel {
  task: Schemas["TaskDetailDto"];
  statuses: Schemas["StatusDto"][];
  comments: Schemas["CommentDto"][];
  activity: Schemas["ActivityDto"][];
  github: Schemas["TaskGithubDto"] | null;
  names: Map<string, string>;
  timerRunning: boolean;
  now: number;
  webUrl: string;
}

const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PRIORITIES: Task["priority"][] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];

function activityText(a: Schemas["ActivityDto"], names: Map<string, string>): string {
  const who = a.actorId ? names.get(a.actorId) ?? "Someone" : a.type === "automation" ? "Automation" : "GitHub";
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));
  if (a.type === "created") return `${who} created this task`;
  if (a.type === "updated") return `${who} changed ${a.field ?? "a field"} from ${show(a.from)} to ${show(a.to)}`;
  if (a.type === "github_linked") return `${who} linked ${show(a.to)}`;
  if (a.type === "automation") return `${who} ran “${show(a.to)}”`;
  return `${who} ${a.type.replace(/_/g, " ")}`;
}

/**
 * The task page shown in the editor. All text is escaped; markdown goes through the restricted
 * renderer; scripts and styles carry a per-render nonce under a strict content security policy.
 */
export function renderTaskHtml(m: TaskViewModel, nonce: string, cspSource: string): string {
  const t = m.task;
  const done = t.status.category === "DONE";
  const due = dueLabel(t.dueDate, m.now, done);
  const people = (id: string | null) => (id ? m.names.get(id) ?? "Someone" : "Unknown");
  const gh = m.github;
  const link = (url: string, label: string) => (/^https:\/\//.test(url) ? `<a href="${esc(url)}">${esc(label)}</a>` : esc(label));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} https:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px 20px;line-height:1.5}
h1{font-size:1.4em;margin:.2em 0}.key{color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
select,button,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:3px 8px}
button{cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.meta{color:var(--vscode-descriptionForeground);font-size:.9em}.late{color:var(--vscode-errorForeground)}
section{margin-top:22px}h2{font-size:1.05em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px}
pre{background:var(--vscode-textCodeBlock-background);padding:8px;overflow:auto}code{font-family:var(--vscode-editor-font-family)}
blockquote{border-left:3px solid var(--vscode-panel-border);margin:4px 0;padding-left:10px;color:var(--vscode-descriptionForeground)}
.mention{color:var(--vscode-textLink-foreground)}.comment{margin:10px 0;padding:8px 10px;border:1px solid var(--vscode-panel-border);border-radius:4px}
textarea{width:100%;min-height:70px;box-sizing:border-box}ul.plain{list-style:none;padding:0}ul.plain li{margin:3px 0}
</style></head><body>
<div class="key">${esc(t.key)} · ${esc(t.type.toLowerCase())}</div>
<h1>${esc(t.title)}</h1>
<div class="meta">${esc(t.status.name)}${t.estimate !== null ? ` · ${esc(t.estimate)} pt` : ""}${due ? ` · <span class="${due.startsWith("overdue") ? "late" : ""}">${esc(due)}</span>` : ""}${t.timeSpentMinutes ? ` · ${esc(formatMinutes(t.timeSpentMinutes))} logged` : ""}${t.assignees.length ? ` · ${esc(t.assignees.map((a) => a.name).join(", "))}` : " · unassigned"}</div>
<div class="bar">
  <label>Status <select id="status" ${t.canEdit ? "" : "disabled"}>${m.statuses.map((s) => `<option value="${esc(s.id)}"${s.id === t.status.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
  <label>Priority <select id="priority" ${t.canEdit ? "" : "disabled"}>${PRIORITIES.map((p) => `<option value="${p}"${p === t.priority ? " selected" : ""}>${p.charAt(0)}${p.slice(1).toLowerCase()}</option>`).join("")}</select></label>
  ${t.canEdit ? `<button class="primary" data-action="start">Start working</button><button data-action="assignMe">Assign to me</button><button data-action="timer">${m.timerRunning ? "Stop timer" : "Start timer"}</button>` : ""}
  <button data-action="open">Open in browser</button><button data-action="refresh">Refresh</button>
</div>
${t.description ? `<section><h2>Description</h2>${renderMarkdownLite(t.description)}</section>` : ""}
${t.acceptanceCriteria ? `<section><h2>Acceptance criteria</h2>${renderMarkdownLite(t.acceptanceCriteria)}</section>` : ""}
${t.checklists.length ? `<section><h2>Checklists</h2>${t.checklists.map((c) => `<strong>${esc(c.title)}</strong><ul class="plain">${c.items.map((i) => `<li>${i.done ? "☑" : "☐"} ${esc(i.text)}</li>`).join("")}</ul>`).join("")}</section>` : ""}
${gh && (gh.pullRequests.length || gh.branches.length || gh.commits.length) ? `<section><h2>GitHub</h2><ul class="plain">
${gh.pullRequests.map((p) => `<li>${esc(p.state.toLowerCase())}${p.draft ? " (draft)" : ""} · ${link(p.url, `#${p.number} ${p.title}`)}${p.ci ? ` · checks ${esc(p.ci.toLowerCase())}` : ""}${p.reviewState ? ` · ${esc(p.reviewState.toLowerCase().replace("_", " "))}` : ""}</li>`).join("")}
${gh.branches.map((b) => `<li>branch ${link(b.url, b.name)}</li>`).join("")}
${gh.commits.slice(0, 5).map((c) => `<li>commit ${link(c.url, c.sha.slice(0, 7))} ${esc(c.message)}</li>`).join("")}</ul></section>` : ""}
<section><h2>Comments (${m.comments.length})</h2>
${m.comments.map((c) => `<div class="comment"><div class="meta">${esc(people(c.authorId))} · ${esc(new Date(c.createdAt).toLocaleString())}${c.edited ? " · edited" : ""}</div>${renderMarkdownLite(c.body)}</div>`).join("") || '<p class="meta">No comments yet.</p>'}
${t.canEdit ? `<textarea id="comment" placeholder="Write a comment (markdown)"></textarea><div class="bar"><button class="primary" data-action="comment">Comment</button></div>` : ""}
</section>
${m.activity.length ? `<section><h2>Activity</h2><ul class="plain meta">${m.activity.slice(0, 10).map((a) => `<li>${esc(activityText(a, m.names))} · ${esc(new Date(a.createdAt).toLocaleDateString())}</li>`).join("")}</ul></section>` : ""}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById("status")?.addEventListener("change", (e) => vscode.postMessage({ type: "transition", statusId: e.target.value }));
document.getElementById("priority")?.addEventListener("change", (e) => vscode.postMessage({ type: "priority", value: e.target.value }));
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => {
  const type = b.dataset.action;
  if (type === "comment") { const box = document.getElementById("comment"); if (box.value.trim()) { vscode.postMessage({ type, body: box.value }); box.value = ""; } }
  else vscode.postMessage({ type });
}));
</script>
</body></html>`;
}
