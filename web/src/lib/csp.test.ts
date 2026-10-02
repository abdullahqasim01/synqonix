import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

describe("buildCsp", () => {
  const csp = buildCsp({ nonce: "abc123", apiUrl: "https://api.example.com" });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("only runs scripts that carry the nonce, with no unsafe-inline or eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("allows the API (https and the websocket) and nothing else remote", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://api.example.com wss://api.example.com");
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("blocks framing, plugins and base-tag tricks", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("uses ws:// for a plain-http API and relaxes only what development needs", () => {
    const dev = buildCsp({ nonce: "n", apiUrl: "http://localhost:4000", dev: true });
    expect(dev).toContain("ws://localhost:4000");
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});
