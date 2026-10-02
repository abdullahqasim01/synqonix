import * as vscode from "vscode";
import { cachedLoad } from "../core/cache";
import { SynqonixError } from "../core/api";
import { compareTasks, describeTask, typeIcon, type Task } from "../core/format";
import type { State } from "./state";

export class TaskItem extends vscode.TreeItem {
  constructor(readonly task: Task, now: number) {
    super(`${task.key}  ${task.title}`, vscode.TreeItemCollapsibleState.None);
    this.description = describeTask(task, now);
    this.iconPath = new vscode.ThemeIcon(typeIcon(task.type));
    this.contextValue = "task";
    this.tooltip = `${task.key} · ${task.status.name} · ${task.priority.toLowerCase()} priority`;
    this.command = { command: "synqonix.openTask", title: "Open task", arguments: [task.key] };
  }
}

class Group extends vscode.TreeItem {
  constructor(label: string, readonly tasks: Task[]) {
    super(label, tasks.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = String(tasks.length);
    this.contextValue = "group";
  }
}

type Node = TaskItem | Group | vscode.TreeItem;

const note = (label: string, icon: string, command?: vscode.Command) => {
  const i = new vscode.TreeItem(label);
  i.iconPath = new vscode.ThemeIcon(icon);
  if (command) i.command = command;
  return i;
};

interface Content { groups: { label: string; tasks: Task[] }[]; flat?: boolean }
type Source = (s: State, ws: string, project?: string) => Promise<Content>;

export class TaskTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly state: State, private readonly name: string, private readonly needsProject: boolean, private readonly source: Source) {
    state.changed.event(() => this.refresh());
  }

  refresh() { this.emitter.fire(undefined); }
  getTreeItem(n: Node) { return n; }

  async getChildren(parent?: Node): Promise<Node[]> {
    if (parent instanceof Group) return parent.tasks.map((t) => new TaskItem(t, Date.now()));
    if (parent) return [];
    const s = this.state;
    if (!s.signedIn) return [];
    const ws = s.workspace;
    if (!ws) return [note("Choose a workspace", "organization", { command: "synqonix.selectWorkspace", title: "Choose" })];
    const project = s.project;
    if (this.needsProject && !project) return [note("Choose a project", "project", { command: "synqonix.selectProject", title: "Choose" })];
    try {
      const { data, staleSince } = await cachedLoad<Content>(s.cache, `${this.name}:${ws.id}:${project?.id ?? ""}`, () => this.source(s, ws.id, project?.id));
      s.offline = staleSince !== undefined;
      const out: Node[] = [];
      if (staleSince !== undefined) out.push(note(`Offline — showing data from ${new Date(staleSince).toLocaleTimeString()}`, "cloud-offline"));
      const now = Date.now();
      if (data.flat) out.push(...(data.groups[0]?.tasks ?? []).map((t) => new TaskItem(t, now)));
      else out.push(...data.groups.map((g) => new Group(g.label, g.tasks)));
      if (out.every((n) => !(n instanceof TaskItem) && !(n instanceof Group && n.tasks.length))) out.push(note("Nothing here", "check"));
      return out;
    } catch (e) {
      if (e instanceof SynqonixError && e.kind === "unauthorized") {
        await vscode.commands.executeCommand("synqonix.handleUnauthorized");
        return [];
      }
      return [note(e instanceof Error ? e.message : "Could not load", "error", { command: "synqonix.refresh", title: "Retry" })];
    }
  }
}

export function createTrees(state: State): Record<string, TaskTree> {
  return {
    "synqonix.myTasks": new TaskTree(state, "my", false, async (s, ws) => {
      const tasks = (await s.service.myTasks(ws)).sort(compareTasks);
      return { groups: [{ label: "In progress", tasks: tasks.filter((t) => t.status.category === "IN_PROGRESS") }, { label: "To do", tasks: tasks.filter((t) => t.status.category !== "IN_PROGRESS") }] };
    }),
    "synqonix.sprint": new TaskTree(state, "sprint", true, async (s, ws, p) => {
      const tasks = await s.service.sprintTasks(ws, p!);
      const by = (cat: string) => tasks.filter((t) => t.status.category === cat).sort(compareTasks);
      return { groups: [{ label: "To do", tasks: by("TODO") }, { label: "In progress", tasks: by("IN_PROGRESS") }, { label: "Done", tasks: by("DONE") }] };
    }),
    "synqonix.backlog": new TaskTree(state, "backlog", true, async (s, ws, p) => {
      const b = await s.service.backlog(ws, p!);
      return { groups: [...b.sprints.map((x) => ({ label: `${x.sprint.name}${x.sprint.state === "ACTIVE" ? " (active)" : ""}`, tasks: x.tasks })), { label: "Backlog", tasks: b.backlog.tasks }] };
    }),
    "synqonix.recent": new TaskTree(state, "recent", false, async (s, ws) => ({ groups: [{ label: "Recent", tasks: await s.service.recent(ws) }], flat: true })),
  };
}
