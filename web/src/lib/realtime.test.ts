import { expect, it } from "vitest";
import { msUntilExpiry } from "./realtime";

const jwt = (exp: number) => `x.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.y`;

it("reads the expiry of a JWT", () => {
  const soon = Math.floor(Date.now() / 1000) + 60;
  expect(msUntilExpiry(jwt(soon))).toBeGreaterThan(55_000);
  expect(msUntilExpiry(jwt(soon))).toBeLessThanOrEqual(60_000);
  expect(msUntilExpiry(jwt(Math.floor(Date.now() / 1000) - 10))).toBeLessThan(0);
});

it("treats unreadable tokens as expired", () => {
  expect(msUntilExpiry(null)).toBe(0);
  expect(msUntilExpiry("garbage")).toBe(0);
  expect(msUntilExpiry("sqx_abc")).toBe(0);
});
