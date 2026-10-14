import { defineConfig } from 'tsup';

// Production build of the API and the worker (doc 56 P20). The workspace packages (@zoauro/shared) export TypeScript
// source, which plain `node` cannot load, so they are bundled into dist; real npm dependencies (express, prisma, zod …)
// stay external and are resolved from node_modules as usual.
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node22',
  platform: 'node',
  noExternal: [/^@zoauro\//],
  clean: true,
  sourcemap: true,
});
