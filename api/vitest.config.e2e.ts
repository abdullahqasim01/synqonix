import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Read when AppModule is imported, so it must be set here rather than inside a test file.
    env: { UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'sx-uploads-')), MAX_UPLOAD_MB: '1', GITHUB_WEBHOOK_SECRET: 'test-webhook-secret', WEB_URL: 'http://localhost:3000' },
    fileParallelism: false, // suites share one database
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
