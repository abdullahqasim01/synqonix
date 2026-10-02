import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, normalizeApiUrl } from "./config";

describe("normalizeApiUrl", () => {
  it("falls back to the default", () => {
    expect(normalizeApiUrl(undefined)).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("  ")).toBe(DEFAULT_API_URL);
  });

  it("strips trailing slashes", () => {
    expect(normalizeApiUrl("https://api.example.com//")).toBe("https://api.example.com");
  });
});
