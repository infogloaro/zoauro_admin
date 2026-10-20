import { defineConfig } from '@playwright/test';

// Started by run.ts (seeds the throwaway database, builds the stack, sets E2E_STATE / E2E_BASE_URL). The specs share one
// database and build on each other's state (an order walked to ASSIGNED is then delivered), so: one worker, file order.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3731',
    viewport: { width: 1440, height: 900 },
    trace: process.env['E2E_TRACE'] === '1' ? 'retain-on-failure' : 'off',
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } }
      : {}),
  },
});
