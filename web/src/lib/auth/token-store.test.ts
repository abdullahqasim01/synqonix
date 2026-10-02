import { beforeEach, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/lib/api/client", () => ({ publicApi: { POST: (...a: unknown[]) => post(...a) } }));

import { tokenStore } from "./token-store";

beforeEach(() => {
  post.mockReset();
  tokenStore.set(null);
});

it("shares one refresh request between concurrent callers", async () => {
  post.mockResolvedValue({ data: { accessToken: "tok", user: { id: "1" } } });
  const [a, b] = await Promise.all([tokenStore.refresh(), tokenStore.refresh()]);
  expect(a).toBe("tok");
  expect(b).toBe("tok");
  expect(post).toHaveBeenCalledTimes(1);
  expect(tokenStore.get()).toBe("tok");
});

it("clears the token and notifies listeners when refresh fails", async () => {
  tokenStore.set("old");
  post.mockResolvedValue({ data: undefined, error: { message: "bad" } });
  const seen = vi.fn();
  const off = tokenStore.subscribe(seen);
  expect(await tokenStore.refresh()).toBeNull();
  expect(tokenStore.get()).toBeNull();
  expect(seen).toHaveBeenCalledWith(null);
  off();
});
