# 56 — Core modules execution plan: Authentication, Audit & Logs, Zone Management (+ shell), with numbered prompts

Based on the **Step 1 read-only audit of the repo** (commit `0d12141`, branch `main`). Supersedes doc 55 (written without seeing the repo; do not use it). Specifications: doc 50 (Audit), 52 (Auth + 2-step), 53 (Zones); API doc 09; schema doc 08. Everything marked "recorded" below comes from the audit or `docs/handoff.md`, not from my own run.

**Goal:** a real, working application (not mockups) where a Super Admin signs in (with 2-step verification), manages zones, sees every action in Audit & Logs, and where all other modules show **Coming Soon**. Built to production standard so it stays the foundation, not a throwaway demo.

## 1. Current state (from the audit; nothing re-verified by me)
| Area | Status | What is true today |
|---|---|---|
| Auth backend | Partial | Login, logout, forgot/reset, reauth, `/me`, login history exist. **Missing:** CSRF endpoint, change-password, sessions list/revoke, remember-me, max sessions, new-login email, **all 2-step**, real `/me` permissions. Mailer is a no-op, so reset emails go nowhere |
| Auth UI | **Missing** | `(auth)` folders hold only `.gitkeep`; `/login` is a 404 and the System Logs page redirects to it |
| Authorization core | Complete for reads | Resolver, access context, authorization matrix tests. No write side (that is M03, out of scope) |
| Audit write path | Complete (recorded) | Append-only guard, redaction, coverage guard. DENIED rows never written in production; staff email stored in labels |
| Audit read API + System Logs UI | Complete (recorded); e2e 11/11 recorded | Unreachable until login exists. ActivityTab mounted nowhere |
| Zones | **Missing** | `modules/zones/.gitkeep` only; schema behind doc 53 |
| Shell | **Missing** | No sidebar, layouts, error/loading/404 pages, Coming Soon pages |
| Databases | | `zoauro` (baseline): ~~4 of 5 migrations~~ **5 of 5 migrations since P1** (verified, see §1.1), 0 users/zones, clean. `zoauro_demo`: 5 migrations, **20,000 synthetic audit rows, 0 users, 0 zones**. 3 leftover throwaway test databases |
| Open risks | | Neon owner credential leaked in a transcript (rotate); seed scripts default to `zoauro`; ~~idempotency test flaky (2 of 7 full runs)~~ **fixed in P2** (see §1.1); CI never executed; Node 24 locally vs 22 in `.nvmrc` |

### 1.1 Execution status (updated 2026-10-12; HEAD `73263367329dc729d26eecd154967db9f207ada8`)
| Step | Status | Evidence |
|---|---|---|
| P0 | Partly done | `.env.example` restored to HEAD (the uncommitted Neon placeholder lines were removed, not committed). The pending handoff was committed in `73263367329dc729d26eecd154967db9f207ada8` ("docs: handoff for AU-6, P1 and P2", which also carries the P1 and P2 blocks). Items 4 (`.gitignore` check) and 5 (`home/` report) are not recorded as done |
| P1 | **Complete** | `20261012000000_audit_zone_module_action_index` applied to `zoauro` with `migrate deploy` (no reset, no dev mode); verified: 5 migrations, `audit_logs` 10 indexes (1 primary key + 9 secondary), `users`/`zones` 0 rows, `login_history` 1 row unchanged. Recorded in `docs/handoff.md` |
| P2 | **Complete** | (a) `bf1b53450918156ba5f01cb899a02dbf8265d8d0` idempotency key settled before the response is sent (also touched `src/lib/errors.ts`, see doc 32); (b) `a3dc2d188212226e20f6814a27efcfae8fba5a36` guarded throwaway-database teardown without `DROP ... FORCE`. Three consecutive `pnpm --filter @zoauro/api test` runs: 330 passed, 0 failed, 14 skipped, 1 todo each; no new leftover databases |
| P3 | **Complete** | `afc2f0e` DENIED rows via recordDenied; `239fe3c` TRUST_PROXY_HOPS; `1df4665` no staff email in labels / unmatched login history; `99d1a59` database role boot guard; `47cc689` detail endpoint scope tests. `pnpm --filter @zoauro/api test` green before each commit. Recorded in `docs/handoff.md` |
| P4 | **Complete** | `e00f8fb`, `6d4bda3` shared 2-step contracts and audit actions; `b45588e` schema + migration `20261012100000_auth_two_step`, applied to `zoauro` with `migrate deploy` after approval; verified: 6 migrations, 3 MFA tables, 2 enums, partial unique index, users 0. Recorded in `docs/handoff.md` |
| P5 | **Complete** | `da0c1e8` shared zone contracts and audit actions; `0e45128` schema + migration `20261012110000_zones_schema`, applied to `zoauro` after approval; verified: 7 migrations, 4 CHECKs, UNIQUE(code) incl. soft-deleted, unique lower(name), UNIQUE(pincode). Recorded in `docs/handoff.md` |
| P6 | **Complete** | `58f751d` zo_sid + hybrid CSRF; `bf5022c` SMTP mailer; `ed15836` change password; `754ce5b` sessions (remember me, cap 3, list/revoke); `6c10929` /me with zone permissions and limits. Recorded in `docs/handoff.md` |
| P7 onwards | In progress | |

## 2. Decisions I made so the prompts could be written (change them before the step that uses them)
| # | Decision | Default used | Why / alternative |
|---|---|---|---|
| 1 | Working database | **`zoauro`** for building; a **fresh `zoauro_showcase`** for stakeholder rehearsal (P20). `zoauro_demo` is kept only to show volume/filter speed, **labelled synthetic** | Audit rows can never be deleted, and 20,000 rows with no real actors would show invented history in the demo. Using it for sign-in would also need a seed on top of fake data |
| 2 | 2-step verification in this phase | **Yes**: authenticator (TOTP), backup codes, email OTP. **SMS: interface + switch only, off** (D67, D68 open) | You asked for a full system and for 2-step earlier. It is ≈ 4 dev-weeks of the work; if you want a faster first demo, drop P7–P10 and demo them later (checkpoint B below) |
| 3 | Zones scope | **Full doc 53**: CRUD, pincodes with overlap protection, lifecycle (Upcoming/Active/Inactive), impact check, resolver, audit, events. D81–D90 defaults. D88 (order prefix) not needed now | "Smallest" and "full-fledged" pull in opposite directions; the pincode integrity and lifecycle are the parts that are costly to retrofit. Impact counts show **"partial: other modules not built yet"** honestly |
| 4 | Zonal Admin in the demo | Two **labelled sample** members (e.g. "Sample Zonal Admin A") created by a seed script with assignments to sample zones. **No member-management UI** (that is M03, Coming Soon) | Without them nothing proves "role and zone authorization". Zonal Admins cannot see the Zones page or free Audit listing by design (doc 04 non-grantable, doc 50 §2.2), so their demo is: reduced menu, 403 on direct URL/API, own account security. The richer zone-scoped demo arrives with Restaurants/Orders |
| 5 | Email | SMTP to local **Mailpit** (`SMTP_URL` exists), a `Mailer` port with a capture double in tests | Needed for reset, new-login notice and email OTP |
| 6 | Design | Existing Tailwind/shadcn components and neutral palette; one small tokens step inside P14; no Figma pixel work | F0.6 tokens were never done |
| 7 | Node | Keep local v24 (handoff note); add the doc 32 row later | Not blocking |

