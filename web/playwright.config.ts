import { defineConfig } from "@playwright/test";

/**
 * Critical-flow tests against a running stack: API (default http://localhost:4000, with THROTTLE_DISABLED=1)
 * and the production build of the web app (`npm run build && npm start`).
 *   npm run test:e2e
 * Override with E2E_WEB_URL / E2E_API_URL.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
});
