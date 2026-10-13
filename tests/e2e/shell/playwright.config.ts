import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// P14 shell smoke (doc 56): signed-out redirects only, so no API or database is started. The web app is the production
// build, on an uncommon port (other projects use 3000/3100 on developer machines). WEB_INTERNAL_API_URL points nowhere:
// without a session cookie the server never calls the API, and this suite must prove that.
//   pnpm e2e:shell

const PORT = Number(process.env['E2E_SHELL_PORT'] ?? 3722);
const root = path.resolve(__dirname, '../../..');
const chromium = path.join(
  process.env['LOCALAPPDATA'] ?? '',
  'ms-playwright/chromium-1234/chrome-win64/chrome.exe',
);
const executablePath =
  process.env['PLAYWRIGHT_CHROMIUM_PATH'] ?? (existsSync(chromium) ? chromium : undefined);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `pnpm --dir apps/web exec next build && pnpm --dir apps/web exec next start -p ${PORT}`,
    cwd: root,
    port: PORT, // `/` answers 307 to /login, which is a 404 until P15: wait for the port, not a 2xx
    reuseExistingServer: false,
    timeout: 300_000,
    env: { WEB_INTERNAL_API_URL: 'http://127.0.0.1:9' },
  },
});