## 3. Steps at a glance (dependency order; reasons in the right column)
| Step | What | DB change? | Why here |
|---|---|---|---|
| **H** | *Human:* rotate Neon, remove the root `DATABASE_URL`, answer the decisions above | – | Live remote credential; nothing else should start before it |
| P0 | Repo hygiene: commit the pending handoff block, deal with `.env.example` Neon line | No | Clean tree before branches/commits |
| P1 | DB target + preflight; apply the one pending migration to `zoauro` (approval gate) | **Yes** (additive index) | Everything after assumes `zoauro` matches the code |
| P2 | Test stability: idempotency flake, `DROP DATABASE FORCE` helper | Test DBs only | Acceptance #10 needs trustworthy tests before 20 more prompts add tests |
| P3 | Audit hardening: DENIED rows, trust proxy, email masking, boot role check, detail endpoint scope | No | 2-step writes DENIED rows and relies on `req.ip`; fix the pattern before it is copied |
| P4 | Auth schema migration (MFA tables, session fields) | **Yes** (gated) | Schema first, in series |
| P5 | Zones schema migration (doc 53 §3) | **Yes** (gated) | Same |
| P6 | Auth core: mailer, CSRF, change-password, sessions, remember-me, real `/me` | No | Shell and every UI need `/me` and working sessions |
| P7 | 2-step libraries: crypto, TOTP, backup codes, password policy | No | Pure code, easy to verify |
| P8 | Two-step login state machine + TOTP/backup verify | No | |
| P9 | OTP service, email OTP, SMS interface (off), caps | No | |
| P10 | Enrolment, management, step-up, recovery CLI, security policy API | No | |
| P11 | Zones backend: service, API, pincodes, impact, audit, events | No | |
| P12 | Zone resolver + cache | No | |
| P13 | Demo seed script (Super Admin via secure prompt, sample Zonal members) | **Yes** (data, gated) | Needed before any UI can be exercised |
| P14 | Frontend foundation: shell, protected layouts, error/loading/404, Coming Soon | No | Moved ahead of module UIs so each UI lands in a real shell |
| P15 | Auth frontend: login, 2-step, setup wizard, reset/change password, account security | No | **Checkpoint A** after this |
| P16 | Zones frontend | No | |
| P17 | Audit integration: nav, ActivityTab on zones, sign-in logs view | No | |
| P18 | End-to-end flows + authorization tests | Test DBs | |
| P19 | Security and regression pass | No | |
| P20 | Startup scripts, docs, `zoauro_showcase` database and rehearsal (gated) | **Yes** (new DB) | |
| P21 | Independent verification (read-only) | No | |
**Checkpoints you can demo early:** **A** after P15 (login → shell → System Logs with real data, other modules Coming Soon); **B** after P16–P17 (adds Zones with audit trail); **C** after P10 + its UI inside P15 (2-step end to end). If time is short, P7–P10 can slip after B without rework, because P6 and P15 are written with the 2-step screens as a later addition (P15 builds the verify/setup screens only if P8–P10 are merged; the prompt says what to do otherwise).

## 4. Preamble: paste at the top of EVERY prompt below
```
COMMON RULES (apply to the whole task)
- Read AGENTS.md and the last 3 blocks of docs/handoff.md first. Inspect before editing. Reuse existing code; do not recreate anything already implemented and verified.
- Follow the repository's real conventions (package names @zoauro/api, @zoauro/web, @zoauro/shared, folder names, route groups such as (super-admin), script names) over any path written in the prompt. If a document and the code disagree, list the disagreement and stop unless the prompt says how to resolve it.
- Never print, log or store secrets (database URLs, passwords, tokens, cookies, keys). Refer to a database only as <role>@<database name>.
- Database: the only permitted target is the one named in the prompt. Before ANY database write, migration or seed: print the target (role, database name, host), the exact operation and the safety checks, then WAIT for my reply "approved". Never connect to any host other than localhost. Never reset, truncate, drop or recreate a database. Treat `zoauro`, `zoauro_demo`, `zoauro_showcase` and the zoauro_audit_test_* databases as separate.
- Git: stage by explicit file path only; never `git add -A` or `git add .`; never touch the committed `home/` directory; commit only when lint, typecheck and tests for the touched packages are green; do not push.
- Stop and report (do not fix forward) if you find unexpected working-tree changes, an unsafe database target, a missing prerequisite, or a failing verification.
- Do not weaken authentication, authorization, CSRF, rate limits, validation or any test to make something pass. Do not add libraries, endpoints, fields or permissions that the specification documents do not define; ask instead.
- Finish with: files changed, commands run and their results, tests added, what is still unverified, and append a handoff block to docs/handoff.md.
```

---
## H. Human step (you, 10 minutes)
1. In the Neon console, **rotate the `neondb_owner` password** (it was printed into an earlier session transcript). Open the root `.env` in an editor and delete the `DATABASE_URL` line yourself (do not paste it anywhere). Keep `ZOAURO_PG_PORT`.
2. Confirm or change the seven decisions in §2. Reply "decisions as written" or list changes.
3. Decide a demo Super Admin email (use a dummy such as `admin@zoauro.local`). You will type the password into the terminal prompt in P13, never into chat or files.

---
## P0 — Repository hygiene
| Field | |
|---|---|
| Goal | Clean tree: commit the pending handoff block, resolve the `.env.example` Neon line |
| Prereqs | H.1 done |
| Inspect/change | `docs/handoff.md`, `.env.example`, `.gitignore`; **not** `home/` |
| Commands | `git status --short`, `git diff -- .env.example docs/handoff.md` |
| DB | No |
| Expected | `git status` clean; one commit; a list of what else in the repo is committed but suspicious (`home/`) reported, not changed |
| Verify | `git status --short` prints nothing; `git log -3 --oneline` shows the new commit |
| Rollback | `git revert <commit>` |
| STOP if | other modified or untracked files appear |
```
[paste COMMON RULES]
TASK P0 — repository hygiene. No database access.
1) Show `git status --short` and the diff of `.env.example` and `docs/handoff.md`.
2) Commit ONLY docs/handoff.md (explicit path) with message "docs: handoff for AU-6 system logs".
3) For `.env.example`: the uncommitted change adds a commented placeholder for a remote (Neon) database. Show it to me and recommend removal because the project is local-only; do NOT edit until I answer.
4) Verify `.gitignore` ignores `.env` and `.env.*` (except *.example) at every directory level; report, do not change unless wrong (then ask).
5) Report (do not change) anything committed that looks like it does not belong (the `home/` directory), and the three leftover zoauro_audit_test_* databases only by name if you can see them without a database connection (otherwise skip).
Stop after the report.
```

## P1 — Database target preflight and the pending migration
| Field | |
|---|---|
| Goal | Make `zoauro` match the code (5 migrations) and prove which database every script targets |
| Prereqs | P0; containers `zoauro-postgres` (5441), `zoauro-redis` (6390), `zoauro-mailpit` already running |
| Inspect/change | `apps/api/.env` (names only), `apps/api/package.json` scripts, `prisma/seed.ts`, migration `20261012000000_audit_zone_module_action_index` |
| Commands | `docker ps --format '{{.Names}} {{.Status}}'` (read-only); then, **after approval**, the repo's migrate command in deploy mode against `zoauro` (find the exact form in the `db:migrate` wrapper; do not use `migrate dev` or `reset`) |
| DB | **Yes**: one additive index migration on `zoauro` as `zoauro_owner` |
| Expected | `_prisma_migrations` lists 5 rows; `audit_logs` has 10 indexes in total (1 primary key + 9 secondary), including `audit_logs_zone_id_module_action_id_idx`; nothing else changed |
| Verify | `select count(*) from _prisma_migrations` = 5; `\d audit_logs` shows 10 indexes in total (1 primary key + 9 secondary), including `audit_logs_zone_id_module_action_id_idx`; `zoauro` still has 0 users/zones |
| Rollback | `DROP INDEX` of the new index as owner (additive only) |
| STOP if | any migration other than that one is pending, a checksum mismatch appears, or the target is not localhost:5441/`zoauro` |
```
[paste COMMON RULES]
TASK P1 — database preflight. Target for any write: zoauro_owner@zoauro on localhost:5441 ONLY.
1) Read-only: list running containers (do not start/stop any); read the NAMES of variables in apps/api/.env and tell me which database and role each of DATABASE_URL, DATABASE_URL_MIGRATE and DATABASE_URL_AUDIT_PURGE uses (values hidden); read the db:migrate and db:seed wrappers and tell me exactly which env they read.
2) Read-only SELECTs on zoauro: applied migrations, counts of users, zones, audit_logs, login_history.
3) Compare with the migration folders on disk; the expected pending one is 20261012000000_audit_zone_module_action_index. If anything else differs, STOP and report.
4) Print the operation (apply that single migration with deploy semantics, no reset, no dev mode), the target and the safety checks. WAIT for "approved".
5) After approval apply it, then re-verify: 5 migrations, 10 indexes in total on audit_logs (1 primary key + 9 secondary, including audit_logs_zone_id_module_action_id_idx), other counts unchanged.
6) Add a short "Working database" section to docs/handoff.md: zoauro = development, zoauro_demo = synthetic volume data only, zoauro_showcase = planned.
Do not touch zoauro_demo or any zoauro_audit_test_* database.
```

