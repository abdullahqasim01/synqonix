import * as vscode from "vscode";
import { formatClock } from "../core/format";
import type { State } from "./state";

/** Status-bar items: the current task (click for actions) and the running timer (click to stop). */
export class StatusBar implements vscode.Disposable {
  private readonly task = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly timer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private running: { key: string; startedAt: number } | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly state: State) {
    this.task.command = "synqonix.currentTaskMenu";
    this.timer.command = "synqonix.stopTimer";
    state.changed.event(() => this.render());
    this.render();
  }

  setTimer(entry: { taskKey: string; startedAt: string } | null) {
    this.running = entry ? { key: entry.taskKey, startedAt: Date.parse(entry.startedAt) } : null;
    this.state.timerRunning = !!entry;
    if (this.tick) clearInterval(this.tick);
    this.tick = this.running ? setInterval(() => this.render(), 1000) : undefined;
    this.render();
  }

  render(now = Date.now()) {
    const key = this.state.currentTask;
    if (this.state.signedIn && key) {
      this.task.text = `$(tasklist) ${key}`;
      this.task.tooltip = `Synqonix: current task ${key} — click for actions`;
      this.task.show();
    } else this.task.hide();

    if (this.state.signedIn && this.running) {
      this.timer.text = `$(clock) ${this.running.key} ${formatClock(Math.max(0, Math.floor((now - this.running.startedAt) / 1000)))}`;
      this.timer.tooltip = "Synqonix: timer running — click to stop";
      this.timer.show();
    } else this.timer.hide();
  }

  dispose() {
    if (this.tick) clearInterval(this.tick);
    this.task.dispose();
    this.timer.dispose();
  }
}
