# 51 — Audit and Logs: build it from scratch (one sequence, copy-paste)

Replaces "Phase 0.5" and "Phase 0.6" of doc 50 §15, which were hard to run. Nothing here asks Claude Code to edit documents: you copy the right documents in yourself (Step 0). Use only these three inputs:

| Input | What it is |
|---|---|
| `Zoauro-DevReady-Pack-v2.3.zip` | All documents. Doc 50 inside is the specification of this module |
| `Zoauro-M04-Audit-Bundle.zip` | Tested reference code for the module (70 tests, 13 performance tests) |
| This file | The prompts, in order |

Rules for every prompt: paste it in a **new Claude Code session at the repo root**, start in plan mode (Shift+Tab), read the plan, approve, then run `pnpm lint && pnpm typecheck && pnpm test`. Commit only when green. One prompt = one commit (or one PR). Do not skip a prompt; each one depends on the one before.

---
## Step 0 — Set up the repository (you do this, no Claude Code)

0.1 Check where you are:
```bash
git status            # should be clean; commit or stash anything else first
git log --oneline | head
```
0.2 Put the documents in `docs/` (overwrite; this also fixes a half-applied earlier attempt). Do **not** delete `docs/handoff.md` or `docs/design/`.
```bash
mkdir -p /tmp/zoauro-pack && unzip -o Zoauro-DevReady-Pack-v2.3.zip -d /tmp/zoauro-pack
mkdir -p docs && cp -R /tmp/zoauro-pack/Zoauro-DevReady-Pack/* docs/
cp /tmp/zoauro-pack/Zoauro-DevReady-Pack/AGENTS.md ./AGENTS.md && rm -f docs/AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
touch docs/handoff.md
```
0.3 Put the reference code in `docs/F-execution/m04-bundle/` (reference only, never imported by the app):
```bash
mkdir -p /tmp/zoauro-m04 && unzip -o Zoauro-M04-Audit-Bundle.zip -d /tmp/zoauro-m04
mkdir -p docs/F-execution/m04-bundle && cp -R /tmp/zoauro-m04/Zoauro-M04-Audit-Bundle/* docs/F-execution/m04-bundle/
```
0.4 Check the copy worked (all three must print a match):
```bash
grep -c "D64" docs/A-product/03_Business_Rules_and_Decision_Register.md
grep -c "Build status and evidence" docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md
ls docs/F-execution/m04-bundle/apps/api/src/lib/audit | head -3
```
0.5 Commit: `git add -A && git commit -m "docs: pack v2.3 and M04 reference bundle"`

0.6 Decisions (write the answers into `docs/A-product/03_*` by hand, change "Assumed" to "Decided"): D16 stack, D17 separate repo/DB from the CRM, D18 do the apps exist (greenfield = yes, use the Integration API), D41 access per member per zone, **D63** (customer audit rows carry the zone where the action happened; zone-less rows are visible to Super Admin only). Doc 49 Part F has a reply you can reuse for the first four.

Tools needed on your computer: Node 22, pnpm 9, Docker Desktop, Git, Claude Code.

---
## Stage A — Foundation the audit module stands on

### Prompt A1 — Monorepo scaffold (doc 49 Prompt 1, task F0.3)
```
Task F0.3 from docs/F-execution/33_Shared_Foundation_Plan.md. Lane D.
Load only: AGENTS.md, docs/B-architecture/06_*, 07_*, 12_*.
Create the pnpm monorepo: apps/web (Next.js App Router, TypeScript strict, Tailwind), apps/api (Express, TypeScript strict, ts-node-dev for dev, separate src/worker.ts entry), packages/shared (Zod, enums, permission keys, money helpers). The shared package name must be @zoauro/shared. TypeScript options: strict, noUncheckedIndexedAccess, noImplicitOverride.
Root: ESLint with import-boundary rules (apps/web must not import from apps/api or Prisma; only repository files may import Prisma), Prettier, Husky pre-commit (lint-staged), commitlint (conventional commits), tsconfig base, .editorconfig, .gitignore, .nvmrc.
Scripts: dev, build, lint, typecheck, test (Vitest), db:migrate, db:seed.
Add /api/health and /api/ready placeholders and one smoke test per app.
Do not add features, auth or database tables yet.
Done when: pnpm install && pnpm lint && pnpm typecheck && pnpm test pass; pnpm dev starts web on 3000 and api on 4000.
At the end append a handoff block to docs/handoff.md.
```
**Check before moving on:** the four commands pass; `ls apps packages` shows web, api, shared; `grep '"name"' packages/shared/package.json` prints `@zoauro/shared`.

