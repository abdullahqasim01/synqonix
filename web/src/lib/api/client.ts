import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { tokenStore } from "@/lib/auth/token-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Unauthenticated client (login, register, refresh...). */
// Resolve fetch lazily so it can be stubbed in tests.
const lazyFetch = (request: Request) => globalThis.fetch(request);

export const publicApi = createClient<paths>({ baseUrl: API_URL, fetch: lazyFetch });

// A request body can only be read once, so keep a pristine copy to replay after a refresh.
const replayCopies = new WeakMap<Request, Request>();

const authMiddleware: Middleware = {
  onRequest({ request }) {
    replayCopies.set(request, request.clone());
    const token = tokenStore.get();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    // On 401, try to refresh once and replay the request.
    if (response.status !== 401) return response;
    const copy = replayCopies.get(request);
    if (!copy) return response;
    const fresh = await tokenStore.refresh();
    if (!fresh) return response;
    copy.headers.set("Authorization", `Bearer ${fresh}`);
    return globalThis.fetch(copy);
  },
};

/** Authenticated client: attaches the access token and transparently refreshes it. */
export const api = createClient<paths>({ baseUrl: API_URL, fetch: lazyFetch });
api.use(authMiddleware);

export type Schemas = import("./schema").components["schemas"];

/** Extracts a human-readable message from an API error body. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(", ");
    if (typeof m === "string") return m;
  }
  return fallback;
}
