import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, errorMessage } from "./client";
import { tokenStore } from "@/lib/auth/token-store";

describe("errorMessage", () => {
  it("reads a string message", () => {
    expect(errorMessage({ message: "Nope" })).toBe("Nope");
  });
  it("joins validation message arrays", () => {
    expect(errorMessage({ message: ["a must be an email", "b is required"] })).toBe("a must be an email, b is required");
  });
  it("falls back for unknown shapes", () => {
    expect(errorMessage(undefined, "Oops")).toBe("Oops");
  });
});

describe("authenticated client", () => {
  const calls: { url: string; auth: string | null; body: string }[] = [];

  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    tokenStore.set({ accessToken: "old", refreshToken: "r0" });
    vi.stubGlobal("fetch", async (input: Request) => {
      calls.push({ url: input.url, auth: input.headers.get("authorization"), body: await input.clone().text() });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (input.url.endsWith("/auth/refresh")) {
        return json(200, { accessToken: "new", refreshToken: "r1", user: { id: "1" } });
      }
      return input.headers.get("authorization") === "Bearer new" ? json(200, { ok: true }) : json(401, { message: "expired" });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes on 401 and replays a POST with its body intact", async () => {
    const { data } = await api.POST("/api/v1/auth/change-password", {
      body: { currentPassword: "a", newPassword: "bbbbbbbb" },
    });
    expect(data).toBeDefined();
    const replays = calls.filter((c) => c.url.endsWith("/change-password"));
    expect(replays).toHaveLength(2);
    expect(replays[0].auth).toBe("Bearer old");
    expect(replays[1].auth).toBe("Bearer new");
    expect(replays[1].body).toBe(replays[0].body);
    expect(replays[1].body).toContain("bbbbbbbb");
    expect(tokenStore.getRefreshToken()).toBe("r1");
  });
});