## P2 — Test stability
| Field | |
|---|---|
| Goal | `pnpm test` is trustworthy: no random failures from the idempotency replay or the `DROP DATABASE … FORCE` helper |
| Prereqs | P1 |
| Inspect/change | idempotency middleware and its tests (`apps/api/src/lib/idempotency/*`, `tests/idempotency`), `apps/api/tests/audit/support/db.ts` |
| Commands | `pnpm --filter @zoauro/api test` three times in a row |
| DB | Test code creates/drops its own throwaway `zoauro_audit_test_*` databases only |
| Expected | Three consecutive full runs green |
| Verify | the three runs; report counts each time |
| Rollback | `git revert` |
| STOP if | a test could touch `zoauro`, `zoauro_demo` or `zoauro_showcase` |
```
[paste COMMON RULES]
TASK P2 — remove two known test flakes. 
Known: (a) idempotency replay tests ("replays an empty 204", "a crash (500) releases the key") fail intermittently because the response is stored just after it is sent; (b) a permission error on `DROP DATABASE ... FORCE` in apps/api/tests/audit/support/db.ts under full-suite load.
1) Read both, find the root causes, and show me the cause and your proposed fix before editing (plan mode).
2) Fix (a) so the key/response is persisted before the response is flushed, or the replay path waits for the in-flight key; keep the documented semantics (only 2xx stored; same key + different body is 422). Do not add sleeps or retries to tests.
3) Fix (b) in the test helper only (e.g. terminate connections with the proper privilege, or retry the drop deterministically); prove the helper can only ever operate on databases named zoauro_audit_test_* and refuses any other name.
4) Run `pnpm --filter @zoauro/api test` three times consecutively and report every failure. The 14 skipped and 1 todo tests stay as they are.
Done when three consecutive full runs are green. Commit separately for (a) and (b).
```

## P3 — Audit hardening (things Auth and Zones depend on)
| Field | |
|---|---|
| Goal | Close five audit-review items now: DENIED rows, trust proxy, label masking, boot role check, detail-endpoint scope |
| Prereqs | P2 |
| Inspect/change | `lib/audit/*`, `lib/env.ts`, `app.ts`, `modules/audit/*`, `modules/auth/auth.service.ts` (userEntity), `lib/db.ts` |
| DB | No schema change; tests only |
| Expected | Route-level proof that 10 denied attempts in a minute write exactly 1 DENIED row; `TRUST_PROXY_HOPS` works; no email in `entity_label`; API refuses to boot as any role except `zoauro_app` |
| Verify | new tests (named in the prompt) green; `grep -rn "recordDenied" apps/api/src` shows production call sites |
| STOP if | a fix needs a schema change |
```
[paste COMMON RULES]
TASK P3 — audit hardening. Spec: docs/F-execution/50_* sections 2.1, 4.3, 8. Five items, one commit each:
1) DENIED rows: create the audit service instance (createAudit with the Redis-backed limiter, 1 per minute per actor+action, D62) at startup and expose recordDenied() to modules. Use it for the doc 50 §4.3 DENIED allow-list. Change `reauth.failed` so a failed re-authentication is written with outcome DENIED through recordDenied(). Test at route level: 10 failed reauth calls in one minute produce exactly one DENIED row.
2) Trust proxy: add env TRUST_PROXY_HOPS (non-negative integer, default 0) to env validation, both .env.example files and app.ts (`trust proxy`). Test with X-Forwarded-For: req.ip is the forwarded address when hops=1 and the socket address when 0.
3) Labels: stop putting the staff email into entity_label for user.locked, user.unlocked, reauth.failed and session.revoked (use the user's name and id). In login_history.email_attempted store the address in lower case only when it matches an existing user, otherwise a mask (first character, ***, domain), max 254 chars. Test that a password typed into the email field is never stored verbatim.
4) Boot guard: after connecting, `select current_user` must equal the role in DATABASE_URL and be in an allow-list env (default ["zoauro_app"]); otherwise refuse to start with a message that names the role but not any credential. Test with a stub.
5) GET /audit-logs/{id} for a non-Super-Admin must apply the same entity-mode restriction as the list. Add authorization tests for Admin(A), Admin(A+B), Admin(none): another zone's id and a hidden-module id both return 404.
Do not change the schema. Do not touch the idempotency code (done in P2).
```

## P4 — Auth schema migration
| Field | |
|---|---|
| Goal | MFA tables and session/login-history fields exist; audit catalogue knows the new actions |
| Prereqs | P3 (verified, not assumed); `zoauro` has 0 users (required for the two column drops; re-checked read-only just before applying) |
| Inspect/change | `apps/api/prisma/schema.prisma`, a **new** migration only, `packages/shared/src/auth.ts`, `packages/shared/src/audit/actions.ts`, audit redaction registry |
| Commands | Generate the SQL with `prisma migrate diff` (step 3), which does not touch `zoauro`; **never** `prisma migrate dev` (including `--create-only`) or `migrate reset` against `zoauro`. After approval apply with `pnpm db:migrate migrate deploy` |
| DB | **Yes**, `zoauro`: additive changes plus 2 column drops on an empty table. The drops need their own explicit approval and a read-only safety check immediately before applying (step 3c) |
| Expected | Tables `user_mfa_methods`, `mfa_challenges`, `mfa_backup_codes`; partial unique index; columns per doc 52 §3; all new audit actions in the catalogue; schema-walker test green |
| Verify | `\d` of the three tables; `pnpm --filter @zoauro/shared test`; audit schema tests; `pnpm typecheck` |
| Rollback | A reverse migration written as a new migration (never edit an applied one); the dropped columns held no data |
| STOP if | `users` is not empty, the generated SQL contains anything beyond the doc 52 §3 changes, or generating it would need `migrate dev`, a reset, or a shadow database other than a new dedicated throwaway one |
```
[paste COMMON RULES]
TASK P4 — Auth schema. Spec: docs/F-execution/52_* sections 3 and 4. Target for the write: zoauro_owner@zoauro on localhost:5441.
1) Read the current User, Session, LoginHistory models and the existing migrations. Confirm via read-only SELECT that users has 0 rows; if not, STOP.
2) Edit schema.prisma per doc 52 §3: enums MfaType, MfaPurpose; models UserMfaMethod, MfaChallenge, MfaBackupCode; remove users.mfa_secret_encrypted and users.backup_codes_hash; add users.phone_verified_at and password_changed_at; sessions: mfa_verified_at, mfa_method, remember, reauth_at, reauth_level, restricted; login_history: mfa_method (reason values documented in code as a Zod enum, not a DB enum unless the table already uses one).
3) Generate the migration SQL without touching zoauro. Do NOT run `prisma migrate dev` (not even `--create-only`) against zoauro: it checks for drift, can offer a reset, and an earlier `--create-only` run applied a migration to the local database (docs/handoff.md, AU-1 note 2). Instead:
   a) Use `prisma migrate diff` from the committed migrations folder to the edited schema.prisma, printing SQL (`--script`) to the terminal. Prisma 7 renamed some flags: confirm the exact form with `pnpm --filter @zoauro/api exec prisma migrate diff --help` first and show me the command before running it. If that form needs a shadow database, it must be a new, dedicated `zoauro_audit_test_<8 lowercase hex>` database created for this purpose after my approval (Prisma wipes a shadow database); never `zoauro`, `zoauro_demo`, `zoauro_showcase` or an existing leftover test database. If no safe form exists, STOP and ask.
   b) Save the SQL by hand as a new folder `apps/api/prisma/migrations/<timestamp later than 20261012000000>_<name>/migration.sql`. Add by hand the partial unique index on user_mfa_methods (user_id, type) WHERE disabled_at IS NULL. Show me the full SQL, listing the two `DROP COLUMN` statements (users.mfa_secret_encrypted, users.backup_codes_hash) separately.
   c) Column drops are destructive and need their own explicit approval of those exact statements. Immediately before applying, re-run read-only checks on zoauro and show the results: `users` has 0 rows, and neither column holds a non-null value. If either check fails, STOP; do not drop.
   d) Validation without zoauro: with my approval, run the API test suite, whose throwaway databases apply every migration with `migrate deploy`.
   e) WAIT for "approved", then apply to zoauro only with `pnpm db:migrate migrate deploy` (deploy semantics; no reset, no dev mode) and verify with read-only queries.
4) packages/shared: Zod schemas and enums for login (with status OK | MFA_REQUIRED | ENROLMENT_REQUIRED), mfa challenge/verify, enrolment, reauth levels, member reset, security policy with the floors/ceilings of doc 52 §2.2 and §5 (SUPER_ADMIN always required, always allows AUTHENTICATOR; SMS_OTP only with smsEnabled). Unit tests: a value just inside each bound passes, just outside fails.
5) Add the new actions of doc 52 §4 to AUDIT_ACTIONS and register secret_encrypted/code_hash as DROP in the redaction registry; run the audit tests.
Done when: lint, typecheck, shared tests and audit tests are green and the migration is applied to zoauro only.
```

