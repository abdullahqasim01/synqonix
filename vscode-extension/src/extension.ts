import * as vscode from "vscode";
import { normalizeApiUrl } from "./config";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("synqonix.hello", () => {
      const url = normalizeApiUrl(vscode.workspace.getConfiguration("synqonix").get<string>("apiUrl"));
      void vscode.window.showInformationMessage(`Synqonix is connected to ${url}`);
    }),
  );
}

export function deactivate() {}
