Date / task id: 2026-10-10 / F0.3 monorepo scaffold
Lane / files changed: D — root config (pnpm workspace, tsconfig.base, eslint, prettier, husky, commitlint), apps/web, apps/api, packages/shared, folder skeleton per doc 07
Contract changes (docs 08/09/10/36): none. Added /api/health and /api/ready placeholders (unversioned, per Prompt 1)
Decisions or [ASSUMPTION]s touched (D-numbers): none. Tooling deviations: tsx instead of ts-node-dev, tsup for api build, Node 24 / pnpm 10 locally (.nvmrc says 22; engines >=22) — add a row to doc 32 if kept
Gate line status (pass/fail): pass — lint, typecheck, test green; pnpm dev serves web :3000 and api :4000; import-boundary rule verified to fire
Next step: F0.4 local env (docker compose, lib/env.ts, .env.example — currently empty); F0.5 CI; F0.6 design tokens
Verify: pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-10 / F0.4 local env + audit DB roles
Lane / files changed: D — docker-compose.dev.yml, infra/initdb/01-roles.sql, apps/api/src/lib/{env,health}.ts (+tests), app.ts/server.ts/worker.ts, apps/api/.env.example, apps/api/scripts/prisma-migrate.mjs, root package.json (infra:up/down), eslint.config.mjs (Node globals for scripts/*.mjs), doc 32 row
Contract changes (docs 08/09/10/36): none. /api/ready now returns 200 {status, checks:{database, redis}} or 503 with the failing check marked "down" (no error details)
Decisions or [ASSUMPTION]s touched (D-numbers): D64 implemented (zoauro_purge role + DATABASE_URL_AUDIT_PURGE). Deviations (doc 32 row added): host ports offset because 5432/6379/9000 were taken by other projects (Postgres 5440 (5441 when 5440 is taken: ZOAURO_PG_PORT), Redis 6390, MinIO 9020/9021, override with ZOAURO_*_PORT); MinIO/mc/Mailpit images pinned; `pg` and `ioredis` added for readiness checks (not named in doc 06; Prisma replaces pg in F1.1); infra:up waits on the four services, not the one-shot bucket init
Gate line status (pass/fail): pass — psql as zoauro_app, zoauro_owner, zoauro_purge connect; app role gets DML on owner-created tables, purge role gets none; bucket zoauro-dev created; API exits 1 listing missing vars; /api/ready 200, 503 with Redis stopped, 200 after restart. Not done: apps/web env validation (doc 12 mentions an equivalent); db:migrate only wraps Prisma (no schema until F1.1)
Next step: F0.5 CI (CI runs migrations with DATABASE_URL_MIGRATE only); F1.1 schema, which must include the audit migration that grants zoauro_purge on audit_logs/access_changes. Note: initdb scripts run only on a fresh volume; after editing them run `docker compose -f docker-compose.dev.yml down -v`. Local apps/api/.env holds DATABASE_URL_MIGRATE for convenience, so the dev API process can see the owner URL; production must not (env.ts rejects it)
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-10 / F1.1 Prisma schema + first migrations
Lane / files changed: D — apps/api/prisma/schema.prisma (48 models, 31 enums incl. the 3 audit enums), prisma/migrations/{20261010130946_init, 20261010131000_constraints}, apps/api/prisma.config.ts, scripts/check-doc08-tables.mjs, apps/api package.json (prisma 7.10.0, @prisma/client 7.10.x), eslint.config.mjs (prisma.config.ts exempt from the Prisma import rule), doc 32 row
Contract changes (docs 08/09/10/36): none to the docs. Schema follows doc 08 v1.2 + v2.0 columns. AuditLog copied from the M04 bundle (same columns, six indexes); AccessChange has no foreign keys (matches the bundle's guard test DDL)
Decisions or [ASSUMPTION]s touched (D-numbers): none resolved. D64 roles untouched. Used PartnerStatus from doc 10 section 5 because doc 08 gives no partner status values
Gate line status (pass/fail): pass — prisma validate; migrate dev --name init applied on an empty DB; second migration applied; migrate diff against the live DB is empty (no drift); check-doc08-tables.mjs lists 48/48 tables; \d audit_logs shows the primary key and the six indexes; lint, typecheck, test green. No seed data, no application code
Ambiguities in doc 08 (not guessed; owner to confirm, schema uses the least-committal form shown):
 1. Status/type value lists missing, stored as String: users.status, vendor_documents.vendor_type, payments.method, refunds.type, payouts.status, reconciliation_runs.status, coupons.type/status, notifications.audience/channel/status, exports.status, data_subject_requests.type/status, order_status_history.actor_type, homemakers.food_category, user_preferences.table_density
 2. customers.source: doc 08 gives two lists (APP/ADMIN/REFERRAL/OTHER in People, APP/ADMIN/IMPORT in the v2.0 additions). Stored as nullable String
 3. delivery_partners: doc 08 has `status` and `verified_at` only, but docs 42/44 mention a partner `verification_status`. Not added; status uses doc 10 section 5 values
 4. Conventions list created_by/updated_by/deleted_at for every table. Applied to mutable entity tables only; append-only and join tables keep just the timestamps doc 08 lists; orders have no deleted_at. created_by/updated_by are plain uuid columns without FKs
 5. No id column listed: settings (key = PK), idempotency_keys (key = PK), user_preferences (user_id = PK), external_refs (PK = client_id, entity_type, external_id)
 6. Uniqueness: doc says "(unique)" for zones.name, customers.phone, access_profiles.name (plain unique) and "partial unique where deleted_at IS NULL for emails, codes" (users.email, zones.code, coupons.code). Read literally; a soft-deleted zone name or customer phone cannot be reused
 7. Money columns are Int (max about INR 21 million); payouts.gross/net or ledger sums could need BigInt. Nullable where doc is silent: ledger_entries.order_id (payouts have no order), orders.cancelled_by (actor kind unknown, no FK), refunds.payment_id
 8. pg_trgm scope: doc says "names, phone, order_no" without tables. Added name+phone on restaurants, homemakers, delivery_partners, customers and order_no on orders
 9. Module keys: doc 04 has a prose matrix, not a key list, so profile_permissions.module and assignment_overrides.module are String, to be validated against packages/shared. webhook_deliveries.event_id type unknown (String). Optional RLS in doc 08 not implemented
Next step: F1.2+ (repositories, seed F1.7). M04: the bundle migrations are named 20261010000000/000100, which sort BEFORE init; rename them to a later timestamp before adding them or they run first and fail. Until the audit_guard migration is applied zoauro_app can still UPDATE/DELETE audit_logs (default privileges). Prisma 7 needs driver adapter @prisma/adapter-pg at runtime (not added; no app code yet). Fresh DB: pnpm infra:up then pnpm db:migrate migrate deploy (migrate dev also works)
Verify: pnpm lint && pnpm typecheck && pnpm test; cd apps/api && node --env-file=.env scripts/check-doc08-tables.mjs

Date / task id: 2026-10-10 / AU-1 audit database guard
Lane / files changed: D — prisma/migrations/20261010131545_audit_guard and 20261010131607_audit_search_indexes (SQL byte-identical to the bundle, verified with cmp; folders created by prisma migrate dev --create-only so they sort after init and constraints), apps/api/tests/audit/{guard.test.ts, support/db.ts}, apps/api/vitest.config.ts (loads .env), apps/api/tsconfig.json (typechecks tests/ and the vitest config)
Contract changes (docs 08/09/10/36): none
Decisions or [ASSUMPTION]s touched (D-numbers): D64 (zoauro_purge) now enforced by the database; D61 not touched
Gate line status (pass/fail): pass — guard.test.ts 18/18 (TC-AUD-7/8 on audit_logs and access_changes): zoauro_app INSERT/SELECT ok; UPDATE, DELETE, TRUNCATE, DISABLE TRIGGER, DROP TRIGGER refused; owner stopped by the trigger; purge role cases pass. Assertions copied unchanged from the bundle test. Mutation check: granting UPDATE to zoauro_app makes 2 tests fail; file restored. Throwaway database per run (zoauro_audit_test_<random>, owner role, dropped afterwards), schema built by prisma migrate deploy, no leftover databases. lint, typecheck, test green (api 33 tests)
Next step: AU-2 (audit service) per doc 50. Notes: (1) pnpm test in apps/api now needs the local Postgres (pnpm infra:up) and DATABASE_URL_MIGRATE; it fails loudly otherwise. F0.5 CI must start Postgres with infra/initdb/01-roles.sql and set DATABASE_URL_MIGRATE. (2) The first --create-only call, run twice in a row, applied the still-empty audit_guard migration to the local DB, so the local Docker volume was rebuilt (pnpm infra:down, docker compose down -v, infra:up, migrate dev). Run the two --create-only commands with the first one's SQL pasted before running the second. (3) The test database does not inherit initdb grants, so db.ts repeats GRANT USAGE and the default privileges from 01-roles.sql
Verify: pnpm infra:up && cd apps/api && pnpm vitest run tests/audit/guard.test.ts

Date / task id: 2026-10-10 / AU-2 audit library adopted (write path, no routes)
Lane / files changed: A + D — packages/shared/src/audit/ (3 files, copied), packages/shared package.json (exports "." and "./audit") and src/index.ts (export * from './audit'); apps/api/src/lib/audit/ (13 files, copied, no edits: shared.ts already imported "@zoauro/shared/audit", which resolves through the package exports); apps/api/src/lib/db.ts (Prisma adapter auditTx); apps/api/tests/audit/{diff-redact, service, coverage}.test.ts (copied), schema-coverage.test.ts and db-adapter.test.ts (new), support/db.ts (added pgAuditTx, withTransaction); apps/api package.json (db:generate, postinstall prisma generate); eslint.config.mjs (src/lib/db.ts may import Prisma types, same exemption as prisma.config.ts; lib/audit still may not)
Contract changes (docs 08/09/10/36): none
Decisions or [ASSUMPTION]s touched (D-numbers): none resolved. D63 still Assumed (customers must pass zoneId explicitly)
Gate line status (pass/fail): PARTIAL. lint pass, typecheck pass. Tests: 69 of 70 in apps/api pass; the failure is the new TC-AUD-6 test against the real schema (below). TC-AUD-1..6, 16, 19, 20, 21, 26, 27 pass (26 and 27 live inside service.test.ts and coverage.test.ts without the label in the test name). Deviations from "copy unchanged": (a) the Prisma tx client does not satisfy AuditTx directly (only beforeJson/afterJson: unknown vs InputJsonValue), so db.ts adapts each row, omitting absent JSON; AuditRow untouched; unit-tested with a fake client, not yet against a real PrismaClient (needs the pg driver adapter, none wired yet); (b) the copied tests used `any` (three places, AGENTS.md prohibits it): replaced with unknown or an explicit type, no assertion changed; (c) service.test.ts builds its own throwaway database with prisma migrate deploy and creates test_restaurants with SQL inside the test, instead of the bundle's globalSetup. The copied files keep the bundle's dense formatting; lint-staged (prettier) will reformat them at commit
TC-AUD-6 FINDING, needs an owner decision (nothing allow-listed, registry.ts untouched). findUncoveredSecretLikeColumns() on prisma/schema.prisma returns 7:
 1. User.mfaSecretEncrypted — an encrypted MFA secret. Propose DROP (add 'mfasecretencrypted' to DROP_EXACT, or suffix 'encrypted' for all encrypted blobs)
 2. User.backupCodesHash — Propose DROP (add suffix 'hash' to DROP_SUFFIX; also covers #7)
 3. User.passwordResetTokens — FALSE POSITIVE: a Prisma relation list, not a column. Propose fixing the walker to skip fields whose type is another model (it is bundle code, so not changed here)
 4. Restaurant.gstNo and 5. Restaurant.fssaiNo, 6. Homemaker.fssaiNo — business tax ids; doc 50 section 5.3 says mask GST/FSSAI. Propose MASK_TAIL gets 'gstno' and 'fssaino' (the set has gst, gstnumber, gstin, fssai, fssainumber but not the *No spelling used in doc 08)
 7. IdempotencyKey.requestHash — a request fingerprint, no audit value. Propose DROP via the same 'hash' suffix (alternative: allow-list it as a non-secret)
 Question: apply these four registry/walker changes (proposed default: yes, all of them are drop or mask, none weaken redaction)?
Next step: apply the decision above, then AU-3 (middleware wiring) and AU-4 (routes/repository). Needs: a PrismaClient with @prisma/adapter-pg before auditTx runs against a real client. pnpm install now runs prisma generate (postinstall)
Verify: pnpm lint && pnpm typecheck && pnpm test (needs pnpm infra:up for the DB tests)

Date / task id: 2026-10-10 / F1.2 authentication (Lane A, module auth)
Lane / files changed: A — apps/api/src/modules/auth/{auth.repository, auth.service, auth.controller, auth.routes, index}.ts; lib/auth/{config, crypto, cookies, middleware, session-store}.ts; lib/errors.ts (AppError, standard error body, notFound); lib/rate-limiter.ts; lib/db.ts (createPrismaClient); app.ts (request id, /api/v1 mount, error handlers); server.ts (Prisma + Redis + auth wiring); packages/shared/src/auth.ts (login/forgot/reset/reauth schemas, password length 12); tests/auth/{auth, password}.test.ts + support/auth-env.ts; tests/audit/support/db.ts (exposes appUrl). More than 5 files: an auth module is one concern, kept in one commit
Contract changes (docs 08/09/10/36): none. Routes under /api/v1: POST /auth/login, /auth/logout, /auth/forgot-password, /auth/reset-password, /auth/reauth, GET /me. Error codes used: UNAUTHENTICATED, FORBIDDEN, VALIDATION_ERROR, RATE_LIMITED, plus PASSWORD_CHANGE_REQUIRED (403, not in doc 09 list: add it)
Decisions or [ASSUMPTION]s touched (D-numbers): D37 (30 min lock) implemented; D42 untouched. Assumed, please confirm: users.status "ACTIVE" is the only value that may sign in (doc 08 gives no status values)
Gate line status (pass/fail): lint pass, typecheck pass. apps/api tests 118 pass, 1 fail, 1 todo. The one failure is still the AU-2 TC-AUD-6 real-schema finding awaiting the owner decision (7 columns, see the AU-2 block); F1.2 added no failures. Auth tests: 49 pass. TC-AUTH-1, 2, 4, 5 pass (lockout 30 min incl. the 29:59 boundary); TC-AUTH-3 is it.todo (2FA is SA-7.2). Cookie flags, CSRF, Origin check, rate limits, /me for SuperAdmin/Admin(A)/Admin(A+B)/Admin(none), and one audit-row assertion for each of user.password_changed, user.password_reset_requested, user.locked, user.unlocked, session.revoked, reauth.failed. Smoke-tested the real server.ts against the local DB as zoauro_app (one UNKNOWN_USER row is in the local login_history)
Behaviour notes: sessions = PostgreSQL rows (token_hash) + Redis cache; Redis outage or flush falls back to PostgreSQL. Idle 30 min (sliding), absolute 12 h, from timestamps via an injectable clock. Login with MFA enabled is refused (2FA unbuilt, fail closed). Wrong-tab and wrong-password failures both count toward lockout. Forgot-password answers the same for unknown, suspended and rate-limited emails; the mail is sent without being awaited. Reset: single use (atomic claim), revokes all sessions (one session.revoked row each), clears a lock. Reauth failures count toward lockout and write reauth.failed (HIGH)
Open points for the owner:
 1. Doc 09 has no change-password endpoint, so a first-login forced change can only be completed through the reset-link flow. Everything except /me and logout returns 403 PASSWORD_CHANGE_REQUIRED meanwhile. Proposed: POST /auth/change-password {currentPassword, newPassword} (session + CSRF, audits user.password_changed). Not invented here
 2. Mailer is a port with a no-op default (no SMTP/SES sender exists yet); reset links go nowhere in a running server until the notifications module provides one. Tokens are never logged
 3. AU-3: forgot-password for an unknown email returns 2xx with no audit row, so the coverage guard will flag it. The route declares {module:'auth', action:'user.password_reset_requested'}; AU-3 needs an allow-listed none-reason or a different declaration
 4. req.ip is the socket address; behind Nginx a trust-proxy setting is needed or every user shares one IP-based rate-limit bucket. No env variable for it exists in doc 12
 5. Auth repository methods take no AuthContext (they run before one exists, on the caller's own account, and touch no zone-owned table); AGENTS.md says every repository method takes it
 6. Session idle/absolute/lock numbers are constants (lib/auth/config.ts) until the settings module exists; "remember me 7 days", "max 3 sessions" and the new-login email are not built (not asked)
Next step: AU-3 (wire auditContextMiddleware and the coverage guard), then SA-7.2 (2FA) and the access module (/me zones and permissions). pnpm test needs pnpm infra:up (Postgres + Redis)
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-11 / F1.3 AuthContext, permission guard, scope resolver, BaseRepository (Lanes A + D)
Lane / files changed: packages/shared/src/permissions.ts (modules, the five actions, GRANTABLE_ACTIONS, findGrantViolations); apps/api/src/lib/authz/{types, can, resolver, access-service, middleware, base-repository, index}.ts; apps/api/src/modules/access/{access.repository, index}.ts (reads the access tables; writes arrive with the Access Control module); app.ts (authContextMiddleware after the session middleware), server.ts; tests/authz/{leaky-repository, resolver, access-context}.test.ts + support/{scope-harness, fake-delegate, test-router}.ts; tests/auth/support/auth-env.ts (makeAuthzApp, createProfile, addOverride). Over 5 files: one concern (access context); the guideline exception applies like F1.2
Contract changes (docs 08/09/10/36): none. No audit calls (as instructed): access changes are audited by the Access Control module, which must call AccessService.invalidateUsers / invalidateProfile / invalidateZone after every change and emit scope.changed
Decisions or [ASSUMPTION]s touched (D-numbers): D41 implemented (profile + GRANT/DENY, deny wins, per member per zone); D20 limits read from the assignment with the profile default; D57 and D15 (integrations, offers/notifications/analytics/reviews/support not grantable) encoded in GRANTABLE_ACTIONS
Gate line status (pass/fail): lint pass, typecheck pass. apps/api: 167 pass, 1 fail, 1 todo; the one failure is still the AU-2 TC-AUD-6 real-schema finding awaiting the owner decision. F1.3 adds 49 tests (resolver 23, leaky/harness 2, integration 24). TC-AC-5 and TC-AC-6 pass, plus TC-AC-1/2/3/4/7/14 behaviour and TC-MZ-13. Leaky repository: written first (red: module missing), the harness reports 30+ violations for an unscoped repository and none for BaseRepository. Mutation proof, files restored and compared: (1) scoping removed from BaseRepository -> the BaseRepository harness test fails; (2) deny no longer wins -> 4 resolver tests fail; (3) non-grantable grants not filtered -> 2 tests fail
Behaviour: AuthContext = { userId, role, isSuperAdmin, assignedZoneIds, permissionsByZone, limitsByZone, requestedZoneIds } built on every request that has a session, kept in res.locals only (a test asserts the session in Redis and PostgreSQL holds no zone or permission data). can(ctx,key,zone); zonesFor(ctx,key) returns { kind: ALL } or { kind: ZONES, zoneIds } (Super Admin with nothing requested = ALL); assertCanRead (404) and assertCanWrite (404 unassigned zone, 403 assigned zone without the action). Query ?zoneId= (repeatable) is validated (422 if not a uuid) and a zone the member is not assigned to is 404 ZONE_NOT_FOUND on any route. requirePermission(module, action): 401 / PASSWORD_CHANGE_REQUIRED via the session guard; Zonal Admin on an ungrantable module action -> 403 (TC-AC-7); write actions need the permission in at least one zone else 403; view passes and a member with no viewable zone gets an empty scope (TC-MZ-13, TC-AC-3 "empty"). The cache key is authctx:<userId>, TTL min(configured, 60) s, Redis failure falls back to PostgreSQL. A soft-deleted profile and a deleted zone grant nothing. BaseRepository<W,R> is Prisma-free: a repository.ts passes its model delegate and zoneFilter/idFilter; findScoped/findOneScoped/countScoped always AND the zone filter and skip the query when the scope is empty
Ambiguities (not guessed beyond the least-committal reading; owner to confirm):
 1. Doc 04 has no machine-readable module list. Keys used: dashboard, orders, restaurants, homemakers, menu, delivery, customers, payments, refunds, settlements, payouts, commission, zones, admins, access, offers, notifications, analytics, reviews, support, settings, integrations, audit (names from the audit modules and docs 09/44)
 2. Doc 04 section 5 lists refunds:create, refunds:approve, customers:reveal, orders:export, which are not among the five stored actions (can_view/add/edit/delete/status). Implemented: five actions only; refunds:create is read as refunds:add (grantable); refund approval, reveal and export are NOT permission keys yet (reveal/export are the canReveal/canExport flags in limitsByZone, approval is Super Admin or the refund limits). Which module do reveal/export apply to?
 3. Doc 04 "Grantable to Zonal Admin" encoded literally: payments view, payouts view, refunds view+add, settlements view/add/edit, dashboard view, the six operational modules all five. Super Admin is not limited by it (its own column, e.g. Payments "V", is not enforced)
 4. No refund limit configured (null on both assignment and profile) resolves to 0 / false (every refund needs approval), not "unlimited"
 5. A suspended-profile/zone-status rule beyond soft delete is not applied (Zone status INACTIVE still counts as assigned)
 6. /me still returns the F1.2 stub permissions. Doc 09 wants zones[] with permissions and limits; that needs zone names (one more join). Proposed as a small follow-up, not done here
 7. The harness runs on a fake delegate; F1.6 should run the same checks against real Prisma repositories and the OpenAPI list
 8. Docker Desktop was not running at the start of the session; I started it (pnpm infra:up) for the DB tests
Next step: the AU-2 decision, then F1.4 (audit transaction helpers, AppError already exists, pagination/idempotency) and F1.6 (matrix harness built on tests/authz/support/scope-harness.ts). Concrete zone-owned repositories extend BaseRepository
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-11 / AU-2 follow-up (TC-AUD-6 real-schema finding resolved)
Lane / files changed: A — lib/audit/registry.ts (DROP_SUFFIX gains 'hash' and 'encrypted'; MASK_TAIL gains 'gstno', 'fssaino'), lib/audit/schema-walker.ts (relation fields are skipped), tests/audit/registry-real-schema.test.ts
Decisions or [ASSUMPTION]s touched (D-numbers): none. The four proposed changes from the AU-2 block were applied because F1.4-F1.7 require pnpm test to pass; each only drops or masks more, nothing was allow-listed. This edits bundle code (registry, walker), as noted in the AU-2 block
Gate line status (pass/fail): pass — lint, typecheck, test (apps/api 172 pass, 1 todo for TC-AUTH-3)
Next step: F1.4
Verify: pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-11 / F1.4 errors, pagination/filter helpers, idempotency (Lanes A + D)
Lane / files changed: packages/shared/src/{errors, pagination}.ts (+ pagination.test.ts); apps/api/src/lib/errors.ts (now imports ERROR_STATUS from shared); apps/api/src/lib/idempotency/{middleware, idempotency.repository, index}.ts; tests/idempotency/idempotency.test.ts; tests/auth/support/auth-env.ts exposes prisma. The audit service was NOT rebuilt (lib/audit exists); AppError and the error middleware already existed from F1.2, they only gained the shared code table
Contract changes (docs 08/09/10/36): none. Doc 09 error list gains PASSWORD_CHANGE_REQUIRED (403), already used by F1.2
Decisions or [ASSUMPTION]s touched (D-numbers): none
Gate line status (pass/fail): pass — lint, typecheck, test. New: shared 9 tests (page and cursor queries, sort allow-list, date range, repeatable filters, error codes), api 17 idempotency tests (required/invalid header, replay of body and 204, same JSON different key order, different body or route = 422, per-user keys, concurrent duplicate = 409 with Retry-After, three simultaneous requests run once, 4xx/5xx release the key, 24 h expiry, purgeExpired, takeover of a stuck request after 60 s)
Behaviour: pageQuerySchema(sortable, fallback) -> page>=1, pageSize 1..100 (default 25), sort=-field from an allow-list, q, from/to; buildPage/pageWindow; cursorQuerySchema (limit default 50, uuid after) with cursorFetchSize/buildCursorPage (repository fetches limit+1); multiValue() for repeatable filters. idempotency({store, clock}) is installed per route after the session middleware; stored key = <userId>:<Idempotency-Key>; replay sets Idempotent-Replay: true
Decisions to confirm: (1) only 2xx responses are stored; a 4xx/5xx releases the key so a corrected request can reuse it (alternative: store 4xx and force a new key); (2) same key + different request is 422 VALIDATION_ERROR (doc 09 has no dedicated code); (3) a request still running when its duplicate arrives gets 409 CONFLICT + Retry-After: 1; (4) the response is persisted when the response finishes, so a client retrying within a few milliseconds can see 409 once; (5) a worker job must call IdempotencyRepository.purgeExpired daily (no job runner exists yet)
Next step: F1.5
Verify: pnpm lint && pnpm typecheck && pnpm test

Date / task id: 2026-10-11 / F1.5 OpenAPI pipeline and typed client (Lanes A + D)
Lane / files changed: apps/api/src/openapi/{operations, build, files}.ts; apps/api/scripts/generate-openapi.ts; apps/api/openapi/openapi.json (generated, committed); packages/api-client (new: src/index.ts hand-written client, src/schema.ts generated, tests); packages/shared/src/auth.ts (response schemas); app.ts (GET /api/v1/openapi.json); tests/openapi/{openapi, contract}.test.ts; root and api package.json scripts openapi:generate / openapi:check; tsconfig includes scripts/
Contract changes (docs 08/09/10/36): doc 09 gains GET /api/v1/openapi.json (public) and the x-access / x-audit extensions; /me stub zones is now an array of objects with zoneId (was an empty array)
Decisions or [ASSUMPTION]s touched (D-numbers): none
Gate line status (pass/fail): pass — lint, typecheck, test. New: openapi 11, contract 2, api-client 5 tests. Mutation proof: editing the committed spec by hand makes openapi:check exit 1 and two tests fail; restored
How it works: OPERATIONS (one list) declares for each route its path, schemas, `access` (public | session | permission+zone behaviour) and, for post/put/patch/delete, `audit` ({module, action} from the catalogue or {none: reason from AUDIT_NONE_REASONS}). build.ts turns it into OpenAPI 3.1 (cookie and CSRF security schemes, ErrorBody on every error status, x-access, x-audit). A mutating operation without audit makes the generator throw. checkOpenApiAuditMetadata (lib/audit) is run on the result. The client's paths, bodies and responses are typed from schema.ts; it remembers the CSRF token from login or /me and maps error bodies to ApiError (a non-JSON gateway error is ApiError UNKNOWN, found by a test)
Open points: (1) No GitHub Actions workflow exists yet (F0.5), so "fail CI" is carried by `pnpm test` (the staleness test) and `pnpm openapi:check`; F1.6 adds a minimal workflow. (2) /api/health and /api/ready are outside /api/v1 and are not in the document. (3) Zod 4 only patches schemas created after extendZodWithOpenApi, so the builder re-creates the ErrorBody object after the patch; shared stays free of the OpenAPI library. (4) z.never() has no OpenAPI form, hence the zoneId object in the stub. (5) Every new route must be added to operations.ts; F1.6 fails on an Express route that is not listed
Next step: F1.6
Verify: pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check

Date / task id: 2026-10-11 / F1.6 authorization matrix harness (Lanes A + D)
Lane / files changed: apps/api/tests/authz/matrix/{engine, fixtures, run}.ts; tests/authz/{authorization-matrix, matrix-detects}.test.ts; tests/authz/support/{test-router, test-spec}.ts (test-router gained csrf and mutant options); lib/authz/middleware.ts (requirePermission option zoneInRequest); tests/auth/support/auth-env.ts (makeAuthzApp also returns routers); tests/authz/access-context.test.ts (one test updated, see below); .github/workflows/ci.yml (new); .gitignore (apps/api/test-reports/)
Contract changes (docs 08/09/10/36): none. Behaviour clarified: a request that names a zone in its path or body gets 404 for an unassigned zone and 403 for an assigned zone without the action, for every member including one who holds the action nowhere (doc 24 section 2: Admin(none) = 404). Routes that name no zone (bulk, global) keep the route-level 403
Decisions or [ASSUMPTION]s touched (D-numbers): none
Gate line status (pass/fail): pass — lint, typecheck, test, openapi:check. The matrix runs in `pnpm test` and prints every route it covers: 7 routes of the real document (authorization-matrix real-routes) and 8 permission routes of the test document (zone-scoped lists, objects in a named zone, never-grantable modules), 121+ cases, all six actors (SuperAdmin, Admin(A full), Admin(A+B: full A, read-only B), Admin(A, payments denied), Admin(none), Admin(first login)) over zones A, B, C plus ?zoneId variants. The full per-case table is written to apps/api/test-reports/*.md (CI uploads it as an artifact)
How it works: each OpenAPI operation carries x-access (public | session | permission with zone none/query/path). The engine derives the expected answer per actor and zone from an ORACLE in fixtures.ts (declared profile + denies, written independently of the production resolver), sends the real requests, and compares status, error code and, for lists, the zones actually returned (binding listedZones). It fails on: a wrong status or code, an anonymous 200, a never-grantable module reachable by a Zonal Admin, a missing CSRF check, a list that leaks another zone, an operation without x-access, a route Express serves that the document lacks, and a documented route that is not served
Proof it can fail: matrix-detects.test.ts builds 6 broken routers (leaky list, 403 instead of 404, no authentication, weak guard, no CSRF, undocumented route) + a ghost operation + a missing x-access + a missing binding, and requires each to be reported. Production mutations, files restored and compared: assertCanWrite 404->403, zonesFor ignoring the permission, deny no longer winning, logout without CSRF: each turned the matrix red and named the route
Finding fixed on the way: F1.3's requirePermission returned 403 for a write when the member held the action in no zone, even when the request named a zone; doc 24 section 2 says Admin(none) gets 404. Fixed with the zoneInRequest option; the F1.3 test that encoded the old behaviour now asserts 404 for the zone-named route and 403 for the bulk route
Open points: (1) CI: .github/workflows/ci.yml is new and NOT executed (no Actions runner here); first push will show whether the service containers and the roles script behave as locally. It is a stand-in for F0.5, which still owns pnpm audit, gitleaks, caching and branch protection. (2) The permission routes are test-only (/_t/*); real zone-owned modules must add their operations to operations.ts with x-access and a listedZones binding, and the matrix then covers them with no new test code. (3) Public mutating routes are tested unauthenticated only (a signed-in call to login is not meaningful). (4) Routes outside /api/v1 (health, ready) are not in the document and not covered
(5) Defect found in F1.5 and fixed here: the pre-commit hook (lint-staged, prettier --write) reformatted the two generated files when F1.5 was committed, so the committed bytes no longer matched the generator output and the staleness test went red. apps/api/openapi/openapi.json and packages/api-client/src/schema.ts are now in .prettierignore and were regenerated.
Next step: F1.7
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check

Date / task id: 2026-10-11 / F1.7 seed (Lanes A + D)
Lane / files changed: apps/api/prisma/{seed-data, seed-run, seed}.ts; tests/seed/seed.test.ts; tests/audit/support/db.ts (exposes ownerUrl); apps/api package.json (db:seed = tsx prisma/seed.ts) and tsconfig (prisma/**/*.ts is typechecked)
Contract changes (docs 08/09/10/36): none
Decisions or [ASSUMPTION]s touched (D-numbers): D13 (Assumed) used for the Zone Manager limits; D2 (full control) for Zone Manager; D26 untouched. Nothing resolved
Gate line status (pass/fail): pass — lint, typecheck, test, openapi:check. 13 seed tests: five profiles within GRANTABLE_ACTIONS, the exact permission keys per profile read back from the database, limits, Argon2id admin with forced password change, idempotency (second run creates nothing and leaves the admin password alone), edited and soft-deleted profiles are kept, invalid INITIAL_SUPERADMIN_* is rejected naming the field not the value, the seeded Super Admin signs in (Super Admin tab only), and a Zonal Admin on the seeded Support profile resolves to exactly the Support permissions. `pnpm db:seed` run against the local Docker database: created, then a no-op; exit 1 with a readable message when DATABASE_URL_MIGRATE is missing. The local dev database now holds the 2 roles and 5 profiles (no admin: INITIAL_SUPERADMIN_* is not set in the local .env)
What is seeded (doc 04): Zone Manager = dashboard view; orders, restaurants, homemakers, menu, delivery, customers all five actions; payments view; refunds view+add; settlements view/add/edit; payouts view; per-refund INR 1,000 and daily INR 5,000 (100000 / 500000 paise). Operations = dashboard view; orders, restaurants, homemakers, delivery, customers all five. Support = view on every grantable module + customers:edit + orders:status. Finance View = dashboard, payments and refunds view, settlements view/add/edit. Read Only = view on every grantable module. Roles SUPER_ADMIN and ZONAL_ADMIN (is_system). First Super Admin: name "Super Admin", status ACTIVE, must_change_password true, no 2FA yet
Judgement calls to confirm (doc 04 is prose, not a table): (1) Operations has no menu access (doc says "orders, vendors, partners, customers"; menu is its own module); (2) Support's "cancel orders" is orders:status because doc 09 maps POST /orders/{id}/cancel to it; (3) Finance View excludes payouts and Zone Manager includes payouts view (doc 04 lists Payouts as grantable view and names none for Finance View); (4) every profile has reveal and export OFF: doc 04 defines the flags but gives no default (D26 argues reveal must be one click for zone staff: Super Admin can switch it per member); (5) the first Super Admin is named "Super Admin" (no INITIAL_SUPERADMIN_NAME in doc 12); (6) demo zones A, B, C and demo members (doc 08) are NOT seeded: they are staging/dev fixtures and F1.7 lists only roles, matrix and first admin; (7) a seed profile soft-deleted by Super Admin is not re-created (the unique name stays taken)
Lint rule fix: the Prisma import boundary used the glob 'prisma', which also matched relative paths through our own prisma/ folder (../../prisma/seed-data). It is now a regex for the package names only (@prisma/client, prisma, prisma/config); probes confirmed it still blocks them in apps/api and apps/web (eslint.config.mjs)
Next step: gate F1 is complete (login for both roles, harness in CI, audit row on a sample write is covered by F1.2 and AU-2). Next: F0.5 (real CI), F0.6 design tokens, then F2 UI foundation; AU-3 (wire the coverage middleware) and the Access Control module (SA-1.x) which will call AccessService.invalidate* after every change
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check; pnpm db:seed

