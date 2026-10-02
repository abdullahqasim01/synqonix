import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

/**
 * Runs the suite in this folder inside a real VS Code (downloaded on first use):
 *   npm run build && npm run test:vscode
 * Needs network access to update.code.visualstudio.com, so it is not part of `npm test`.
 */
async function main() {
  await runTests({
    extensionDevelopmentPath: resolve(__dirname, "../.."),
    extensionTestsPath: resolve(__dirname, "suite.js"),
    launchArgs: ["--disable-extensions"],
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
