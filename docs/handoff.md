Date / task id: 2026-10-10 / F0.3 monorepo scaffold
Lane / files changed: D — root config (pnpm workspace, tsconfig.base, eslint, prettier, husky, commitlint), apps/web, apps/api, packages/shared, folder skeleton per doc 07
Contract changes (docs 08/09/10/36): none. Added /api/health and /api/ready placeholders (unversioned, per Prompt 1)
Decisions or [ASSUMPTION]s touched (D-numbers): none. Tooling deviations: tsx instead of ts-node-dev, tsup for api build, Node 24 / pnpm 10 locally (.nvmrc says 22; engines >=22) — add a row to doc 32 if kept
Gate line status (pass/fail): pass — lint, typecheck, test green; pnpm dev serves web :3000 and api :4000; import-boundary rule verified to fire
Next step: F0.4 local env (docker compose, lib/env.ts, .env.example — currently empty); F0.5 CI; F0.6 design tokens
Verify: pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-13 / M06 Restaurants + M07 Homemakers (API + UI + tests)
Lane / files changed: packages/shared (vendor.ts, enums.ts, index.ts), apps/api (schema.prisma, migration 20261013000001_sa2_vendors, modules/vendors core + thin restaurants/homemakers routers, app.ts mounts), apps/web (features/vendors/*, app/(super-admin)/super-admin/restaurants, sidebar href), docs 32 + this file
Contract changes (docs 08/09/10/36): none new — doc 09 vendor endpoints implemented as written (list, create, get, detail, patch, delete, status, verification, move-zone per kind); doc 08 vendor_documents table added; POST /{id}/documents deliberately returns 404 until SA-2.1 (gap covered by a test)
Decisions or [ASSUMPTION]s touched (D-numbers): none closed. Deviations logged in doc 32: TD-18 (SA-only authz seam until M03/SA-1.7), TD-19 (document upload blocked until SA-2.1), TD-20 (placeholder Menu/Orders/Documents tabs, no bulk actions)
Gate line status (pass/fail): pass — pnpm lint, pnpm typecheck (shared/api/web), pnpm test: 115 tests (shared 3, web 33, api 79 incl. 4-role authz matrix, state-machine and scope tests). Test DB on port 5432
Next step: SA-2.1 upload endpoints + Documents tab; swap apps/api/src/modules/vendors/vendor.scope.ts to can()/zonesFor when M03 lands; M08 menu tab; M11 orders tab; Playwright vendor journey (skipped here: e2e auth/vendor seeding not ready, existing zone e2e fails pre-existing)
Verify: pnpm lint && pnpm typecheck && pnpm test (TEST_DATABASE_URL=postgresql://…@localhost:5432/zoauro_admin_test)