### Prompt A2 — Local infrastructure with the three database roles (task F0.4 + audit roles)
```
Task F0.4 plus the database roles needed by the Audit module. Lane D.
Load only: AGENTS.md, docs/B-architecture/12_*, docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md section 3.2, and docs/F-execution/m04-bundle/docker/initdb/01-roles.sql.
1) docker-compose.dev.yml with PostgreSQL 16, Redis 7, MinIO (with a bucket-creation init), Mailpit. Mount an init folder (infra/initdb/) into PostgreSQL.
2) infra/initdb/01-roles.sql: start from the bundle file (roles zoauro_owner with CREATEDB, zoauro_app, zoauro_purge; dev passwords only). The init must also create the database "zoauro" owned by zoauro_owner, and then, connected to it, run:
   GRANT USAGE ON SCHEMA public TO zoauro_app, zoauro_purge;
   ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoauro_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zoauro_app;
   (zoauro_purge gets nothing by default; the audit migration gives it the two audit tables.)
3) apps/api/src/lib/env.ts validating every variable in doc 12 with Zod at boot, failing fast with a readable message. Variables: DATABASE_URL (role zoauro_app), DATABASE_URL_MIGRATE (role zoauro_owner, used only by prisma commands and CI), DATABASE_URL_AUDIT_PURGE (role zoauro_purge, optional in dev, required for the worker in production). Add .env.example files without secrets.
4) Make db:migrate run Prisma with DATABASE_URL set from DATABASE_URL_MIGRATE. The API and worker must use DATABASE_URL only.
5) Scripts pnpm infra:up / infra:down.
Done when: pnpm infra:up starts the four services; "psql -U zoauro_app" and "psql -U zoauro_owner" both connect; the API refuses to start with a missing variable; /api/ready reports DB and Redis reachable.
Do not run anything against a real or cloud database.
```
**Check:** `docker compose -f docker-compose.dev.yml ps` shows 4 healthy services; `pnpm --filter api dev` starts; unset a variable and confirm it stops with a clear message.
*If the database volume already existed before this prompt, the init script does not run again: run `pnpm infra:down -v` once to recreate it (this deletes local data only).*

### Prompt A3 — Full Prisma schema, including the audit tables (task F1.1)
```
Task F1.1. Lane D. Only the schema gatekeeper (Dev 1) runs this.
Load: AGENTS.md, docs/B-architecture/08_Database_Schema_and_Data_Dictionary.md (ALL of it), docs/B-architecture/10_* (enums only), docs/A-product/04_* (module keys), docs/G-integration/44_* if doc 08 refers to it.
Write apps/api/prisma/schema.prisma for EVERY table and enum in doc 08: the base tables, the access tables (access_profiles, profile_permissions, admin_zone_assignments with limits, assignment_overrides, access_changes), and the integration tables and column additions. Use UUID ids (v7 generated by the application, no database default), created_at/updated_at/deleted_at, money as integer paise.
EXCEPTION for audit_logs: do not derive it from doc 08. Copy the enums AuditActorType, AuditOutcome, AuditSensitivity and the model AuditLog exactly from docs/F-execution/m04-bundle/apps/api/prisma/audit.model.prisma (six indexes included).
Generate the first migration with "prisma migrate dev --name init" using DATABASE_URL_MIGRATE. Do not create seed data or application code. If doc 08 is ambiguous, list the ambiguity in the handoff block; do not guess.
Done when: prisma validate and migrate succeed on an empty database; a script lists every table of doc 08 and confirms it exists; the audit_logs table has the six indexes (show \d audit_logs).
```
**Check:** `psql -U zoauro_owner zoauro -c '\d audit_logs'` lists 19 columns and six indexes plus the primary key.

