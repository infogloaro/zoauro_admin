Date / task id: 2026-10-10 / F0.3 monorepo scaffold
Lane / files changed: D — root config (pnpm workspace, tsconfig.base, eslint, prettier, husky, commitlint), apps/web, apps/api, packages/shared, folder skeleton per doc 07
Contract changes (docs 08/09/10/36): none. Added /api/health and /api/ready placeholders (unversioned, per Prompt 1)
Decisions or [ASSUMPTION]s touched (D-numbers): none. Tooling deviations: tsx instead of ts-node-dev, tsup for api build, Node 24 / pnpm 10 locally (.nvmrc says 22; engines >=22) — add a row to doc 32 if kept
Gate line status (pass/fail): pass — lint, typecheck, test green; pnpm dev serves web :3000 and api :4000; import-boundary rule verified to fire
Next step: F0.4 local env (docker compose, lib/env.ts, .env.example — currently empty); F0.5 CI; F0.6 design tokens
Verify: pnpm lint && pnpm typecheck && pnpm test
