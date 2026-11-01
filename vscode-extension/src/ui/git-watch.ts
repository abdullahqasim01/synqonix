import * as vscode from "vscode";
import { commitTemplate, taskKeyFromBranch } from "../core/git";
import type { State } from "./state";

const folder = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

/** Keeps the current task in step with the checked-out branch (`syn-12-fix-login` → SYN-12). */
export async function syncCurrentTaskFromBranch(state: State): Promise<string | null> {
  const cwd = folder();
  if (!cwd || !state.signedIn) return null;
  const root = await state.git.root(cwd);
  if (!root) return null;
  const key = taskKeyFromBranch(await state.git.currentBranch(root));
  if (key) await state.setCurrentTask(key);
  return key;
}

export function watchBranch(state: State): vscode.Disposable {
  const subs: vscode.Disposable[] = [];
  const cwd = folder();
  if (cwd) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(cwd, ".git/HEAD"));
    const onChange = () => void syncCurrentTaskFromBranch(state);
    subs.push(watcher, watcher.onDidChange(onChange), watcher.onDidCreate(onChange));
  }
  return vscode.Disposable.from(...subs);
}

/** Puts "SYN-12: title" in the Source Control message box when it is empty (best effort). */
export async function prefillCommitMessage(key: string, title: string | undefined): Promise<boolean> {
  try {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): { repositories: { rootUri: vscode.Uri; inputBox: { value: string } }[] } }>("vscode.git");
    if (!ext) return false;
    const git = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    const cwd = folder();
    const repo = git.repositories.find((r) => cwd && r.rootUri.fsPath === cwd) ?? git.repositories[0];
    if (!repo || repo.inputBox.value.trim()) return false;
    repo.inputBox.value = commitTemplate(key, title);
    return true;
  } catch {
    return false;
  }
}
