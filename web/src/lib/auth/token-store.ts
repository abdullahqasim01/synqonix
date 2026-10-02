import type { Schemas } from "@/lib/api/client";

type AuthResponse = Schemas["AuthResponseDto"];
type Listener = (auth: AuthResponse | null) => void;
interface Tokens { accessToken: string; refreshToken: string }

/**
 * Tokens are persisted in localStorage so sessions survive reloads and are shared between tabs.
 * Any script running on the page can read them, so the app must stay free of XSS
 * (no dangerouslySetInnerHTML with user content, strict CSP, vetted dependencies).
 */
const KEY = "sx_auth";
const LOCK = "sx-token-refresh";
const listeners = new Set<Listener>();
let memory: Tokens | null = null; // fallback when localStorage is unavailable
let inflight: Promise<string | null> | null = null;

function read(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return memory;
  }
}

function write(tokens: Tokens | null) {
  memory = tokens;
  try {
    if (tokens) localStorage.setItem(KEY, JSON.stringify(tokens));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the in-memory copy is used */
  }
}

/** Runs `fn` exclusively across tabs so concurrent refreshes cannot reuse a rotated token. */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(LOCK, fn);
  }
  return fn();
}

export const tokenStore = {
  get: () => read()?.accessToken ?? null,
  getRefreshToken: () => read()?.refreshToken ?? null,
  hasSession: () => read() !== null,
  /** Stores the tokens from a login/register/refresh response (or clears them with null). */
  set(auth: Pick<AuthResponse, "accessToken" | "refreshToken"> | null) {
    write(auth ? { accessToken: auth.accessToken, refreshToken: auth.refreshToken } : null);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Called when another tab changes the stored session (sign-in, sign-out, refresh). */
  onExternalChange(cb: () => void) {
    const handler = (e: StorageEvent) => e.key === KEY && cb();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
  /**
   * Exchanges the refresh token for new tokens. Concurrent callers (and other tabs) share one
   * request: if another caller already rotated the tokens while we waited, we reuse its result.
   */
  refresh(): Promise<string | null> {
    const before = read();
    if (!before) return Promise.resolve(null);
    inflight ??= exclusive(async () => {
      try {
        const current = read();
        if (!current) return null;
        if (current.accessToken !== before.accessToken) return current.accessToken; // refreshed elsewhere
        const { publicApi } = await import("@/lib/api/client");
        const { data, error, response } = await publicApi.POST("/api/v1/auth/refresh", {
          body: { refreshToken: current.refreshToken },
        });
        if (data) {
          write({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          listeners.forEach((l) => l(data));
          return data.accessToken;
        }
        // Only a definitive rejection ends the session; network errors keep it for a retry.
        const status: number = response.status;
        if (error && (status === 401 || status === 400)) {
          write(null);
          listeners.forEach((l) => l(null));
        }
        return null;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    });
    return inflight;
  },
};
