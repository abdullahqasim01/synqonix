import { expect, it } from "vitest";
import { safeNext } from "./next";

it("allows relative paths", () => {
  expect(safeNext("/invitations/abc")).toBe("/invitations/abc");
});

it("rejects external or malformed targets", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined]) {
    expect(safeNext(bad as string | null)).toBe("/dashboard");
  }
});