## P5 — Zones schema migration
| Field | |
|---|---|
| Goal | `zones` and `serviceable_pincodes` match doc 53 §3, enforced by the database |
| Prereqs | P4; `zoauro` has 0 zones |
| Inspect/change | `schema.prisma` (Zone, ServiceablePincode), the existing `constraints` migration (do not duplicate its checks), a **new** migration, `packages/shared/src/zones/*` |
| DB | **Yes** (`zoauro`, empty tables) |
| Expected | UNIQUE(code) incl. soft-deleted; unique lower(name) where not deleted; UNIQUE(pincode); CHECKs; status default UPCOMING; `color_hex` NOT NULL; new columns |
| Verify | direct-SQL tests as `zoauro_app`: duplicate pincode, bad code, charge 100001 are rejected by the database |
| Rollback | reverse migration as a new migration |
| STOP if | zones is not empty, or an existing constraint conflicts |
| **Schema decision needed** | `zones.code` today has a **partial** unique index, `zones_code_active_key ON zones (code) WHERE deleted_at IS NULL` (migration `20261010131000_constraints`), so a soft-deleted zone's code can be reused. Doc 53 §3 asks for UNIQUE(code) **including** soft-deleted rows, which means replacing that index, not adding a duplicate. The owner must decide (replace with a full unique constraint, or keep the partial index and amend doc 53) before this step's migration is written. Generate the SQL as in P4 step 3, never with `migrate dev` |
```
[paste COMMON RULES]
TASK P5 — Zones schema. Spec: docs/F-execution/53_* sections 2.3, 3, 4. Target for the write: zoauro_owner@zoauro on localhost:5441.
1) Read the current Zone and ServiceablePincode models and every existing migration touching them (init, constraints). List what already exists vs what doc 53 §3 requires. Confirm via read-only SELECT that zones is empty.
2) Migration: generate the SQL with the P4 step 3 workflow (`prisma migrate diff` printing SQL only; any shadow database must be a new, approved throwaway `zoauro_audit_test_<8 lowercase hex>`; never `prisma migrate dev`, never a reset), save it as a new migration folder, show me the full SQL and WAIT for "approved"; only then apply to zoauro with `pnpm db:migrate migrate deploy` and verify with read-only queries. The migration must: add version, activated_at, deactivated_at, deactivation_reason, created_by, deleted_at where missing; status default UPCOMING; color_hex NOT NULL; CHECK code ~ '^[A-Z][A-Z0-9]{1,5}$'; CHECK delivery_charge BETWEEN 0 AND 100000; UNIQUE(code) including soft-deleted (ONLY after the owner's schema decision in the table above; it replaces the existing partial index zones_code_active_key); unique index on lower(name) where deleted_at IS NULL; serviceable_pincodes: pincode char(6) with CHECK '^[1-9][0-9]{5}$', source enum PincodeSource (RANGE, MANUAL, IMPORT), UNIQUE(pincode), index on zone_id. Do not duplicate constraints that already exist.
3) packages/shared/src/zones: pincode.ts (normalise, validate, expandRange with the 2000 cap), palette.ts (12 tokens), Zod schemas (create, patch, pincodes, deactivate), error codes. Pure unit tests with valid/invalid tables and range edge cases (2000 ok, 2001 refused).
4) Add zone.delivery_charge_changed, zone.pincodes_changed, zone.deleted to AUDIT_ACTIONS.
5) Database test (against the throwaway test database the existing suites use, never zoauro): inserting as zoauro_app a duplicate pincode, a bad code and charge 100001 each fail with a constraint error.
Done when: lint, typecheck, shared and audit tests are green and the migration is applied to zoauro only.
```

## P6 — Auth core completion
| Field | |
|---|---|
| Goal | A real, usable password flow: email works, CSRF, change-password, session management, real `/me` |
| Prereqs | P5 |
| Inspect/change | `modules/auth/*`, `lib/auth/*`, a new `lib/mailer` (port + SMTP adapter + capture double), `/me`, OpenAPI files, `packages/api-client` regenerated |
| DB | No schema change (uses P4 fields); tests use throwaway DBs |
| Expected | Reset email visible in Mailpit; forced-change user completes via `/auth/change-password`; `GET /me/sessions`, revoke, 4th-login rule; `/me` returns zones with permissions and limits (doc 09) |
| Verify | tests TC-AUTH-1,2,4,5,8,35,36(PASSWORD),37,38,39,40,41,42,43 (doc 52 §11); `pnpm openapi:generate && pnpm openapi:check` |
| STOP if | `/me` shape change breaks the authz matrix tests in a way that needs a permission-model decision |
```
[paste COMMON RULES]
TASK P6 — complete password authentication. Spec: docs/F-execution/52_* sections 2.1 (steps 1 and 3), 2.6, 2.7, 8; docs/C-security/14_* sections 1-4; docs/B-architecture/09_* (/me).
Audit first: list which of these already exist in apps/api/src/modules/auth and lib/auth and implement ONLY the gaps.
1) Mailer port (interface + SMTP adapter reading SMTP_URL, pointing at Mailpit locally; a capture double for tests). Wire it into forgot-password, new-login notice, password-changed notice. Plain-text and simple HTML templates, no secrets in logs.
2) GET /auth/csrf and CSRF (double-submit cookie + X-CSRF-Token) enforced on every POST/PUT/PATCH/DELETE including /auth/*. 
3) POST /auth/change-password (current + new, policy: min length 12, local denylist of common passwords checked into the repo) and the forced first-login change as a "restricted" session that can call only /auth/change-password, /me and /auth/logout.
4) Sessions: remember-me (7 days absolute, 8 h idle, D79), max 3 active sessions (revoke the oldest on a 4th, audit session.revoked), GET /me/sessions, DELETE /me/sessions/{id}, POST /me/sessions/revoke-others; password change/reset revokes the other sessions.
5) GET /me returns role, name, and for ZONAL_ADMIN zones[] each with granted permissions and limits computed by the existing resolver (doc 09), and a global flag for SUPER_ADMIN; include mfa:{enabled:false, required:false, enrolmentNeeded:false} placeholders typed for P8. Keep the authz matrix tests green; if the shape change needs a decision, STOP and ask.
6) Regenerate OpenAPI and the api-client; `pnpm openapi:check` must pass.
Tests: the TC-AUTH ids listed in the step table, a cookie-flags test, one audit-row assertion per audited action. Do NOT implement any second-step logic.
```