Date / task id: 2026-10-11 / AU-3 audit wiring and coverage guard (Lane A)
Lane / files changed: apps/api/src/app.ts (auditContextMiddleware after authentication, auditCoverage before the routers, mode throw under NODE_ENV=test else log); lib/audit/{context, audit.service, middleware, index}.ts (per-request AuditTally, countAudit, noteAuditNoop; auditMeta handlers expose .auditMeta); openapi/operations.ts (auditOf); modules/auth/{auth.routes, auth.service, auth.repository}.ts; lib/auth/session-store.ts (session carries the display name); lib/idempotency/middleware.ts (a replay is an audited no-op); tests: audit/wiring.test.ts (new), audit/coverage.test.ts, authz/matrix/{engine, run}.ts, authz/{authorization-matrix, matrix-detects}.test.ts, authz/support/{test-router, test-spec}.ts, auth/support/auth-env.ts, idempotency/idempotency.test.ts
Contract changes (docs 08/09/10/36): none (openapi.json unchanged; x-audit values are the same, now the single source for the routes too)
Decisions or [ASSUMPTION]s touched (D-numbers): none. Row added to doc 32
Gate line status (pass/fail): pass — lint, typecheck, test (api 239 + 1 todo). TC-AUD-19 against the real app: a test-only route without metadata throws in the default (test) mode; allow-listed login/reauth/logout pass in throw mode; the matrix reports a route without auditMeta both statically (route stack vs x-audit) and at runtime. TC-AUD-27: identical-values record() and forgot-password for an unknown email are not flagged; known email writes one row through the service's own context. Done-check performed by hand: deleting `auditMeta(auditOf('logout'))` from auth.routes.ts made authorization-matrix.test.ts fail ("POST /auth/logout: the Express route declares no auditMeta"); restored
How it works: actor = { USER, session userId, session name, session role }; no session -> no context (record() throws NO_ACTOR). The harness builds its app with mode 'collect' (makeMatrixApp) and turns every violation into a failure, plus checkOpenApiAuditMetadata(spec) and a route-stack comparison with x-audit
Open points: (1) Actor name is the name when the session was loaded (cached up to the idle window); a rename mid-session shows the old name until the cache reloads. (2) No app logger exists; 'log' mode writes one console.error line with method/path/action only. (3) APP_CLIENT actor for the Integration API is not wired (IH-1 not built). (4) TC-AUD-22 and TC-AUD-17 from the original AU-3 prompt were not in this task's scope; they need M03 / a reveal endpoint. (5) Two teardown/timing flakes seen once each under full-suite load, both pass on rerun: DROP DATABASE ... WITH (FORCE) "permission denied to terminate process" in tests/audit/support/db.ts, and the idempotency replay test (response stored on finish, see F1.4 decision 4)
Next step: AU-4 (read API)
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check

