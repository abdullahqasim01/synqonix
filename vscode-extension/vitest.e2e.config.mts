import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Drives the extension against a running API (SYNQONIX_API, default http://localhost:4000) and a real git repository. */
export default defineConfig({
  resolve: { alias: { vscode: fileURLToPath(new URL("./test/fake-vscode.ts", import.meta.url)) } },
  test: { include: ["test/**/*.e2e.test.ts"], testTimeout: 60_000, fileParallelism: false },
});
