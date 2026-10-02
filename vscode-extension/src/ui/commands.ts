import * as vscode from "vscode";
import { SynqonixError } from "../core/api";
import { connectUrl, isApiToken, newState, parseAuthCallback } from "../core/auth";
import { commitTemplate, GitError } from "../core/git";
import type { Task } from "../core/format";
import type { Priority } from "../core/service";
import { prefillCommitMessage, syncCurrentTaskFromBranch } from "./git-watch";
import type { StatusBar } from "./statusbar";
import type { State } from "./state";
import type { TaskPanels } from "./task-panel";
import type { TaskTree } from "./trees";
import { TaskItem } from "./trees";

export interface Deps {
  state: State;
  panels: TaskPanels;
  statusBar: StatusBar;
  trees: Record<string, TaskTree>;
  output: vscode.OutputChannel;
  pollNotifications(): Promise<unknown>;
}

const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
const TYPES = ["TASK", "STORY", "BUG", "EPIC"] as const;

export function registerCommands(d: Deps): vscode.Disposable[] {
  const { state, output } = d;
  const s = state.service;
  let pendingState: string | undefined;

  /** Runs an action, turning API failures into one clear message instead of an unhandled rejection. */
  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof SynqonixError && e.kind === "unauthorized") return handleUnauthorized();
      const msg = e instanceof Error ? e.message : String(e);
      output.appendLine(`[error] ${msg}`);
      void vscode.window.showErrorMessage(`Synqonix: ${msg}`);
    }
  }

  async function handleUnauthorized() {
    if (!state.signedIn) return;
    await state.setToken(undefined);
    const pick = await vscode.window.showWarningMessage("Synqonix: your session is no longer valid. Sign in again?", "Sign in");
    if (pick === "Sign in") await vscode.commands.executeCommand("synqonix.signIn");
  }

  const needWorkspace = async (): Promise<{ id: string; name: string } | undefined> => {
    if (!state.signedIn) {
      void vscode.window.showInformationMessage("Sign in to Synqonix first.", "Sign in").then((p) => p && vscode.commands.executeCommand("synqonix.signIn"));
      return undefined;
    }
    if (!state.workspace) await vscode.commands.executeCommand("synqonix.selectWorkspace");
    return state.workspace;
  };

  async function pickTask(placeHolder: string): Promise<string | undefined> {
    const ws = await needWorkspace();
    if (!ws) return undefined;
    const mine = await s.myTasks(ws.id).catch(() => [] as Task[]);
    const items: (vscode.QuickPickItem & { key?: string })[] = [
      ...mine.map((t) => ({ label: `${t.key}  ${t.title}`, description: t.status.name, key: t.key })),
      { label: "Search all tasks…", alwaysShow: true },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder });
    if (!pick) return undefined;
    return pick.key ?? (await searchPick(ws.id));
  }

  async function searchPick(workspaceId: string): Promise<string | undefined> {
    const q = await vscode.window.showInputBox({ prompt: "Search tasks (e.g. login bug, or assignee:me status:open)" });
    if (!q?.trim()) return undefined;
    const hits = await s.search(workspaceId, q);
    if (hits.length === 0) {
      void vscode.window.showInformationMessage(`No tasks match “${q}”.`);
      return undefined;
    }
    return (await vscode.window.showQuickPick(hits.map((h) => ({ label: `${h.key}  ${h.title}`, description: h.status.name, key: h.key })), { placeHolder: "Pick a task" }))?.key;
  }

  /** A command argument can be a key, a tree item, or nothing (then ask). */
  async function keyOf(arg: unknown, prompt: string): Promise<string | undefined> {
    if (typeof arg === "string") return arg;
    if (arg instanceof TaskItem) return arg.task.key;
    return (await pickTask(prompt)) ?? undefined;
  }

  const refreshTimer = async () => {
    const ws = state.workspace;
    if (!ws || !state.signedIn) return d.statusBar.setTimer(null);
    // Offline is fine (keep the last known timer); a rejected token is not.
    d.statusBar.setTimer(await s.timer(ws.id).catch((e) => { if (e instanceof SynqonixError && e.kind === "unauthorized") throw e; return null; }));
  };

  async function refreshAll() {
    for (const t of Object.values(d.trees)) t.refresh();
    await d.panels.refreshAll();
    await refreshTimer();
  }

  async function startTask(arg: unknown) {
    const key = await keyOf(arg, "Start which task?");
    const ws = state.workspace;
    if (!key || !ws) return;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return void vscode.window.showWarningMessage("Open a folder with a git repository to start a task.");
    const root = await state.git.root(cwd);
    if (!root) return void vscode.window.showWarningMessage("This folder is not a git repository.");
    if (await state.git.isDirty(root)) {
      const go = await vscode.window.showWarningMessage("You have uncommitted changes. They will come with you to the new branch.", { modal: false }, "Continue", "Cancel");
      if (go !== "Continue") return;
    }
    try {
      const r = await s.startWork(ws.id, key, {
        cwd: root,
        moveToInProgress: state.setting("startTask.moveToInProgress", true),
        assignToMe: state.setting("startTask.assignToMe", true),
        startTimer: state.setting("startTask.startTimer", false),
        base: state.setting("startTask.baseBranch", "") || undefined,
      });
      await state.setCurrentTask(r.task.key);
      if (state.setting("git.commitTemplate", true)) await prefillCommitMessage(r.task.key, r.task.title);
      const bits = [r.branchCreated ? `created branch ${r.branch}` : `switched to ${r.branch}`, r.movedTo && `moved to ${r.movedTo}`, r.assigned && "assigned to you", r.timerStarted && "timer started"].filter(Boolean);
      void vscode.window.showInformationMessage(`${r.task.key}: ${bits.join(", ")}.`);
      await refreshAll();
    } catch (e) {
      if (e instanceof GitError) return void vscode.window.showErrorMessage(`Synqonix: git said — ${e.message}. The task was not changed.`);
      throw e;
    }
  }

  async function transition(arg: unknown) {
    const key = await keyOf(arg, "Move which task?");
    const ws = state.workspace;
    if (!key || !ws) return;
    const task = await s.task(ws.id, key);
    const statuses = await s.statuses(ws.id, task.projectId);
    const pick = await vscode.window.showQuickPick(statuses.map((st) => ({ label: st.name, description: st.id === task.status.id ? "current" : st.category.toLowerCase().replace("_", " "), id: st.id })), { placeHolder: `${key} is ${task.status.name}` });
    if (!pick || pick.id === task.status.id) return;
    await s.transition(ws.id, key, pick.id);
    await refreshAll();
  }

  async function chooseWorkspace() {
    if (!state.signedIn) return void vscode.commands.executeCommand("synqonix.signIn");
    const all = await s.workspaces();
    if (all.length === 0) return void vscode.window.showInformationMessage("You are not in any workspace yet — create one in the web app.");
    const w = all.length === 1 ? all[0] : (await vscode.window.showQuickPick(all.map((x) => ({ label: x.name, w: x })), { placeHolder: "Workspace" }))?.w;
    if (!w) return;
    await state.setWorkspace(w);
    await refreshAll();
  }

  async function chooseProject() {
    const ws = await needWorkspace();
    if (!ws) return;
    const projects = await s.projects(ws.id);
    if (projects.length === 0) return void vscode.window.showInformationMessage("This workspace has no projects yet.");
    const p = (await vscode.window.showQuickPick(projects.map((x) => ({ label: `${x.key}  ${x.name}`, p: x })), { placeHolder: "Project for sprint, backlog and new tasks" }))?.p;
    if (!p) return;
    await state.setProject(p);
  }

  async function createTask() {
    const ws = await needWorkspace();
    if (!ws) return;
    if (!state.project) await chooseProject();
    const project = state.project;
    if (!project) return;
    const title = await vscode.window.showInputBox({ prompt: `New task in ${project.key}`, placeHolder: "Title", validateInput: (v) => (v.trim() ? undefined : "A title is required") });
    if (!title?.trim()) return;
    const type = (await vscode.window.showQuickPick([...TYPES], { placeHolder: "Type" })) as (typeof TYPES)[number] | undefined;
    if (!type) return;
    const t = await s.create(ws.id, project.id, { title: title.trim(), type, assignToMe: true });
    await refreshAll();
    const next = await vscode.window.showInformationMessage(`Created ${t.key}.`, "Start working", "Open");
    if (next === "Start working") await startTask(t.key);
    else if (next === "Open") await d.panels.open(t.key);
  }

  const reg = (id: string, fn: (...a: never[]) => unknown) => vscode.commands.registerCommand(id, (...a: unknown[]) => guard(async () => void (await (fn as (...x: unknown[]) => unknown)(...a))));

  return [
    vscode.commands.registerCommand("synqonix.handleUnauthorized", handleUnauthorized),
    reg("synqonix.signIn", async () => {
      pendingState = newState();
      const ok = await vscode.env.openExternal(vscode.Uri.parse(connectUrl(state.webUrl, pendingState)));
      if (!ok) void vscode.window.showWarningMessage("Could not open the browser. Use “Synqonix: Sign in with an API token” instead.");
    }),
    reg("synqonix.signInWithToken", async () => {
      const token = (await vscode.window.showInputBox({ prompt: "Paste a personal API token (Settings → API tokens in Synqonix)", password: true, ignoreFocusOut: true, validateInput: (v) => (isApiToken(v) ? undefined : "Tokens start with sqx_") }))?.trim();
      if (!token) return;
      await finishSignIn(token);
    }),
    reg("synqonix.signOut", async () => {
      await state.setToken(undefined);
      d.statusBar.setTimer(null);
      void vscode.window.showInformationMessage("Signed out of Synqonix.");
    }),
    reg("synqonix.selectWorkspace", chooseWorkspace),
    reg("synqonix.selectProject", chooseProject),
    vscode.commands.registerCommand("synqonix.refresh", () => guard(refreshAll)),
    reg("synqonix.createTask", createTask),
    reg("synqonix.searchTasks", async () => {
      const ws = await needWorkspace();
      const key = ws && (await searchPick(ws.id));
      if (key) await d.panels.open(key);
    }),
    reg("synqonix.openTask", async (arg: unknown) => {
      const key = await keyOf(arg, "Open which task?");
      if (key) await d.panels.open(key);
    }),
    reg("synqonix.openInBrowser", async (arg: unknown) => {
      const key = await keyOf(arg, "Open which task?");
      const ws = state.workspace;
      if (key && ws) await vscode.env.openExternal(vscode.Uri.parse(`${state.webUrl}/w/${ws.id}/tasks/${key}`));
    }),
    reg("synqonix.startTask", startTask),
    reg("synqonix.transitionTask", transition),
    reg("synqonix.assignToMe", async (arg: unknown) => {
      const key = await keyOf(arg, "Assign which task?");
      const ws = state.workspace;
      if (!key || !ws) return;
      await s.assignToMe(ws.id, key);
      await refreshAll();
    }),
    reg("synqonix.setPriority", async (arg: unknown) => {
      const key = await keyOf(arg, "Which task?");
      const ws = state.workspace;
      if (!key || !ws) return;
      const p = (await vscode.window.showQuickPick(PRIORITIES.map((x) => x.charAt(0) + x.slice(1).toLowerCase()), { placeHolder: "Priority" }))?.toUpperCase() as Priority | undefined;
      if (!p) return;
      await s.setPriority(ws.id, key, p);
      await refreshAll();
    }),
    reg("synqonix.commentOnTask", async (arg: unknown) => {
      const key = await keyOf(arg, "Comment on which task?");
      const ws = state.workspace;
      if (!key || !ws) return;
      const body = await vscode.window.showInputBox({ prompt: `Comment on ${key}`, placeHolder: "Markdown is supported" });
      if (!body?.trim()) return;
      await s.comment(ws.id, key, body.trim());
      void vscode.window.showInformationMessage(`Comment added to ${key}.`);
      await d.panels.refresh(key);
    }),
    reg("synqonix.toggleTimer", async (arg: unknown) => {
      const ws = await needWorkspace();
      if (!ws) return;
      if (state.timerRunning && typeof arg !== "string") return void (await vscode.commands.executeCommand("synqonix.stopTimer"));
      const key = await keyOf(arg, "Time which task?");
      if (!key) return;
      if (state.timerRunning) await s.stopTimer(ws.id);
      else await s.startTimer(ws.id, key);
      await refreshTimer();
      await d.panels.refresh(key);
    }),
    reg("synqonix.stopTimer", async () => {
      const ws = state.workspace;
      if (!ws) return;
      const done = await s.stopTimer(ws.id);
      void vscode.window.showInformationMessage(done ? `Logged ${done.minutes} min on ${done.taskKey}.` : "Timer stopped (under a minute, nothing logged).");
      await refreshTimer();
      await d.panels.refreshAll();
    }),
    reg("synqonix.setCurrentTask", async (arg: unknown) => {
      const key = await keyOf(arg, "Set current task");
      if (key) await state.setCurrentTask(key);
    }),
    reg("synqonix.clearCurrentTask", () => state.setCurrentTask(undefined)),
    reg("synqonix.insertCommitTemplate", async () => {
      const key = state.currentTask ?? (await pickTask("Which task is this commit for?"));
      const ws = state.workspace;
      if (!key || !ws) return;
      const title = (await s.task(ws.id, key).catch(() => null))?.title;
      if (await prefillCommitMessage(key, title)) return;
      await vscode.env.clipboard.writeText(commitTemplate(key, title));
      void vscode.window.showInformationMessage(`Copied “${commitTemplate(key, title)}” to the clipboard.`);
    }),
    reg("synqonix.currentTaskMenu", async () => {
      const key = state.currentTask;
      if (!key) return;
      const actions = [
        ["Open task", "synqonix.openTask"], ["Move to another status", "synqonix.transitionTask"], ["Add comment", "synqonix.commentOnTask"],
        [state.timerRunning ? "Stop timer" : "Start timer", "synqonix.toggleTimer"], ["Insert commit message", "synqonix.insertCommitTemplate"],
        ["Open in browser", "synqonix.openInBrowser"], ["Clear current task", "synqonix.clearCurrentTask"],
      ] as const;
      const pick = await vscode.window.showQuickPick(actions.map(([label, command]) => ({ label, command })), { placeHolder: key });
      if (pick) await vscode.commands.executeCommand(pick.command, key);
    }),
    reg("synqonix.showOutput", () => output.show()),

    vscode.window.registerUriHandler({
      handleUri: (uri) =>
        guard(async () => {
          const cb = parseAuthCallback({ path: uri.path, query: uri.query });
          if (!cb || !pendingState || cb.state !== pendingState) {
            void vscode.window.showWarningMessage("Synqonix: ignored a sign-in response that did not match a request from this window.");
            return;
          }
          pendingState = undefined;
          await finishSignIn(cb.token);
        }),
    }),
  ];

  async function finishSignIn(token: string) {
    await state.setToken(token);
    try {
      const me = await s.me();
      void vscode.window.showInformationMessage(`Signed in to Synqonix as ${me.name}.`);
    } catch (e) {
      await state.setToken(undefined);
      throw e instanceof SynqonixError && e.kind === "unauthorized" ? new Error("That token was not accepted.") : e;
    }
    await chooseWorkspace();
    await syncCurrentTaskFromBranch(state);
    await refreshAll();
    void d.pollNotifications();
  }
}