## P7 — 2-step libraries
| Field | |
|---|---|
| Goal | Verified building blocks: AES-GCM sealing, TOTP, backup codes, HMAC helpers |
| Prereqs | P6 |
| Inspect/change | new files in `modules/auth/` (`crypto.ts`, `totp.ts`, `backup-codes.ts`), `lib/env.ts` (OTP_HMAC_KEY, MFA_ISSUER, ENCRYPTION_KEY_PREVIOUS), `.env.example` files, `package.json` of `@zoauro/api` (otplib already planned) |
| DB | No |
| Expected | RFC 6238 vectors pass; replay guard; tamper test; previous-key open works |
| Verify | `pnpm --filter @zoauro/api test` for the new files; `grep -rn "Math.random" apps/api/src` empty |
| STOP if | otplib is not installed and adding it is not allowed by the stack doc (doc 06 names it, so adding is allowed: tell me the exact version before installing) |
```
[paste COMMON RULES]
TASK P7 — 2-step building blocks. Spec: docs/F-execution/52_* sections 2.2, 5 (environment), 7. No routes, no database.
1) crypto.ts: AES-256-GCM seal/open with a key-id prefix, key from ENCRYPTION_KEY, optional ENCRYPTION_KEY_PREVIOUS (open tries current then previous); hmac(OTP_HMAC_KEY, ...) helper; timing-safe compare. Add OTP_HMAC_KEY (>= 32 bytes, must differ from SESSION_SECRET and ENCRYPTION_KEY) and MFA_ISSUER to env validation and both .env.example files (placeholders only); the API must fail fast with a clear message.
2) totp.ts: wrap otplib. First check whether otplib is installed; if not, tell me the exact version you would add and wait. READ the installed type definitions before writing (version 13 changed its API from 12). SHA-1, 6 digits, 30 s, accept current and +-1 step, return the matched step so callers enforce replay protection.
3) backup-codes.ts: generate 10 codes (10 Crockford-base32 chars shown XXXXX-XXXXX), normalise input, hash with the HMAC helper, consume helper.
Tests: RFC 6238 SHA-1 vectors; replay rejection; +-1 accepted, +-2 rejected; AES-GCM round trip, tamper fails, wrong key fails, previous key opens; backup-code normalisation table.
```

## P8 — Two-step login
| Field | |
|---|---|
| Goal | Login becomes two-step with no session before the second step |
| Prereqs | P7 |
| Inspect/change | `modules/auth/*` (login, new `pending.ts`, `mfa.routes.ts`), security policy reader (reads `settings` with defaults from doc 52 §5; no write endpoint yet), audit |
| DB | No schema change; reads `settings` |
| Expected | Correct password with an enrolled user → `MFA_REQUIRED`, cookie `zo_mfa`, **no** `zo_sid`; `/me` is 401 with only `zo_mfa`; TOTP and backup code finish the login |
| Verify | TC-AUTH-6,7,9,10,11,21,26,38,39 + route test that module routes reject a request holding only `zo_mfa` |
| STOP if | the policy reader needs a settings module that does not exist (then create only the minimal reader and tell me) |
```
[paste COMMON RULES]
TASK P8 — two-step login state machine. Spec: docs/F-execution/52_* sections 2.1, 2.2 (TOTP, backup codes), 2.5, 8, 10 (T30, T33, T36, T38, T39). Methods in this step: AUTHENTICATOR and BACKUP_CODE only; EMAIL_OTP/SMS_OTP return a typed "not available yet" until P9.
- pending.ts: Redis pending-login store (5 min), opaque id in cookie zo_mfa (HttpOnly, Secure, SameSite=Strict, Path=/api/auth), single use.
- /auth/login after a correct password: MFA_REQUIRED (user has a verified method allowed for the role), ENROLMENT_REQUIRED (none, policy requires), or OK. Methods are listed only after the password is correct.
- POST /auth/mfa/verify: the method must be allowed for the role and enrolled for the user, otherwise the same generic failure; TOTP with last_used_step replay guard updated in the same transaction; backup code consumed in the same transaction; every failure increments users.failed_attempts (5th locks 30 minutes, D37/D77) and ends the pending login; success mints a NEW session id, records login_history with mfa_method, sends the new-login email, clears pending.
- Audit: user.mfa_challenge_failed via recordDenied() (rate limited), user.backup_code_used, user.locked.
- Password reset must not bypass or remove 2-step (test).
Tests: TC-AUTH-6, 7, 9, 10, 11, 21, 26, 38, 39 plus a test that /me and every other protected route reject a request that has only zo_mfa. Use an injectable clock. After the tests pass, do these 4 mutation checks on a scratch copy and report whether each makes a test fail: skip the replay guard; skip the attempts increment; compare codes with ===; return methods before the password check.
```

## P9 — OTP service, email OTP, SMS interface (off)
| Field | |
|---|---|
| Goal | Email OTP works end to end through Mailpit; SMS exists only as an interface that cannot send |
| Prereqs | P8 |
| Inspect/change | new `otp.service.ts`, `sms/*`, email templates, nightly cleanup job in the worker if a job runner exists (if none exists, note it and skip) |
| DB | No schema change |
| Expected | Code arrives in Mailpit; 2nd request within 30 s refused; 5 wrong guesses kill the code; caps hold; `smsEnabled` cannot be true without a real provider |
| Verify | TC-AUTH-12–20 |
| STOP if | a real SMS provider would be required |
```
[paste COMMON RULES]
TASK P9 — OTP and email OTP. Spec: docs/F-execution/52_* sections 2.2 (table), 2.7, 5, 6, 8, 10 (T30, T31).
1) otp.service.ts: 6-digit CSPRNG code (crypto.randomInt), store HMAC(challengeId||code) only, limits from policy with the floors/ceilings (TTL 5 min, 5 guesses, 30 s cooldown, 5/h and 10/day per user and channel, Redis counters), resend replaces the code on the same row, destination ALWAYS the account email on record, single use consumed in the same transaction as the login success, one generic failure message for wrong/expired/consumed.
2) POST /auth/mfa/challenge and the EMAIL_OTP branch of /auth/mfa/verify; 429 with retryAfter. Email template with no links. Never log the code.
3) SMS: interface SmsProvider, DisabledSmsProvider (default, fails closed), ConsoleSmsProvider (dev/test only, refuses to load in production). Env SMS_PROVIDER (none|console), SMS_DLT_* names in env validation. Policy validation: smsEnabled=true is rejected unless the provider is real and SMS_DLT_TEMPLATE_ID_OTP is set. Global hourly cap + circuit breaker as doc 52 §2.2. DO NOT write a real provider adapter and DO NOT choose a vendor (decision D68 is open).
4) Cleanup job for expired challenges only if a job runner already exists.
Tests: TC-AUTH-12, 13, 14, 15, 16 (assert neither the database nor captured logs contain a plaintext code), 17, 18, 19, 20. Mutation checks: accept a request-supplied destination; skip attempts increment. Report results.
```