### Prompt A4 — Audit database guard migrations (AU-1)
```
Task AU-1. Lane D. Load only: docs/F-execution/50_* section 3 (read 3.1 and 3.2 completely), and the two SQL files under docs/F-execution/m04-bundle/apps/api/prisma/migrations/.
Create TWO new Prisma migrations whose SQL is copied from the bundle. IMPORTANT: do not copy the bundle's folder names (their timestamps sort before your init migration and would fail). Instead run:
  pnpm prisma migrate dev --create-only --name audit_guard
  pnpm prisma migrate dev --create-only --name audit_search_indexes
(using DATABASE_URL_MIGRATE) and paste the bundle SQL into each new migration.sql, in that order. Do not edit the SQL. Then apply with "prisma migrate dev".
Then write apps/api/tests/audit/guard.test.ts for TC-AUD-7 and TC-AUD-8 by adapting docs/F-execution/m04-bundle/apps/api/tests/audit/guard.test.ts. The tests must connect as zoauro_owner, zoauro_app and zoauro_purge to a throwaway database created for the test run (copy the approach of the bundle's support/db.ts, but build the schema with "prisma migrate deploy" instead of the bundle's hand-written DDL). Do not weaken any assertion.
Done when: as zoauro_app UPDATE, DELETE, TRUNCATE, DISABLE TRIGGER and DROP TRIGGER on audit_logs and access_changes fail; INSERT and SELECT work; the purge-role cases pass; the owner is stopped by the trigger.
```
**Check:** `pnpm test` shows the guard tests (18 tests: 9 per table). Then do this one manual mutation: temporarily delete one `CREATE TRIGGER` line from the new migration in a scratch database and confirm a test fails (the bundle did this; do it once in your repo so you trust the setup).

### Prompt A5 — Adopt the audit write path (AU-2)
```
Task AU-2. Lane A + D. Load only: docs/F-execution/50_* sections 2.1, 4, 5, 6, 7; AGENTS.md; and the bundle folder docs/F-execution/m04-bundle/.
Adopt the verified bundle code; do not regenerate it from the description.
1) Copy docs/F-execution/m04-bundle/packages/shared/src/audit/ to packages/shared/src/audit/ and export it from the package (subpath "@zoauro/shared/audit" and the package index).
2) Copy docs/F-execution/m04-bundle/apps/api/src/lib/audit/ to apps/api/src/lib/audit/ (all files). Keep file names. In shared.ts the import specifier is already "@zoauro/shared/audit"; make that resolve in this repo (package exports + tsconfig paths if needed). Change only import specifiers and nothing else.
3) Make it compile with the repo rules: the Prisma transaction client must satisfy the AuditTx interface (apps/api/src/lib/audit/audit.service.ts). Do NOT loosen AuditRow. If Prisma's types reject it, write a small adapter function in apps/api/src/lib/db.ts. Absent JSON fields stay undefined (never Prisma.JsonNull).
4) Copy the unit tests (diff-redact.test.ts, service.test.ts, coverage.test.ts) to apps/api/tests/audit/. service.test.ts uses a stand-in table test_restaurants: create it inside the test setup with SQL, not in schema.prisma. Add devDependencies to apps/api: pg, @types/pg, supertest, @types/supertest, express types if missing. The schema-walker test must additionally run once against the REAL prisma/schema.prisma: add a test that fails if findUncoveredSecretLikeColumns() returns anything; if it does, report each column and propose the registry change (drop/mask/allow-list) instead of silently allow-listing.
Do not add routes, middleware wiring or retrofits yet.
Done when: pnpm lint && pnpm typecheck && pnpm test pass; TC-AUD-1 to TC-AUD-6, 16, 20, 21, 26, 27 pass; ESLint import boundaries still pass (only repositories import Prisma: lib/audit must not import Prisma).
```
**Check:** open `apps/api/src/lib/audit/index.ts` and confirm it exports `record`, `createAudit`, `runAsSystem`, `runWithAuditContext`, `uuidv7`, `uuidv7Bounds`. If the "real schema walker" test lists columns, read each one before approving the change.

