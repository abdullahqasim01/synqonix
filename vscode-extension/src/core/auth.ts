import { randomBytes } from "node:crypto";

export const EXTENSION_ID = "synqonix.synqonix";

/** Personal API tokens look like `sqx_` followed by URL-safe characters. */
export const isApiToken = (value: string) => /^sqx_[A-Za-z0-9_-]{16,}$/.test(value.trim());

/** Random value that ties the browser's answer to the request we made. */
export const newState = () => randomBytes(16).toString("hex");

/** Where the browser flow starts: the web app asks the signed-in user to connect VS Code. */
export function connectUrl(webUrl: string, state: string): string {
  return `${webUrl.replace(/\/+$/, "")}/connect/vscode?state=${encodeURIComponent(state)}`;
}

export interface AuthCallback { token: string; state: string }

/**
 * Reads the redirect `vscode://synqonix.synqonix/auth?token=…&state=…`. Anything else (other
 * paths, missing parts, a token that does not look like ours) is ignored.
 */
export function parseAuthCallback(uri: { path: string; query: string }): AuthCallback | null {
  if (uri.path !== "/auth") return null;
  const params = new URLSearchParams(uri.query);
  const token = params.get("token") ?? "";
  const state = params.get("state") ?? "";
  return isApiToken(token) && /^[a-f0-9]{16,64}$/.test(state) ? { token: token.trim(), state } : null;
}

/** Hostname-based label so the token is recognisable in the security settings. */
export const tokenLabel = (host: string) => `VS Code (${host.slice(0, 40) || "editor"})`;
