import { describe, expect, it } from "vitest";
import { callbackUrl, parseState, schemeFrom } from "./vscode-connect";

describe("vscode connect", () => {
  it("accepts only hex state values", () => {
    expect(parseState("a".repeat(32))).toBe("a".repeat(32));
    for (const bad of [null, "", "short", "zz".repeat(16), "a".repeat(32) + "&x=1", "a".repeat(65)]) expect(parseState(bad)).toBeNull();
  });

  it("builds a callback to the extension's own address only", () => {
    expect(callbackUrl("sqx_abc", "ab".repeat(16))).toBe(`vscode://synqonix.synqonix/auth?token=sqx_abc&state=${"ab".repeat(16)}`);
    expect(callbackUrl("sqx_abc", "ab".repeat(16), "vscode-insiders")).toMatch(/^vscode-insiders:\/\/synqonix\.synqonix\/auth\?/);
  });

  it("falls back to stable VS Code for any other scheme", () => {
    expect(schemeFrom("javascript")).toBe("vscode");
    expect(schemeFrom("https")).toBe("vscode");
    expect(schemeFrom("vscode-insiders")).toBe("vscode-insiders");
  });
});
