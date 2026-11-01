import { afterEach, describe, expect, it, vi } from "vitest";
import { putToPresigned, startDownload, UploadError } from "./files";

afterEach(() => vi.unstubAllGlobals());

describe("putToPresigned", () => {
  it("PUTs the file to the link with exactly the given headers and no credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const file = new Blob(["abc"]);
    await putToPresigned({ uploadUrl: "https://s3.example.com/b/k?sig=1", headers: { "Content-Type": "application/octet-stream" } }, file);
    expect(fetch).toHaveBeenCalledWith("https://s3.example.com/b/k?sig=1", { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
  });

  it("explains an expired or rejected link and a blocked (CORS) request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(putToPresigned({ uploadUrl: "https://x", headers: {} }, new Blob())).rejects.toThrow(/expired/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(putToPresigned({ uploadUrl: "https://x", headers: {} }, new Blob())).rejects.toBeInstanceOf(UploadError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(putToPresigned({ uploadUrl: "https://x", headers: {} }, new Blob())).rejects.toThrow(/500/);
  });
});

describe("startDownload", () => {
  it("clicks a temporary link to the presigned URL", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    startDownload("https://s3.example.com/b/k?sig=1", "notes.txt");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[href^='https://s3.example.com']")).toBeNull(); // removed again
    click.mockRestore();
  });
});
