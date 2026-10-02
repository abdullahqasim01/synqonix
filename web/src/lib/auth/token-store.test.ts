import { beforeEach, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/lib/api/client", () => ({ publicApi: { POST: (...a: unknown[]) => post(...a) } }));

import { tokenStore } from "./token-store";

const ok = (n: number) => ({
  data: { accessToken: `a${n}`, refreshToken: `r${n}`, user: { id: "1" } },
  response: { status: 200 },
});

beforeEach(() => {
  post.mockReset();
  localStorage.clear();
  tokenStore.set(null);
});

it("persists tokens in localStorage", () => {
  tokenStore.set({ accessToken: "a", refreshToken: "r" });
  expect(JSON.parse(localStorage.getItem("sx_auth")!)).toEqual({ accessToken: "a", refreshToken: "r" });
  expect(tokenStore.get()).toBe("a");
  tokenStore.set(null);
  expect(localStorage.getItem("sx_auth")).toBeNull();
});

it("does nothing without a stored session", async () => {
  expect(await tokenStore.refresh()).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it("shares one refresh request between concurrent callers and stores the rotated tokens", async () => {
  tokenStore.set({ accessToken: "a0", refreshToken: "r0" });
  post.mockResolvedValue(ok(1));
  const [x, y] = await Promise.all([tokenStore.refresh(), tokenStore.refresh()]);
  expect([x, y]).toEqual(["a1", "a1"]);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ body: { refreshToken: "r0" } });
  expect(tokenStore.getRefreshToken()).toBe("r1");
});

it("clears the session when the refresh token is rejected", async () => {
  tokenStore.set({ accessToken: "a0", refreshToken: "r0" });
  post.mockResolvedValue({ data: undefined, error: { message: "bad" }, response: { status: 401 } });
  const seen = vi.fn();
  const off = tokenStore.subscribe(seen);
  expect(await tokenStore.refresh()).toBeNull();
  expect(tokenStore.hasSession()).toBe(false);
  expect(seen).toHaveBeenCalledWith(null);
  off();
});

it("keeps the session on server errors so it can retry", async () => {
  tokenStore.set({ accessToken: "a0", refreshToken: "r0" });
  post.mockResolvedValue({ data: undefined, error: { message: "boom" }, response: { status: 500 } });
  expect(await tokenStore.refresh()).toBeNull();
  expect(tokenStore.hasSession()).toBe(true);
});
