import { defineConfig } from '@playwright/test';

// Started by run.ts (which builds the stack and sets E2E_STATE / E2E_BASE_URL). PLAYWRIGHT_CHROMIUM_PATH points at an
// installed Chromium when Playwright's own download is not present.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1, // one shared database, one logged-in user at a time, honest timings
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3720',
    // tracing snapshots the DOM around every action and distorts the timings this suite exists to measure: opt in
    trace: process.env['E2E_TRACE'] === '1' ? 'retain-on-failure' : 'off',
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } }
      : {}),
  },
});
