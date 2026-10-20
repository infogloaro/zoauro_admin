import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@zoauro/shared/audit': path.resolve(__dirname, 'packages/shared/src/audit/index.ts') } },
  test: { globalSetup: ['apps/api/tests/audit/support/global-setup.ts'], include: ['apps/api/tests/**/*.test.ts'], hookTimeout: 30000, testTimeout: 30000, fileParallelism: false },
});
