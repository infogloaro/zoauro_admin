# M04 Audit and Logs — verified reference implementation (v1.1)

Companion to `docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md`. The folders mirror the monorepo paths, so files copy straight in.
**This is not a finished module.** It is the part that can be built and proven without the rest of the foundation (monorepo, Prisma client, session auth, AuthContext), which your repository does not have yet (only doc 49 Prompt 0 has run).

## What is in here
| Path | What | Doc 50 |
|---|---|---|
| `packages/shared/src/audit/` | Action catalogue (about 100 actions), zone rules, Zod schemas for list query / item / detail | §4, §8 |
| `apps/api/src/lib/audit/` | Write path: context (AsyncLocalStorage), `record` / `recordMany` / `recordDenied`, diff, redaction registry, schema walker, UUID v7 + date bounds, denied rate limiter, coverage guard + Express middleware | §2.1, §5, §6, §7 |
| `apps/api/src/modules/audit/` | Read-path rules only: `canSeeRow`, `zonalPredicate`, `planAuditList`, `entityModeNotFound`, mapper. **No routes, controller or repository yet** | §2.2, §8 |
| `apps/api/prisma/audit.model.prisma` | Model and enums to paste into `schema.prisma` | §3.1 |
| `apps/api/prisma/migrations/…_audit_guard/` | Roles check, grants, append-only trigger, TRUNCATE trigger, both tables | §3.2 |
| `apps/api/prisma/migrations/…_audit_search_indexes/` | Expression indexes for `q` | §3.1 |
| `docker/initdb/01-roles.sql` | Local roles `zoauro_owner`, `zoauro_app`, `zoauro_purge` | §3.2 |
| `apps/api/tests/audit/` | 70 tests + 13 performance tests | §12, §18 |

## Run it
```bash
npm install
npm test                 # needs PostgreSQL 16 on 127.0.0.1:5432 with user postgres/postgres, or set PG_ADMIN_URL
npm run typecheck
npm run test:perf        # seeds 2,000,000 rows, about 2 minutes
```
The tests create a throwaway database `zoauro_m04_test` (dropped and recreated on every run) and never touch another one.

## Put it in the repository
Use Phase 0.6 of the guide (a ready-made Claude Code prompt). Order: doc 49 Prompts 1, 2, 3, 5, 6 first, then Phase 0.5 doc amendments, then Phase 0.6.

## Prisma adapter (not tested here: no Prisma in this environment)
`record(tx, …)` needs `tx.auditLog.create` / `createMany`. The Prisma transaction client has both. Two things to check on first compile:
1. Rows leave the service with `beforeJson` / `afterJson` **absent** when empty (never `null`), which Prisma stores as SQL NULL. Do not map them to `Prisma.JsonNull`.
2. `id` is supplied by the service (UUID v7), so declare `@id @db.Uuid` without `@default`.
```ts
// apps/api/src/lib/db.ts  (shape only)
export const auditTx = (tx: Prisma.TransactionClient): AuditTx => tx as unknown as AuditTx;
```
If the compiler rejects the structural fit, wrap with a two-method adapter; do not loosen the `AuditRow` type.

## Decisions this build forced (all recorded in doc 50 §16/§18 and doc 03 D63–D64)
1. A third DB role `zoauro_purge` for the retention job (v1 of the guide made deletion impossible).
2. Sixth index and two expression indexes; date filters must also send an id range.
3. Diff raw values, then redact; dropped secrets keep their key with `[redacted]`.
4. `ZONAL_HIDDEN_AUDIT_MODULES` also contains `admins`, `auth`, `system` (defence in depth; `can()` would already refuse most of them).
5. Allow-listed "no audit row" reasons: `logout`, `token-refresh`, `health`, `login`, `reauth`. **Review `login` and `reauth`:** they are my addition so the coverage guard does not flag M01's own routes.
6. Customers/payouts/payments must pass `zoneId` explicitly (D63 is **Assumed**; confirm before the customers module).

## Not done (still to build with the guide's prompts)
Routes/controller/repository on Prisma (AU-4), `ActivityTab` and System Logs UI (AU-6/7, no Figma frames), CSV export (AU-8), archive/purge jobs (AU-5), adoption by each module (Phase 9), HTTP-level authorization tests, and the checks that need other modules (TC-AUD-17, 22, 23).

## Handoff block (append to docs/handoff.md)
```
## 2026-10-10 M04 Audit — verified bundle delivered (not yet in repo)
Done: shared catalogue + schemas, lib/audit (write path, redaction, diff, ids, rate limiter, coverage guard), read-path rules, guard + search-index migrations, 70 tests, 13 perf tests (2M rows), 9 mutation checks.
Not done: anything needing the monorepo/Prisma/auth (see README "Not done").
Decisions: D63 (Assumed, customer zone rule), D64 (purge role). New env: DATABASE_URL_MIGRATE, DATABASE_URL_AUDIT_PURGE.
Next: doc 49 Prompts 1,2,3,5,6 -> doc 50 Phase 0.5 -> Phase 0.6 adopt bundle -> AU-3 wiring -> AU-4 routes.
```
