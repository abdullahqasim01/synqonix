import type { Schemas } from "@/lib/api/client";

type AuthResponse = Schemas["AuthResponseDto"];
type Listener = (auth: AuthResponse | null) => void;

/**
 * Holds the short-lived access token in memory only (never localStorage).
 * The long-lived refresh token lives in an httpOnly cookie managed by the API.
 */
let accessToken: string | null = null;
let inflight: Promise<string | null> | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null) {
    accessToken = token;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Exchanges the refresh cookie for a new access token. Concurrent calls share one request. */
  refresh(): Promise<string | null> {
    inflight ??= (async () => {
      try {
        const { publicApi } = await import("@/lib/api/client");
        const { data } = await publicApi.POST("/api/v1/auth/refresh", { body: {} });
        accessToken = data?.accessToken ?? null;
        listeners.forEach((l) => l(data ?? null));
        return accessToken;
      } catch {
        accessToken = null;
        listeners.forEach((l) => l(null));
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
};
