import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { renderTaskHtml } from "../core/task-view";
import type { State } from "./state";

type Message = { type: string; statusId?: string; value?: string; body?: string };

/** One editor tab per task; messages from the page call back into the commands. */
export class TaskPanels {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly state: State, private readonly run: (fn: () => Promise<unknown>) => Promise<void>) {}

  async open(key: string) {
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      await this.refresh(key);
      return;
    }
    const panel = vscode.window.createWebviewPanel("synqonix.task", key, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: false });
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));
    panel.webview.onDidReceiveMessage((m: Message) => void this.run(() => this.handle(key, m)));
    await this.refresh(key);
  }

  async refreshAll() {
    await Promise.all([...this.panels.keys()].map((k) => this.refresh(k)));
  }

  async refresh(key: string) {
    const panel = this.panels.get(key);
    const ws = this.state.workspace;
    if (!panel || !ws) return;
    const s = this.state.service;
    try {
      const [task, comments, activity, github, members, timer] = await Promise.all([
        s.task(ws.id, key), s.comments(ws.id, key), s.activity(ws.id, key), s.github(ws.id, key).catch(() => null), s.members(ws.id).catch(() => []), s.timer(ws.id).catch(() => null),
      ]);
      const statuses = await s.statuses(ws.id, task.projectId);
      panel.title = key;
      panel.webview.html = renderTaskHtml({
        task, statuses, comments, activity, github,
        names: new Map(members.map((m) => [m.userId, m.name])),
        timerRunning: timer?.taskKey === key,
        now: Date.now(),
        webUrl: this.state.webUrl,
      }, randomBytes(16).toString("hex"), panel.webview.cspSource);
    } catch (e) {
      panel.webview.html = `<!doctype html><body style="font-family:sans-serif;padding:20px">Could not load ${key}: ${String((e as Error).message).replace(/[<&]/g, "")}</body>`;
    }
  }

  private async handle(key: string, m: Message) {
    const ws = this.state.workspace;
    if (!ws) return;
    const s = this.state.service;
    switch (m.type) {
      case "transition": if (m.statusId) await s.transition(ws.id, key, m.statusId); break;
      case "priority": await s.setPriority(ws.id, key, m.value as never); break;
      case "comment": if (m.body?.trim()) await s.comment(ws.id, key, m.body); break;
      case "start": await vscode.commands.executeCommand("synqonix.startTask", key); return;
      case "assignMe": await vscode.commands.executeCommand("synqonix.assignToMe", key); return;
      case "timer": await vscode.commands.executeCommand("synqonix.toggleTimer", key); return;
      case "open": await vscode.commands.executeCommand("synqonix.openInBrowser", key); return;
      case "refresh": break;
      default: return;
    }
    await this.refresh(key);
    await vscode.commands.executeCommand("synqonix.refresh");
  }
}