### Prompt A6 — Session authentication, writing audit rows (doc 49 Prompt 5, task F1.2)
```
Task F1.2. Lane A (module auth). Load: AGENTS.md, docs/C-security/14_* sections 1-3, docs/C-security/13_* (T1-T10), docs/B-architecture/09_* (auth endpoints), docs/B-architecture/08_* (users, sessions, login_history), docs/F-execution/50_* sections 2.1 and 4 (auth actions only).
Implement POST /auth/login, /auth/logout, /auth/forgot-password, /auth/reset-password, /auth/reauth, GET /me (stub permissions for now). Argon2id hashing; Redis-backed opaque sessions in an HTTP-only Secure SameSite=Lax cookie; idle 30 min, absolute 12 h; lockout after 5 failures for 30 minutes (D37); generic error messages; first-login forced password change; CSRF token on state-changing requests; login rate limiting; login_history rows. The login request carries the selected tab (SUPER_ADMIN or ZONAL_ADMIN); a credential used on the wrong tab is rejected with the same generic error.
Audit (use lib/audit from AU-2, inside the same transaction as the change): user.password_changed, user.password_reset_requested, user.locked, user.unlocked, session.revoked, reauth.failed. For flows with no signed-in user (forgot/reset password, lockout) wrap the work in runWithAuditContext with the target user as actor (type USER). Successful login and logout write login_history only; declare them audit: { none: 'login' } / { none: 'logout' }.
Tests: TC-AUTH-1..5 from docs/E-quality-ops/24_* (lockout is 30 minutes), a cookie-flags test, and one audit-row assertion per audited action.
Do not build 2FA (SA-7.2). Do not wire the coverage middleware yet (that is AU-3).
```
**Check:** log in on both tabs; fail 5 times and confirm the lock; query `select action, actor_name, outcome from audit_logs order by id desc limit 10;` and see your attempts.

### Prompt A7 — AuthContext, access resolver, scope-aware repositories (doc 49 Prompt 6, task F1.3)
```
Task F1.3. Lane A + D. Load: AGENTS.md, docs/C-security/14_* section 4, docs/A-product/04_* (all), docs/F-execution/36_* sections 1 and 5, docs/B-architecture/08_* (access tables).
Implement AuthContext { userId, role, permissionsByZone, limitsByZone, requestedZoneIds } built on every request (never stored in the session); can(ctx, 'module:action', zoneId) and zonesFor(ctx, 'module:view'); the resolver (profile permissions + GRANT/DENY overrides, deny wins, non-grantable modules blocked for Zonal Admin); Redis cache of at most 60 seconds with explicit invalidation; requirePermission(module, action) route guard; BaseRepository whose every query applies zone_id IN zonesFor(...). Read in an unassigned zone or unviewable module gives 404; a write without the action gives 403.
FIRST write the "leaky repository" test: a deliberately unscoped repository that the authorization harness must detect and fail.
Audit: access changes are done later by the Access Control module; here only the resolver. Do not write audit calls in this prompt.
Done when: unit tests for TC-AC-5 and TC-AC-6 pass and the leaky-repository test fails as intended when scoping is removed.
```

### Prompt A8 — Platform plumbing and the authorization harness (doc 49 Prompt 7, tasks F1.4–F1.7)
```
Tasks F1.4, F1.5, F1.6, F1.7, in that order, one commit each. Lane A + D. Load: AGENTS.md, docs/B-architecture/09_*, docs/E-quality-ops/24_* section 2, docs/F-execution/36_* section 6.
F1.4: the audit service is ALREADY built (lib/audit): do not create another. Build AppError and the error middleware with the error codes of doc 09, pagination/filter helpers (cursor and page), and idempotency middleware (Idempotency-Key header, 24 h, request hash).
F1.5: generate OpenAPI 3.1 from the shared Zod schemas, publish /api/v1/openapi.json, generate a typed client package, fail CI if the committed spec differs. Every mutating operation must carry an "x-audit" extension: either { module, action } from the audit catalogue or { none: "<reason>" } with a reason from AUDIT_NONE_REASONS. Add the existing auth routes.
F1.6: authorization matrix harness. Fixtures: zones A, B, C; actors SuperAdmin, Admin(A full), Admin(A+B: full in A, read-only in B), Admin(A, payments denied), Admin(none). It reads the OpenAPI file and auto-generates 401/403/404/200 expectations per route.
F1.7: seed script: default access profiles (Zone Manager, Operations, Support, Finance View, Read Only), the permission matrix of doc 04, the first Super Admin from INITIAL_SUPERADMIN_*.
Done when: the harness runs in CI and lists every route it covers; pnpm lint && pnpm typecheck && pnpm test pass.
```

---
## Stage B — The Audit and Logs module itself

