/** The editor's sign-in handshake: `/connect/vscode?state=…` → token → `vscode://synqonix.synqonix/auth?…`. */

const EXTENSION_AUTHORITY = "synqonix.synqonix";

/** The state the extension generated; anything that is not a plain hex string is rejected. */
export function parseState(raw: string | null | undefined): string | null {
  return raw && /^[a-f0-9]{16,64}$/.test(raw) ? raw : null;
}

/** Only VS Code (stable or Insiders) may receive the token, and only at the extension's own address. */
export function callbackUrl(token: string, state: string, scheme: "vscode" | "vscode-insiders" = "vscode"): string {
  return `${scheme}://${EXTENSION_AUTHORITY}/auth?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

export function schemeFrom(raw: string | null | undefined): "vscode" | "vscode-insiders" {
  return raw === "vscode-insiders" ? "vscode-insiders" : "vscode";
}
