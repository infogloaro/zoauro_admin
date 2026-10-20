import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // jsdom + userEvent tests are slow when every file runs in parallel on the 8 GB machine
    testTimeout: 20_000,
  },
});