## P10 — Enrolment, management, step-up, recovery, policy
| Field | |
|---|---|
| Goal | Users can enrol/remove methods, step-up works, admin and CLI recovery exist, Super Admin can edit the policy |
| Prereqs | P9 |
| Inspect/change | `mfa.routes.ts`, `reauth.ts`, `cli/mfa-reset.ts` (a CLI folder may not exist: create under `apps/api/src/cli` and add a script), `/settings/security*`, `/members/{id}/mfa/reset` (route lives here, a member list is not needed) |
| DB | No schema change |
| Expected | TC-AUTH-22–25, 27–34, 36(STRONG), 44 pass |
| STOP if | a member endpoint needs the M03 module that does not exist (build only the reset route, nothing else) |
```
[paste COMMON RULES]
TASK P10 — enrolment, management, recovery, policy. Spec: docs/F-execution/52_* sections 2.3, 2.4, 2.5, 5, 8, 10 (T32, T34, T35, T37).
1) /me/mfa endpoints (GET, email start/confirm, authenticator start/confirm, sms start/confirm, PUT primary, DELETE {type}, backup-codes/regenerate) accepting a full session OR the pending cookie in stage ENROL. The first method requires mailbox proof (ENROL_PROOF) before /authenticator/start. The authenticator secret is returned once and stored encrypted; backup codes returned once at the first confirmed method. POST /auth/mfa/enrol/complete requires a verified allowed method and acknowledged codes, then mints the session.
2) Step-up: requireRecentReauth('PASSWORD'|'STRONG'); /auth/reauth accepts a code for STRONG; STRONG is single-use, 5 minutes. Apply STRONG to DELETE /me/mfa/{type}, backup-code regeneration, POST /members/{id}/mfa/reset, PUT /settings/security.
3) Recovery: POST /members/{id}/mfa/reset (Super Admin, reason required, deletes methods and codes, revokes sessions, emails the member, audit user.two_factor_reset); CLI `mfa:reset --email --reason` (script in apps/api/package.json) that refuses unless run with the API environment, audits as SYSTEM with the OS user in note, and refuses any database other than the one in DATABASE_URL_MIGRATE; hook function for M03 to clear methods when email/phone change (function + test only).
4) GET/PUT /settings/security (Zod policy, STRONG on PUT, diff + audit settings.2fa_policy_changed, effective within 60 s) and GET /settings/security/status (counts enrolled/not by role, active Super Admin count, SMS state, failed second steps in 24 h).
5) Regenerate OpenAPI and the api-client; `pnpm openapi:check` passes.
Tests: TC-AUTH-22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 36, 44. Mutation checks: skip mailbox proof; return the secret after enrolment; allow reset without STRONG. Report results.
```

## P11 — Zones backend
| Field | |
|---|---|
| Goal | The full zone API with integrity rules, audit and events |
| Prereqs | P5 (and P3 for audit hardening) |
| Inspect/change | `apps/api/src/modules/zones/*` (new), permissions for `zones:*`, OpenAPI, the existing outbox/event mechanism (if none exists, write rows to the table that exists in doc 08 and note it) |
| DB | No schema change |
| Expected | TC-ZONE-5–18, 22–27 |
| STOP if | no outbox table/mechanism exists for `zone.updated` (report; do not invent one) |
```
[paste COMMON RULES]
TASK P11 — Zones backend. Spec: docs/F-execution/53_* sections 2.1, 2.2, 2.6, 5, 7, 8; docs/B-architecture/09_* (zones). Follow the repository layering (route -> controller -> service -> repository; only repositories import Prisma; every repository method takes AuthContext).
Endpoints (Super Admin only; Zonal Admin gets 403 on all of them): GET /zones, GET /zones/summary, POST /zones, GET /zones/{id}, PATCH /zones/{id}, PUT /zones/{id}/pincodes (?preview=true dry run), GET /zones/lookup?pincode=, POST /zones/{id}/activate, GET /zones/{id}/impact, POST /zones/{id}/deactivate, DELETE /zones/{id}, GET /zones/{id}/team (read-only; empty with partial:true because access management is not built).
Rules: code immutable; optimistic version (409 STALE_VERSION); transitions only UPCOMING->ACTIVE, ACTIVE<->INACTIVE, UPCOMING->INACTIVE; activation preconditions; deactivation needs reason, impactVersion match and PASSWORD re-auth and performs no writes to vendors/partners/orders; delete only for a zone with no history; pincode overlap check inside a transaction guarded by pg_advisory_xact_lock; range edits touch only source=RANGE rows; removing pincodes returns a mismatch list and moves nothing.
impact.service.ts: define the port interface ImpactSources with stub implementations returning zeros and partial:true until the other modules exist (the UI must be able to tell).
Every write: one transaction containing the change, the audit row (delivery charge and pincode changes use their own actions) and the event/outbox rows for zone.updated and the internal change event, then bump the zones:version cache counter after commit.
Tests: TC-ZONE-5..18, 22..27 including a real concurrency test (two connections, one pincode), authorization actors Super Admin, Admin(A), Admin(A+B), Admin(none). Mutation checks: remove the advisory lock; allow code patch; cascade-update vendors on deactivate. Report results. Regenerate OpenAPI and the api-client.
```

## P12 — Zone resolver
| Field | |
|---|---|
| Goal | `resolve` service (pincode only, D83) with cache; route registered if the intake framework exists |
| Prereqs | P11 |
| Inspect/change | `modules/zones/resolve.service.ts`; intake framework presence (`/api/v1/intake`; the audit says `tools/simulators` is absent, check the intake routes) |
| DB | No |
| Expected | ACTIVE → serviceable + charge; UPCOMING → not serviceable; INACTIVE/unknown → NONE; lat/lng ignored (documented) |
| Verify | TC-ZONE-19, 20, 21, 30 (performance numbers reported, not claimed) |
```
[paste COMMON RULES]
TASK P12 — zone resolver. Spec: docs/F-execution/53_* sections 2.3 and 2.5; docs/G-integration/contracts/intake.openapi.yaml (ZoneResolution) and events.catalog.json (zone.updated). 
Implement resolve.service.ts: normalise the pincode, look up serviceable_pincodes, map status (ACTIVE -> serviceable with deliveryChargePaise; UPCOMING -> not serviceable, status UPCOMING; INACTIVE and unknown -> NONE), lat/lng accepted but not used (comment this and keep it in the doc note), Redis cache zones:pin:<pincode> TTL 300 s keyed with the global zones:version counter bumped by P11. Do NOT change the contract files. If an intake framework already exists, register GET /zones/resolve with scope zones:resolve and a per-client rate limit; if not, ship the service and a contract test that validates its output against ZoneResolution and tell me route registration waits for the intake module.
Tests: TC-ZONE-19, 20, 21; a performance test on 10,000 seeded pincodes in a throwaway test database (print p95 warm/cold; do not claim targets that were not measured).
```

## P13 — Demo seed (data, gated)
| Field | |
|---|---|
| Goal | A safe, repeatable way to create the demo Super Admin and labelled sample Zonal Admins |
| Prereqs | P6 (change-password), P5; H.3 (email chosen) |
| Inspect/change | `prisma/seed.ts`, `seed-run.ts`, `seed-data.ts`; new `scripts/demo-seed.ts` and an npm script `demo:seed` |
| DB | **Yes**: inserts into `zoauro` (users, assignments) after approval |
| Expected | Password is typed in the terminal with hidden input; never in env files, args, logs or chat; target printed and confirmed; idempotent |
| Verify | log in via API/UI later (P15); `select email, role, status from users` shows 3 rows; names contain "Sample" |
| Rollback | users can be set INACTIVE; no delete is performed by the script |
| STOP if | the script would run against any database other than the one you confirm |
```
[paste COMMON RULES]
TASK P13 — demo accounts. Target for the write: the database named in DATABASE_URL_MIGRATE after I confirm it (expected zoauro_owner@zoauro, localhost:5441).
Build scripts/demo-seed.ts and an npm script `demo:seed` in apps/api that:
1) prints the target (role, database, host) and refuses unless host is localhost; asks me to type the database name to confirm;
2) reads the Super Admin email from an argument and the password from a HIDDEN terminal prompt (twice); never from env files, arguments, logs or output; validates against the password policy; hashes with the existing Argon2id service; creates or updates the Super Admin (mustChangePassword=false for the demo account only if I confirm; default true);
3) creates two Zonal Admin members clearly labelled "Sample Zonal Admin A" and "Sample Zonal Admin B" (emails on the .local domain, passwords from the same hidden prompt or generated and shown once in the terminal only if I choose), two sample zones are NOT created here (zones are created through the app in the demo), but the assignments are created later by a second function `demo:assign` that runs after zones exist: assignment of Sample A to zone codes I pass, profile "Zone Manager", Sample B "Read Only";
4) is idempotent, deletes nothing, writes audit rows through the normal audit service with actor SYSTEM and a note "demo seed".
Do not execute it. Show me the plan and the dry-run output format first; WAIT for "approved" before any run, and I will run it myself in my terminal.
Tests: unit tests with the prompt functions injected (no real terminal), refusal on non-localhost, refusal when the typed database name does not match.
```

