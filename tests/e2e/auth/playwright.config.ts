import { defineConfig } from '@playwright/test';

// Started by run.ts (which builds the stack and sets E2E_STATE / E2E_BASE_URL). PLAYWRIGHT_CHROMIUM_PATH points at an
// installed Chromium when Playwright's own download is not present.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1, // one database, rate limits per IP: one browser at a time
  timeout: 120_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3721',
    trace: process.env['E2E_TRACE'] === '1' ? 'retain-on-failure' : 'off',
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } }
      : {}),
  },
});
