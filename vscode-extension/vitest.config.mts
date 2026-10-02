import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { vscode: fileURLToPath(new URL("./test/fake-vscode.ts", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 },
});
