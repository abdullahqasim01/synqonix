"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { errorMessage, publicApi, type Schemas } from "@/lib/api/client";
import { tokenStore } from "./token-store";

type User = Schemas["UserDto"];
type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  status: Status;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; name: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  setUser(user: User): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const apply = useCallback((auth: Schemas["AuthResponseDto"] | null) => {
    tokenStore.set(auth?.accessToken ?? null);
    setUser(auth?.user ?? null);
    setStatus(auth ? "authenticated" : "anonymous");
  }, []);

  // Restore the session from the refresh cookie on first load; follow later refresh failures.
  useEffect(() => {
    void tokenStore.refresh().then((token) => {
      if (!token) setStatus("anonymous");
    });
    return tokenStore.subscribe(apply);
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
    await publicApi.POST("/api/v1/auth/logout", { body: {} }).catch(() => undefined);
    apply(null);
  }, [apply]);

  const value = useMemo(
    () => ({ user, status, login, register, logout, setUser }),
    [user, status, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