Date / task id: 2026-10-12 / AU-4 audit read API (Lane A)
Lane / files changed: apps/api/src/modules/audit/{audit.repository, audit.service, audit.controller, audit.routes, permissions, index}.ts (new; visibility.ts and mapper.ts copied unchanged from the bundle); src/openapi/{operations, build}.ts (five operations, `params`, `zonalActivity`); src/server.ts (mounts the router); packages/shared/src/audit/schemas.ts (response envelopes, catalogue, login history); packages/api-client/src/index.ts (path parameters: `params`); prisma/schema.prisma + migrations/20261012000000_audit_zone_module_action_index (new index); scripts/seed-audit.ts; tests: audit/{read-api, perf}.test.ts, authz matrix (engine, fixtures, auth-env: real routers mounted, `zonalActivity` expectations); apps/api/openapi/openapi.json and packages/api-client/src/schema.ts regenerated; docs/F-execution/50 section 3.1; .env files (Open point 1)
Contract changes (docs 08/09/10/36): GET /audit-logs, /audit-logs/{id}, /audit-logs/catalogue, /login-history, /me/login-history as doc 50 section 8 (doc 09 already listed them). Seventh audit_logs index (zone_id, module, action, id DESC) added to doc 50 section 3.1. No write endpoint on audit rows
Decisions or [ASSUMPTION]s touched (D-numbers): none. Row added to doc 32
Gate line status (pass/fail): pass — lint, typecheck, test (api 270 passed, 14 perf skipped, 1 todo), openapi:check. Authorization matrix covers all 12 routes (SuperAdmin, Admin(A), Admin(A+B), Admin(A, payments denied), Admin(none)). read-api.test.ts: 31 tests for TC-AUD-9..15 and 23 through the real routes. Performance (TC-AUD-24/25, nightly: AUDIT_PERF=1 pnpm --filter @zoauro/api exec vitest run tests/audit/perf.test.ts) with 2,000,000 rows on PostgreSQL 16: every list shape p95 < 300 ms and entity Activity p95 < 100 ms:
| Shape | p95 ms | worst ms | budget |
|---|---|---|---|
| cursor deep in one zone | 3.3 | 9.2 | 300 |
| TC-AUD-25 date window two years back + module | 3.9 | 6.5 | 300 |
| q prefix with matches | 112.1 | 124.7 | 300 |
| TC-AUD-25 q prefix, no match | 3.9 | 4.0 | 300 |
| module + action | 6.2 | 6.6 | 300 |
| sensitive only | 7.4 | 10.0 | 300 |
| by actor | 4.6 | 14.2 | 300 |
| TC-AUD-25 zone + module + action, no match | 4.0 | 4.4 | 300 |
| by zone + module + action | 5.6 | 10.1 | 300 |
| by zone | 6.7 | 13.6 | 300 |
| first page, no filter | 3.6 | 5.5 | 300 |
| entity Activity (Zonal, predicate) | 3.1 | 3.1 | 100 |
| entity Activity (Super Admin) | 5.3 | 6.7 | 100 |
How it works: planAuditList() decides 403 / ALL / ENTITY; the viewer is built from AuthContext (viewerOf: can -> can(), zonesFor -> zonesFor(), over all the member's zones, ignoring ?zoneId in entity mode); the Zonal predicate is (module = m AND zone_id IN (...)) OR ... next to the entity filter; an empty first page for a Zonal viewer is 404; GET /audit-logs/{id} not visible is 404. from/to go out as an id range (uuidv7Bounds) AND a created_at range; q is lower(entity_label) LIKE lower(q)||'%' OR lower(actor_name) LIKE ..., with \ % _ escaped; cursor is id < after ORDER BY audit_logs.id DESC. Only audit.repository.ts reads audit_logs and login_history. /login-history masks emails (maskEmail); /me/login-history shows the caller's own, unmasked.
Defects found by the 2M-row run and fixed: (1) ORDER BY id DESC bound to the aliased text column id::text, so no list used the primary-key index (0.5 to 1.9 s per list); it is now ORDER BY audit_logs.id DESC. (2) ip::text returned 203.0.113.5/32; now host(ip). (3) zone + module + action with no match took p95 1.3 s (the existing (zone_id, module, id) index cannot test action): new index (zone_id, module, action, id DESC).
Plans (EXPLAIN ANALYZE, BUFFERS; the slowest sample of each shape):

### entity Activity (Zonal, predicate)
```
Limit  (cost=0.43..8.51 rows=1 width=516) (actual time=0.228..0.229 rows=0 loops=1)
  Buffers: shared hit=13
  ->  Index Scan using audit_logs_entity_type_entity_id_id_idx on audit_logs  (cost=0.43..8.51 rows=1 width=516) (actual time=0.225..0.225 rows=0 loops=1)
        Index Cond: ((entity_type = 'restaurant'::text) AND (entity_id = '0192f1d2-2222-7000-8000-000000000041'::uuid))
        Filter: ((zone_id = ANY ('{0192f1d2-0000-7000-8000-000000000006,0192f1d2-0000-7000-8000-000000000007,0192f1d2-0000-7000-8000-000000000008}'::uuid[])) AND ((module = 'restaurants'::text) OR (module = 'homemakers'::text) OR (module = 'menu'::text) OR (module = 'customers'::text) OR (module = 'delivery'::text) OR (module = 'orders'::text) OR (module = 'payments'::text) OR (module = 'refunds'::text)))
        Rows Removed by Filter: 10
        Buffers: shared hit=13
Planning:
  Buffers: shared hit=347
Planning Time: 2.543 ms
Execution Time: 1.270 ms
```

### TC-AUD-25 zone + module + action, no match
```
Limit  (cost=0.55..209.91 rows=51 width=516) (actual time=0.129..0.130 rows=0 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using audit_logs_zone_id_module_action_id_idx on audit_logs  (cost=0.55..4286.26 rows=1044 width=516) (actual time=0.126..0.127 rows=0 loops=1)
        Index Cond: ((zone_id = '0192f1d2-0000-7000-8000-000000000007'::uuid) AND (module = 'orders'::text) AND (action = 'refund.requested'::text))
        Buffers: shared hit=4
Planning Time: 0.353 ms
Execution Time: 0.401 ms
```

### TC-AUD-25 q prefix, no match
```
Limit  (cost=27.17..27.29 rows=51 width=516) (actual time=0.148..0.150 rows=0 loops=1)
  Buffers: shared hit=9
  ->  Sort  (cost=27.17..27.67 rows=200 width=516) (actual time=0.146..0.147 rows=0 loops=1)
        Sort Key: id DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=9
        ->  Bitmap Heap Scan on audit_logs  (cost=8.97..20.50 rows=200 width=516) (actual time=0.088..0.089 rows=0 loops=1)
              Recheck Cond: ((lower(entity_label) ~~ 'zzz18%'::text) OR (lower(actor_name) ~~ 'zzz18%'::text))
              Filter: ((lower(entity_label) ~~ 'zzz18%'::text) OR (lower(actor_name) ~~ 'zzz18%'::text))
              Buffers: shared hit=6
              ->  BitmapOr  (cost=8.97..8.97 rows=1 width=0) (actual time=0.084..0.086 rows=0 loops=1)
                    Buffers: shared hit=6
                    ->  Bitmap Index Scan on audit_logs_label_idx  (cost=0.00..4.44 rows=1 width=0) (actual time=0.030..0.030 rows=0 loops=1)
                          Index Cond: ((lower(entity_label) ~>=~ 'zzz18'::text) AND (lower(entity_label) ~<~ 'zzz19'::text))
                          Buffers: shared hit=3
                    ->  Bitmap Index Scan on audit_logs_actorname_idx  (cost=0.00..4.44 rows=1 width=0) (actual time=0.053..0.053 rows=0 loops=1)
                          Index Cond: ((lower(actor_name) ~>=~ 'zzz18'::text) AND (lower(actor_name) ~<~ 'zzz19'::text))
                          Buffers: shared hit=3
Planning:
  Buffers: shared hit=53
Planning Time: 1.164 ms
Execution Time: 0.242 ms
```

### TC-AUD-25 date window two years back + module
```
Limit  (cost=0.43..1420.47 rows=51 width=516) (actual time=0.147..0.542 rows=51 loops=1)
  Buffers: shared hit=33
  ->  Index Scan Backward using audit_logs_pkey on audit_logs  (cost=0.43..3592.31 rows=129 width=516) (actual time=0.145..0.532 rows=51 loops=1)
        Index Cond: ((id >= '0190a901-a955-7000-8000-000000000000'::uuid) AND (id <= '01913f63-9615-7fff-bfff-ffffffffffff'::uuid))
        Filter: ((created_at >= '2024-07-12 22:13:56.789+00'::timestamp with time zone) AND (created_at <= '2024-08-11 03:01:56.789+00'::timestamp with time zone) AND (module = 'refunds'::text))
        Rows Removed by Filter: 358
        Buffers: shared hit=33
Planning:
  Buffers: shared hit=24
Planning Time: 0.369 ms
Execution Time: 0.592 ms
```

### sensitive only
```
Limit  (cost=0.43..30.78 rows=51 width=516) (actual time=0.039..0.342 rows=51 loops=1)
  Buffers: shared hit=22
  ->  Index Scan Backward using audit_logs_pkey on audit_logs  (cost=0.43..169835.45 rows=285403 width=516) (actual time=0.038..0.333 rows=51 loops=1)
        Filter: (sensitivity = 'HIGH'::"AuditSensitivity")
        Rows Removed by Filter: 306
        Buffers: shared hit=22
Planning Time: 0.146 ms
Execution Time: 0.383 ms
```

Open points: (1) Docker port clash: 5440 belongs to another project's container (4dcommerce-postgres), so Zoauro Postgres now runs on 5441 (ZOAURO_PG_PORT=5441 in the root .env, DATABASE_URL* in apps/api/.env and .env.example). Teammates whose 5440 is free can keep 5440. (2) scripts/seed-audit.ts refuses the `zoauro` database: audit rows can never be deleted, so seed only throwaway databases (the perf test makes its own). (3) q with matches is the noisiest shape (63 to 300 ms across three full runs, 112 ms on the last quiet one); a one-letter prefix matches half the table. (4) Entity-mode list items carry changedFields (names), not values; values come from GET /audit-logs/{id}. (5) The idempotency replay test (tests/idempotency) failed in 2 of 7 full runs under load with 409: the response is stored just after it is sent (F1.4 decision 4); it passes alone and on rerun. (6) POST /audit-logs/exports and /exports/{id} (AU-8) are not built
Next step: AU-5 retention jobs / AU-8 export
Verify: pnpm infra:up && pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check

Date / task id: 2026-10-12 / AU-7 Activity tab (Lane B)
Lane / files changed: apps/web/features/audit/{ActivityTab, AuditDetailDrawer, DiffView, useAuditLogs, format, index}.ts(x) and audit.test.tsx (17 tests, jsdom); apps/web/components/ui/sheet.tsx (shadcn-style Sheet on Radix Dialog); apps/web/lib/{api-client.tsx, utils}.ts; apps/web/package.json (+@tanstack/react-query, @radix-ui/react-dialog, lucide-react, @zoauro/api-client; dev: jsdom, @testing-library/react, dom, user-event; all named in doc 06); packages/api-client (path parameters + 2 tests); pnpm-lock.yaml
Contract changes (docs 08/09/10/36): none
Decisions or [ASSUMPTION]s touched (D-numbers): none. Row added to doc 32
Gate line status (pass/fail): pass — lint (jsx-a11y included), typecheck, test (web 18, api-client 7). Component tests cover loading, empty, 5xx (retried twice, then Try again), 403 (message, no retry), 404 (renders nothing and calls onUnavailable), cursor paging (after = nextCursor), Zonal drawer without request id / IP / device / copy button, Super Admin drawer with request id + working Copy + IP + device, drawer 404, keyboard (Tab to the button, Enter opens, focus moves inside, Escape closes, focus returns to the button), paise to rupees with Indian grouping (100000 -> ₹1,000.00, 12345678 -> ₹1,23,456.78)
How it works: <ActivityTab entityType entityId [timeZone='Asia/Kolkata'] [onUnavailable] /> calls GET /audit-logs in entity mode through the typed client (useAuditLogs, TanStack infinite query, key ['audit','list','<type>:<id>',{limit}]); it shows each entry's actor, label, time and up to 3 changed field names (+N more); "View details" opens AuditDetailDrawer (GET /audit-logs/{id}, field / before / after table). ip, userAgent and requestId appear only if the API returns them (Super Admin only). Radix returns focus only to its own Trigger, so the opener's button is found by data-open-detail and focused explicitly on close. Money: the diff recognises paise by the last path segment against MONEY_FIELDS in features/audit/format.ts (the integer money columns of schema.prisma); add new money columns there or their diff shows plain numbers
Pages not built yet (no ActivityTab is mounted anywhere; mount <ActivityTab entityType=... entityId=... onUnavailable={hideTab} /> when each exists, doc 21 item 10): restaurant, homemaker, partner, customer, order, zone (Super Admin), member (Super Admin), refund detail pages. The app has no detail page, layout providers or session context yet (F2). The root layout must mount <QueryClientProvider> and <ApiClientProvider> (lib/api-client.tsx) before any page uses the tab
Open points: (1) Doc 50 asks for "field changes inline for the latest 3 changes"; the list API returns changedFields names only (no before/after), so the timeline shows names inline and values in the drawer. To show values inline the list item must gain them (a contract change, not made). (2) No design tokens (F0.6) or DataTable exist: plain Tailwind neutral palette with dark: variants, to be replaced by tokens. (3) The "Record" line shows the API's snake_case entity type, only de-underscored. (4) Not run in a browser: there is no page to open; behaviour is verified in jsdom
Next step: F0.6 tokens, F2 UI foundation (providers, layout, session), then mount the tab on each detail page as it is built
Verify: pnpm lint && pnpm typecheck && pnpm test
