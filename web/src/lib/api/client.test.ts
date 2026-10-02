import { describe, expect, it } from "vitest";
import { errorMessage } from "./client";

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