### Prompt B1 — Wire the context, route metadata and coverage guard (AU-3)
```
Task AU-3. Lane A. Load only: docs/F-execution/50_* section 2.1; docs/B-architecture/09_* conventions; AGENTS.md; apps/api/src/lib/audit/middleware.ts and coverage.ts.
1) Install auditContextMiddleware after authentication; resolveActor builds { type: 'USER', id, name, role } from the session user (name is a snapshot of the display name); getRequestId uses the request id middleware (add one if missing). Routes with no signed-in user stay without a context.
2) Every existing mutating route declares audit metadata with auditMeta({ module, action }) or auditMeta({ none: reason }), and the same value goes into the OpenAPI "x-audit" extension generated from one place (no duplication).
3) Install auditCoverage({ mode: 'throw' }) when NODE_ENV=test and mode 'log' (using the app logger) otherwise.
4) Extend the authorization harness (F1.6): call checkOpenApiAuditMetadata(spec) and fail the run if it returns anything.
5) Retrofit any mutating route that still lacks an audit call (auth routes were done in A6).
Tests: TC-AUD-19 against the real app (a temporary test-only route without metadata must make the run fail), TC-AUD-27.
Done when: pnpm test passes, and deleting the auditMeta line of one real route makes the harness fail.
```
**Check:** do that last "delete a line" experiment yourself, then undo it.

### Prompt B2 — Read API (AU-4)
```
Task AU-4. Lane A. Load only: docs/F-execution/50_* sections 2.2, 8 and 3.1 (index notes); docs/C-security/14_* section 4; docs/F-execution/36_* section 5; AGENTS.md; apps/api/src/modules/audit/ (visibility.ts and mapper.ts already exist from the bundle - copy them now from docs/F-execution/m04-bundle/apps/api/src/modules/audit/ if they are not in apps/api yet).
Implement modules/audit: routes, controller, service, repository, permissions, index. Endpoints exactly as doc 50 §8: GET /audit-logs, GET /audit-logs/{id}, GET /audit-logs/catalogue, GET /login-history, GET /me/login-history. No write endpoints.
Rules: use planAuditList() to decide 403 / ALL / ENTITY mode; build an AuditViewer from AuthContext (can -> can(ctx, perm, zoneId); zonesFor -> zonesFor(ctx, perm)); in entity mode apply the zonalPredicate as "(module = m AND zone_id IN zones) OR ..." next to the entity filter; an empty first page in entity mode for a Zonal viewer returns 404 (entityModeNotFound). Super Admin filters: actor, actorType, module, action, entityType/entityId, zoneId (repeatable), outcome, sensitivity, q, from/to. 
Query rules that are mandatory for speed (measured at 2,000,000 rows): from/to must be sent as BOTH an id range from uuidv7Bounds(from, to) AND a created_at range; q is lower(entity_label) LIKE lower(q)||'%' OR lower(actor_name) LIKE lower(q)||'%' with % and _ escaped (this needs the expression indexes from A4, use Prisma $queryRaw or a typed raw fragment for it); cursor is the id (UUID v7) with "id < cursor ORDER BY id DESC". Only repository.ts reads audit_logs. Zod schemas from packages/shared/src/audit/schemas.ts; add the routes to OpenAPI and regenerate the client; permissions audit:view and audit:export are not grantable to Zonal Admin.
Seed 2,000,000 rows with scripts/seed-audit.ts (take the INSERT ... generate_series statement from docs/F-execution/m04-bundle/apps/api/tests/audit/perf.test.ts) and put the EXPLAIN output of the five main query shapes in the handoff block.
Tests: TC-AUD-9..15, 23 (login lists), 24, 25 against the real routes, using the authorization harness actors; plus authorization tests for every new endpoint.
Done when: all pass; p95 for every list shape < 300 ms and entity activity < 100 ms on the seeded data (nightly job is acceptable for the performance test).
```
**Check:** call `GET /audit-logs?entityType=restaurant&entityId=<id>` as a Zonal admin and confirm: no `ip`, `userAgent`, `requestId` keys in the JSON; free listing returns 403; an entity in a zone you do not have returns 404.

---
## Stage C — Screens (needs the UI foundation)

### Prompt C1 — UI design tokens and foundation (doc 49 Prompts 4 and 8)
Run doc 49 **Prompt 4** (tokens and theme) and **Prompt 8** (UI foundation: AdminShell, DataTable, FilterBar, forms, dialogs, charts, login screens, generated client) exactly as written in `docs/H-delivery/49_*`. The two screens below need `DataTable`, `FilterBar`, `Sheet` and the shell.

