import * as assert from "node:assert";
import * as vscode from "vscode";

/** Smoke test inside real VS Code: the extension activates and registers its commands. */
export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("synqonix.synqonix");
  assert.ok(ext, "extension is installed in the test host");
  await ext.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["synqonix.signIn", "synqonix.startTask", "synqonix.refresh", "synqonix.toggleTimer"]) assert.ok(commands.includes(id), `${id} is registered`);
}
