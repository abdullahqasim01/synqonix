"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, publicApi, type Schemas } from "@/lib/api/client";
import { tokenStore } from "./token-store";

type User = Schemas["UserDto"];
type Status = "loading" | "authenticated" | "anonymous" | "error";

interface AuthContextValue {
  user: User | null;
  status: Status;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; name: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  setUser(user: User): void;
  /** Re-checks the stored session (e.g. after a transient network failure). */
  retry(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const restoreRef = useRef<() => void>(() => {});

  const apply = useCallback((auth: Schemas["AuthResponseDto"] | null) => {
    tokenStore.set(auth);
    setUser(auth?.user ?? null);
    setStatus(auth ? "authenticated" : "anonymous");
  }, []);

  // Restore the session from the stored tokens on first load; follow later refresh failures
  // and sign-ins/outs performed in other tabs.
  useEffect(() => {
    const restore = async () => {
      if (!tokenStore.hasSession()) return setStatus("anonymous");
      // The API client refreshes an expired access token and replays the request.
      const { data } = await api.GET("/api/v1/users/me").catch(() => ({ data: undefined }));
      if (data) {
        setUser(data);
        setStatus("authenticated");
      } else {
        // Tokens cleared => the session really ended. Otherwise it was a transient failure.
        setStatus(tokenStore.hasSession() ? "error" : "anonymous");
      }
    };
    restoreRef.current = () => {
      setStatus("loading");
      void restore();
    };
    void restore();
    const off = tokenStore.subscribe(apply);
    const offTabs = tokenStore.onExternalChange(() =>
      tokenStore.hasSession() ? void restore() : apply(null),
    );
    return () => {
      off();
      offTabs();
    };
  }, [apply]);

  const login = useCallback<AuthContextValue["login"]>(async (email, password) => {
    const { data, error } = await publicApi.POST("/api/v1/auth/login", { body: { email, password } });
    if (!data) throw new Error(errorMessage(error, "Invalid email or password"));
    apply(data);
  }, [apply]);

  const register = useCallback<AuthContextValue["register"]>(async (input) => {
    const { data, error } = await publicApi.POST("/api/v1/auth/register", { body: input });
    if (!data) throw new Error(errorMessage(error));
    apply(data);
  }, [apply]);

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    apply(null);
    if (refreshToken) {
      await publicApi.POST("/api/v1/auth/logout", { body: { refreshToken } }).catch(() => undefined);
    }
  }, [apply]);

  const value = useMemo(
    () => ({ user, status, login, register, logout, setUser, retry: () => restoreRef.current() }),
    [user, status, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