## P14 — Frontend foundation and shell
| Field | |
|---|---|
| Goal | A real app shell: sidebar, header, protected layouts, error/loading/404, Coming Soon |
| Prereqs | P6 (`/me`) |
| Inspect/change | `apps/web/src/app/{layout.tsx,providers.tsx,page.tsx,(auth),(super-admin),(zonal)}`, `lib/{api-client,server-session,url-state}`, `components/ui`, `components/shared` |
| DB | No |
| Expected | Unauthenticated visit to any protected route → `/login`; Super Admin sees sidebar: **Dashboard (status page), Zones, Audit & Logs → System Logs, Account security**, and every other module as a disabled "Coming Soon" item that opens a clear Coming Soon page; Zonal Admin sees a reduced menu; 404/403/500 pages |
| Verify | component tests; Playwright smoke for redirects; `pnpm --filter @zoauro/web test` |
| STOP if | `/me` does not provide what the menu needs (go back to P6) |
```
[paste COMMON RULES]
TASK P14 — application shell. Spec: docs/D-ui/18_*, 19_*, 20_*, docs/F-execution/37_*, 39_* (module list), docs/C-security/14_* (route guarding). Reuse components/ui, components/shared and the existing providers; check Tailwind/shadcn and any docs/design assets first. 
Build: (1) minimal design tokens (colours, spacing, radius) as CSS variables consistent with the existing neutral palette, light mode only; (2) server-side protected layouts for (super-admin) and (zonal) using lib/server-session: unauthenticated -> redirect to /login?next=; wrong role -> 403 page; never rely on hiding links; (3) sidebar from one typed config of the 20 modules in doc 39: Authentication-related (Account security), Audit & Logs (System Logs) and Zones are live; everything else is a disabled item with a "Coming Soon" badge linking to /coming-soon/<slug> which renders one clear explanation page (name, what it will do from doc 39, "not available in this release"); no fake data, no empty widgets; (4) header with user menu (name, role, Account security, Sign out) and a zone chip for Zonal Admins listing their assigned zones from /me; (5) app/error.tsx, loading.tsx, not-found.tsx and a 403 component; (6) the Dashboard page is an honest status page (signed-in user, role, list of live vs coming-soon modules), not a metrics board; (7) accessibility: skip link, landmarks, keyboard navigable sidebar, responsive collapse below 1024 px.
Tests: component tests for the menu filtering by role, protected-layout redirect tests, and a Playwright smoke: / and /super-admin/zones redirect to /login when signed out.
```

## P15 — Auth frontend (Checkpoint A, and C if P8–P10 are merged)
| Field | |
|---|---|
| Goal | Working login → shell with real sessions; reset/change password; 2-step screens; account security |
| Prereqs | P13 run by you, P14; for 2-step screens P8–P10 |
| Inspect/change | `apps/web/src/app/(auth)/*`, `features/auth/*` (new), `account/security`, add `qrcode` to `@zoauro/web` only with my approval of the exact version |
| DB | No |
| Expected | Wrong tab and wrong password show the same message; correct login lands on the role's dashboard; 5 failures lock with the unlock time; forgot-password email appears in Mailpit (http://localhost:8025); with 2-step: `/2fa`, `/2fa/setup` wizard, account security page |
| Verify | component tests (OtpInput paste/backspace/auto-submit), Playwright TC-AUTH-45/46, axe TC-AUTH-47 |
| STOP if | the API contract differs from the docs; fix the contract first |
```
[paste COMMON RULES]
TASK P15 — authentication screens. Spec: docs/F-execution/52_* section 9; docs/D-ui/20_* (Login). Use React Hook Form + Zod from @zoauro/shared, TanStack Query, the generated api-client, cookies only (no tokens in localStorage), X-CSRF-Token on mutating calls.
Part 1 (always): /login (role tabs Super Admin / Zonal Admin, show/hide password, remember me, forgot link, generic errors, locked state with unlock time), /forgot-password, /reset-password, forced change-password screen. 
Part 2 (only if the API from P8-P10 is merged; check /openapi.json or the api-client for /auth/mfa/*; if absent, SKIP and say so): /2fa (method switcher, 6-cell OtpInput with paste, auto-submit and autocomplete="one-time-code", resend countdown from the server value, backup-code entry, generic error), /2fa/setup (3 steps: confirm email, add authenticator with QR + manual key, save backup codes with copy/download and acknowledge checkbox), /account/security (methods with add/remove/primary, STRONG re-auth dialog asking password and code, backup codes card, active sessions with revoke, recent sign-ins). Settings > Security policy UI is NOT in this step.
Ask me before adding the `qrcode` package: give the exact version and why.
Tests: component tests, Playwright for login/logout/lock and (if Part 2) email-OTP and authenticator enrolment using a test-only TOTP generator, axe on each page. Never print secrets or codes into reports.
```

## P16 — Zones frontend (Checkpoint B)
| Field | |
|---|---|
| Goal | Zone Management screens on the real API |
| Prereqs | P11, P14, P15 |
| Inspect/change | `apps/web/src/app/(super-admin)/super-admin/zones/*`, `features/zones/*` |
| Expected | KPI cards, table, filters, search, Add/Edit overlay with live overlap hint, detail page (Overview, Pincodes, Team read-only, Activity), Activate/Deactivate dialogs with impact (`partial` message), re-auth |
| Verify | component tests, Playwright TC-ZONE-28, axe TC-ZONE-29 |
```
[paste COMMON RULES]
TASK P16 — Zone Management UI. Spec: docs/F-execution/53_* section 6; docs/D-ui/20_* (Zone Management), 22_* (zone form); components in components/shared (DataTable, FilterBar). 
Build the list (KPI cards Total/Active/Inactive/Upcoming, "zones without a team" chip, columns per Figma/doc 20, filters status/state, search, row menu), the Add/Edit overlay (code disabled after creation, pincode editor: range + paste/CSV + chips + live overlap hint from /zones/lookup, MoneyInput in rupees stored as paise, status, 12-swatch colour, description), the detail page with tabs Overview / Pincodes / Team (read-only) / Activity, and the Activate and Deactivate dialogs (impact table, "some modules are not built yet" when partial=true, reason >= 10 chars, acknowledgement, re-auth). Server errors map to fields; PINCODE_OVERLAP lists the conflicts. Loading, empty, error and 403 states. Zonal Admin: no route and no menu entry.
The Activity tab may use the existing ActivityTab if it is complete; wiring is finished in P17.
Tests: component tests for the pincode editor, Playwright flow (add with overlap error, fix, save, activate, deactivate), axe.
```

## P17 — Audit & Logs integration
| Field | |
|---|---|
| Goal | Audit reachable and meaningful from the shell: zone names resolved, ActivityTab on zone detail, sign-in logs visible |
| Prereqs | P14–P16 |
| Inspect/change | System Logs page, `features/audit/*`, nav config, login history API usage |
| Expected | System Logs shows real rows for actions made in P15/P16 with module, action, actor, outcome and **zone**; zone filter lists real zones; a "Sign-in logs" view/tab from `/audit-logs/login-history`; the two disabled related-log links work; no synthetic rows unless a banner says so |
```
[paste COMMON RULES]
TASK P17 — Audit & Logs integration. Spec: docs/F-execution/50_* sections 8 and 9. 
1) Confirm the System Logs page works behind the new shell and menu; fix only integration problems (redirects, layout).
2) Mount ActivityTab on the zone detail Activity tab; make the two disabled related-log links functional where the target now exists.
3) Add a "Sign-in logs" tab/view on System Logs using GET /audit-logs/login-history (columns time, email masked, result, reason, method, IP; filters result and date; pagination); loading/empty/error states.
4) Make sure the zone filter and the zone column show real zone names/colours from the zones created in P16.
5) If the database being used contains synthetic rows (the 20,000 rows of zoauro_demo), show a visible "Sample data" banner; detect via a documented marker only if one exists, otherwise do not guess.
Tests: component tests; extend the existing Playwright system-logs spec (do not create a second runner).
```