### Prompt C2 — Activity tab (AU-7)
```
Task AU-7. Lane B. Load only: docs/F-execution/50_* section 9.2; docs/D-ui/22_*, docs/D-ui/21_* item 10; the generated API client; the existing DataTable/Sheet components.
Build apps/web/features/audit/{ActivityTab,AuditDetailDrawer,DiffView,useAuditLogs}. ActivityTab takes entityType and entityId, calls GET /audit-logs in entity mode, shows a compact vertical timeline (actor, action label, time, the latest 3 field changes inline), "View details" opens the drawer (field / before / after table; request id with copy button only when the API returns it). Handle loading, empty, error, 403 and 404; hide itself on 404. Mount it on the detail pages that exist; list the pages not yet built in the handoff block. Money fields are paise: show as rupees with Indian grouping.
Done when: a Zonal admin sees the tab for a record in their zone without IP or device; Super Admin sees them; keyboard navigation and focus return on drawer close work.
```

### Prompt C3 — System Logs screen (AU-6)
```
Task AU-6. Lane B. Load only: docs/F-execution/50_* section 9.1; docs/D-ui/19_*, 22_*; DataTable and FilterBar; the generated API client; the drawer from C2.
Build /super-admin/settings/logs: tabs Activity and Sign-ins; filter bar with URL state (date range default last 7 days, actor typeahead, actor type, module, action grouped by module, zone, entity type, search, outcome, "Sensitive only", Reset); table with cursor "Load more" (no total count); HIGH and Denied badges; row click opens the drawer; links to Access change history and Integration events (pages may not exist yet: render the link disabled with a tooltip). Route guard: Super Admin only, 404 for others. No export button yet.
Done when: every filter works against the 2,000,000 seeded rows and the page renders in under 2 seconds.
```

---
## Stage D — Verify, then the later parts

### Prompt D1 — Independent verification (new session, read-only)
```
You are a reviewer, not the author. Do not modify any file. Read docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md and the code under apps/api/src/lib/audit, apps/api/src/modules/audit, the audit migrations under apps/api/prisma/migrations, apps/web/features/audit and apps/api/tests/audit.
Produce a table: each requirement of sections 2, 3, 5, 8 and 10 and each test TC-AUD-1..28 -> status (Met / Partly / Missing / Not applicable yet), evidence (file:line or test name), and any deviation from the doc. Then list: (1) any mutating route without audit metadata, (2) any place that inserts into audit_logs outside lib/audit, (3) any place that could log request bodies or personal data, (4) any query on audit_logs outside the audit repository, (5) any way for a Zonal Admin to receive ip, userAgent, requestId or a row from a hidden module, (6) anything that connects to the database as zoauro_owner outside migrations and tests. Run the whole test suite and report results. Rank findings High / Medium / Low. Do not fix anything.
```
Then paste the findings into a normal session with: "Fix the High and Medium findings, one commit each, add a test for each, then stop." Repeat D1 until there are no High findings. **The module is done when:** D1 shows no High findings, TC-AUD-1..16 and 19..28 are Met, 17 and 22 are marked "Not applicable yet" (they need the customers and access-control modules), and the Definition of Done lines in doc 50 §13 hold.

### Later (not needed to call the module "built for launch")
| Prompt | When | Doc 50 reference |
|---|---|---|
| CSV export (AU-8) | After pilot | §15 Phase 7, TC-AUD-18 |
| Retention jobs (AU-5) | Before launch + 90 days; uses `DATABASE_URL_AUDIT_PURGE` | §11, §15 Phase 8 |
| Adoption by each module (Phase 9) | Every module as it is built | §15 Phase 9 |
| TC-AUD-17 and 22 | When customers (reveal) and access control (M03) exist | §12 |

---
## If something goes wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| Migration says "role zoauro_app is missing" | Database was created before the init script | `pnpm infra:down -v && pnpm infra:up`, rerun `pnpm db:migrate` |
| App gets "permission denied for table X" (not an audit table) | Default privileges missing | Rerun the `ALTER DEFAULT PRIVILEGES` lines of A2, then `GRANT` on existing tables once |
| Guard tests fail with "must be owner" not appearing | App role is a superuser or owns the tables | Check `\du` and `\dt+`; the API must connect as `zoauro_app` |
| Prisma refuses the bundle migration order | Used the bundle folder names | Delete those folders, redo A4 with `--create-only` |
| `record()` throws ZONE_REQUIRED | Caller forgot `entity.zoneId` | Pass it; for customers pass the zone or null (D63) |
| Claude Code starts rewriting the bundle | Prompt not followed | Stop it; say "adopt the bundle files; change only import specifiers" |
| Coverage guard fails on a route that changed nothing | Service did not call `record()` for the no-op | Call `record()` even when nothing changed; it counts the no-op |
