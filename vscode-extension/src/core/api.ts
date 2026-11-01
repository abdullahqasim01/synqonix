import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "../api/schema";

export type Schemas = components["schemas"];

export interface ApiConfig {
  baseUrl: string;
  token: string | undefined;
}

export type ErrorKind = "offline" | "unauthorized" | "forbidden" | "not-found" | "invalid" | "server";

/** What went wrong, in a form the UI can react to (re-login, offline banner, plain message). */
export class SynqonixError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "SynqonixError";
  }
}

/** Human-readable message from an API error body (arrays of validation errors are joined). */
export function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(", ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

function kindOf(status: number): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 400 && status < 500) return "invalid";
  return "server";
}

/**
 * Typed client for the Synqonix API. The token is read for every request, so signing in or out
 * takes effect immediately. Network failures become `SynqonixError("offline")`.
 */
export function createApi(config: () => ApiConfig, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {
  const auth: Middleware = {
    onRequest({ request }) {
      const { token } = config();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      request.headers.set("User-Agent", "synqonix-vscode");
      return request;
    },
  };
  const client = createClient<paths>({ baseUrl: config().baseUrl, fetch: async (req) => {
    try {
      return await fetchImpl(req);
    } catch (e) {
      throw new SynqonixError("offline", `Cannot reach Synqonix (${(e as Error).message})`);
    }
  } });
  client.use(auth);
  // baseUrl can change in settings; openapi-fetch reads it at creation, so rebuild lazily.
  let current = config().baseUrl;
  let cached = client;
  return {
    get http() {
      const next = config().baseUrl;
      if (next !== current) {
        current = next;
        cached = createClient<paths>({ baseUrl: next, fetch: async (req) => {
          try { return await fetchImpl(req); } catch (e) { throw new SynqonixError("offline", `Cannot reach Synqonix (${(e as Error).message})`); }
        } });
        cached.use(auth);
      }
      return cached;
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Unwraps an openapi-fetch result: the data, or a `SynqonixError` describing the failure. */
export function unwrap<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.data !== undefined) return res.data;
  if (res.response.ok) return undefined as T; // 204 and friends
  throw new SynqonixError(kindOf(res.response.status), messageOf(res.error, `Request failed (${res.response.status})`), res.response.status);
}