## P18 — End-to-end and authorization
| Field | |
|---|---|
| Goal | One Playwright suite proves the demo's acceptance criteria 2–8 and the authorization claims |
| Prereqs | P13 run, P15–P17 |
| DB | Test runner creates its own throwaway database (as `e2e:system-logs` already does); never `zoauro` |
```
[paste COMMON RULES]
TASK P18 — end-to-end and authorization suites. Reuse the existing e2e harness that creates its own throwaway database and ports 3720/4720 (see e2e:system-logs); add a new script e2e:core, not a second framework.
Flows: (1) signed-out access to / and protected pages -> /login; protected API -> 401; (2) Super Admin login, logout, session revoked after logout (API returns 401); (3) wrong password x5 locks and is audited; (4) create zone -> overlap rejected -> fix -> activate -> change charge -> deactivate -> reactivate; each step produces the expected audit row visible in System Logs with the zone; (5) sign-in logs show the attempts of (2)-(3); (6) Zonal Admin A: reduced menu, GET /zones 403, /super-admin/zones 403 page, audit free listing 403, own account security works; (7) Coming Soon items open the explanation page, no broken links (crawl the sidebar); (8) with P8-P10 merged: 2-step login by authenticator and email OTP, wrong code lock, backup code single use.
Also add API-level authorization tests for the new zone and auth routes into the existing authorization matrix harness (Super Admin, Admin(A), Admin(A+B), Admin(none)); the "leaky repository" detector must still fail on a deliberately unscoped repo.
Report counts and timings. Do not mark anything passed that did not run.
```

## P19 — Security and regression
```
[paste COMMON RULES]
TASK P19 — security and regression pass, mostly read-only.
Run: pnpm lint, pnpm typecheck, pnpm test (all packages), pnpm openapi:check, pnpm --filter @zoauro/web test, pnpm e2e:core, pnpm e2e:system-logs. Report counts and every failure; separate pre-existing from new.
Review (no edits unless a defect is found; then stop and list it): cookie flags (zo_sid, zo_mfa, zo_csrf); CSRF on every mutating route; no secret or code in logs (grep logger calls in modules/auth and modules/zones); every mutating route has audit metadata (coverage guard green); no raw Prisma outside repositories; dangerous patterns (any, !, dangerouslySetInnerHTML) in new code; env.example files contain placeholders only; run gitleaks or an equivalent scan only if already installed (do not install); pnpm audit --prod summary.
Output a table: item | evidence | OK / GAP / NOT VERIFIED.
```

## P20 — Startup, documentation and the showcase database
| Field | |
|---|---|
| Goal | One documented way to start the demo; a clean `zoauro_showcase` database built from migrations and filled only by real actions |
| DB | **Yes**: create database `zoauro_showcase` (gated) |
```
[paste COMMON RULES]
TASK P20 — startup and showcase. Do the documentation first; the database part is gated.
1) Write docs/demo/README.md (new): prerequisites, `pnpm infra:up`, env files, starting API and web, Mailpit URL, ports, how to run each test script, the two databases and what each is for, and the exact demo script (login -> zones -> audit -> 2-step) with expected results. Only commands that exist in package.json.
2) Add scripts `demo:start` (checks infra is running, checks the target database name and role, then starts API+web with the showcase environment) without any destructive action.
3) GATED: propose the exact commands to create database zoauro_showcase owned by zoauro_owner, apply default privileges as in infra/initdb/01-roles.sql, apply migrations with deploy semantics, and run demo:seed. Print target and operations, WAIT for "approved", and let me run the seed myself (hidden password prompt).
4) apps/api/.env.showcase (placeholders in .env.showcase.example, the real one gitignored) pointing the three URLs at zoauro_showcase and a separate Redis database number; make sure no script defaults to it.
Do not touch zoauro_demo or zoauro.
```

## P21 — Independent verification (new session, read-only)
```
Role: independent reviewer. Change no files. Do not start services or write to any database.
Read docs/F-execution/50_*, 52_*, 53_*, docs/H-delivery/56_* (the acceptance matrix in section 6), the code and the test files. For acceptance criteria 1-10 give: where it is implemented (file:line), which test proves it, and whether that test passed in the last recorded run (from files/logs, not from running). For doc 52 threats T30-T39 and doc 53 T40-T43 give the mitigation line and the test. List everything NOT VERIFIED and what would verify it. Do not soften findings.
```

---
## 5. Environment and credentials rules used throughout
- Only localhost databases. `zoauro` = development, `zoauro_showcase` = rehearsal, `zoauro_demo` = labelled synthetic volume data, `zoauro_audit_test_*` = test runners.
- The demo Super Admin password is typed into a hidden terminal prompt (P13) and never stored. Reset and OTP emails go to Mailpit.
- Audit rows are append-only and cannot be removed, so anything written to `zoauro` stays. That is why rehearsal uses a fresh database.

## 6. Acceptance matrix (what proves each of your 10 criteria)
| # | Criterion | Proof |
|---|---|---|
| 1 | Starts with documented commands | P20 README; `demo:start` runs from a clean shell; `/api/ready` reports DB and Redis |
| 2 | Super Admin logs in and out | P18 flow 2; sessions row revoked; API 401 afterwards |
| 3 | Signed-out users cannot reach pages/APIs | P14 redirect tests; P18 flow 1; authz matrix |
| 4 | Role and zone authorization | Authz matrix incl. new routes; P18 flow 6; Zonal Admin gets 403 on zones and free audit listing |
| 5 | Zones page real data and actions | P16 + P18 flow 4 against the database, no mock |
| 6 | Actions produce audit rows | P18 flow 4: each step's row visible in System Logs |
| 7 | Audit & Logs real records, pagination, filters | P17; existing e2e 11/11 plus new cases; volume shown via `zoauro_demo`, labelled |
| 8 | Login history | P17 Sign-in logs view; P18 flow 5 |
| 9 | Other modules Coming Soon without broken links | P14 crawl test in P18 flow 7 |
| 10 | Tests pass, no regression | P19 report; three consecutive green full runs (P2) |

## 7. Final rehearsal (after P21, about 30 minutes)
1. `pnpm infra:up`; `pnpm demo:start`; open the app and Mailpit.
2. Signed out: open a Zones URL → login. Wrong tab / wrong password → same message. Five wrong → locked message.
3. Log in as Super Admin → status dashboard, sidebar with Coming Soon items (click two).
4. Zones: add "Sample Zone Alpha" with pincodes; add one overlapping → error naming Alpha; fix; activate; change charge; deactivate (impact dialog says some modules not built); reactivate.
5. Audit & Logs: filter module=zones; open the delivery-charge row (before/after); filter by the zone; Sign-in logs tab shows the earlier attempts.
6. Show volume: switch to the `zoauro_demo` stack (banner "Sample data") and filter 20,000 rows.
7. Sign in as Sample Zonal Admin A: reduced menu; open a Zones URL → 403 page.
8. If 2-step is built: enrol authenticator with a phone, log out/in with the code, one wrong code, one backup code, show the audit rows.
9. Run `pnpm e2e:core` headed or show the last report.

## 8. Unresolved decisions and risks
| Item | Where it bites |
|---|---|
| Neon credential rotated? | Before P0 |
| D68 SMS provider and DLT | SMS stays off; the screens show it disabled with the reason |
| D66/D73/D75 2-step policy defaults (Super Admin authenticator-only; both roles required; ≥2 Super Admins) | P8–P10, P15 |
| D81–D90 zone defaults, D88 order prefix | P5, P11 |
| Zonal Admin demo is thin until M03 and the first vendor modules exist | P18 flow 6 |
| Zone impact shows partial counts | honest label; changes when Restaurants/Orders land |
| CI workflow has never run | P19 does not cover it; run it once on a branch |
| Node 24 local vs 22 in `.nvmrc` | doc 32 row pending |
| Module keys / refund permission keys / default refund limit are owner decisions (handoff F1.3) | not needed for these three modules, needed before M03 |
| `home/` committed junk, 3 leftover test databases (one is 1 GB) | cleanup needs your approval, not part of this plan |
| Effort is large: P4–P10 + P15 (auth) ≈ 4+ weeks of team effort per doc 52; with Claude Code expect days to weeks, not hours | decide on checkpoint B vs C early |
