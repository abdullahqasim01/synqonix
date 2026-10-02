import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { tokenStore } from "@/lib/auth/token-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Unauthenticated client (login, register, refresh...). Sends the httpOnly refresh cookie. */
export const publicApi = createClient<paths>({ baseUrl: API_URL, credentials: "include" });

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = tokenStore.get();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    // On 401, try to refresh once and replay the request.
    if (response.status !== 401 || request.headers.get("x-retried")) return response;
    const fresh = await tokenStore.refresh();
    if (!fresh) return response;
    const retry = request.clone();
    retry.headers.set("Authorization", `Bearer ${fresh}`);
    retry.headers.set("x-retried", "1");
    return fetch(retry);
  },
};

/** Authenticated client: attaches the access token and transparently refreshes it. */
export const api = createClient<paths>({ baseUrl: API_URL, credentials: "include" });
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
