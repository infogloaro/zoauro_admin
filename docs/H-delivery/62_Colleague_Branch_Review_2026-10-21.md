# 62 — Colleague branch review (2026-10-21)

Owner request (2026-10-21): analyse the colleagues' pushed work, decide what is useful and adaptable, merge or port it, give them instructions, archive the old branches and keep the repo clean. Decisions D117 (port, never merge) and the owner's branch answers of 2026-10-21 apply.

## Repository state after the clean-up

| Ref | Points at | Purpose |
|---|---|---|
| `main` | `4f1e1ec` | Latest verified code (prettier, eslint and tsc of all four packages passed on a clean snapshot) |
| `feature/admin-panel-v1` | `4f1e1ec` + newer commits | Ongoing working branch; the shared working folder tracks it |
| `colleagues/archive` | `3207060` | One branch holding both colleague histories (a commit with both tips as parents, empty tree) |
| tag `archive/dev_cb-2026-10-21` | `a9cb35d` | magaraj's `dev_cb` at the time of the review |
| tag `archive/m06-m07-2026-10-21` | `85c1211` | Chittra Priya's `feature/m06-m07-restaurants-homemakers` at the time of the review |
| deleted | — | `feature/settings-access-requests-dashboard` (fully contained in `main`), `dev_cb`, `feature/m06-m07-restaurants-homemakers` (archived above) |

## magaraj — `dev_cb` (tip a9cb35d)

**What he built:** an orders API (list, detail with items, payments, timeline and server-computed allowed actions; transitions with If-Match; cancel with reason codes) in one transaction with audit and outbox; orders web screens for both roles; a global search API and UI; earlier his own auth and a sample-orders seed script. Patterns largely follow ours (AuthContext, `zonesFor`, `auditTx`, outbox, shared Zod, api-client, url-state).

**Fit:** almost everything already exists in our core (ported from his earlier branch on 2026-10-17, then extended with assign and the D121 cap, pre-orders, overview, refunds, guards and concurrency tests). Not mergeable: 33 conflicting files and duplicate modules. **Security issue:** a global `express.json({ limit: '1mb' })` in `app.ts` would break the HMAC-signed intake and payment webhook signatures and raise every body limit. No secrets found.

**Ported (credited):** server-computed per-order `actions` on the order detail (read-only zones show no action buttons) and the one-line delivery address; removal of the tracked `home/claude/*` junk. **Owner question:** cancel reasons as a Control Panel setting instead of free text or a hard-coded list.

| Feature | His status | Our status | Verdict |
|---|---|---|---|
| Orders list/detail API | basic | done with filters, sort, pre-orders, overview | drop |
| Transitions / cancel | no guards | done with doc 10 guards, D121 | drop |
| Assign / reassign | missing | done (D121) | — |
| Per-order allowed actions | done | missing | **port** |
| Delivery address on detail | done | pre-orders only | **port** |
| Cancel reason picklist | hard-coded | free text | owner: make it a setting |
| Orders web screens | basic | done incl. overview, assign, pre-orders | drop |
| Global search | no rate limit | done (D143) | drop |
| Own auth (argon2) | done | core done | drop |
| Sample-orders seed (raw SQL) | done | demo seed exists | drop |
| Global JSON parser in `app.ts` | added | per-route 100 kb + raw intake | **reject** (breaks HMAC) |

### Instructions for magaraj
1. Thank you for the orders and search work; most of it is already in our core (ported 2026-10-17), so please stop work on `dev_cb` (now archived).
2. Start a fresh branch from `origin/main` for each module, keep it short-lived and rebase on `main` instead of merging `main` in.
3. Read `AGENTS.md`, doc 38 (lanes) and doc 40. Do not recreate auth, orders, search, the schema or migrations; extend `apps/api/src/modules/*`; new repositories extend `BaseRepository`.
4. Follow our file naming (`x.routes.ts`, `x.service.ts`, `x.repository.ts`). Do not change the eslint guards, the body parsing in `app.ts` or `pnpm-workspace.yaml`.
5. No new dependencies (we use `@node-rs/argon2`). No raw-SQL seed scripts; demo data goes through the `zoauro_demo` seed.
6. Commit under your own git identity, about 5 files per commit, and run `pnpm lint && pnpm typecheck && pnpm test` before pushing.
7. Next module to own (post-demo, unbuilt): **Offers review and management** (doc 60 §10.6, D182 F1–F5) or **Advertising & Commission** (doc 60 §10.1). Contract and doc 09 rows first, then code.

## Chittra Priya — `feature/m06-m07-restaurants-homemakers` (tip 85c1211)

**What she built:** on the old scaffold, a parallel core (auth, zones, shell) plus restaurants and Home Food, uploads, menu items with approvals, hotels and bookings, customers (with a 6-KPI row), her own delivery partners (with seeded performance columns), third-party delivery providers, notifications over SSE, and a demo payments page. The last commit, "fix: resolve payments status filter typing", is in fact 121 files (+14,267). Every module is Super Admin only; Zonal Admins get 403 everywhere.

**Fit:** not mergeable (72 conflicting files; 7 migrations would recreate tables we already have; a parallel auth/zones/shell; no zone scoping, against doc 36). Our core already covers every module she built, with zone scope.

**Security and quality:** the branch tip has no secrets, but the Neon `neondb_owner` password is still readable in the pushed commit 3031d16, so it **must be rotated** (rotated by the owner on 2026-10-22). Junk files at the tip (a 204 KB `package-lock.json`, test and lint output that leaks a local Windows path, `check-db.js` that dumps rows); hard-coded demo payments; e2e clean-up that deletes audit rows; SSE instead of Socket.IO; invented tables and fields.

**Ported:** the 11 reference design images (`docs/reference_images/`). **Ideas for after the demo (owner to define):** a customer KPI row (registered, new, returning, lifetime spend, AOV, satisfaction) and partner performance figures (on-time %, average delivery minutes, failed deliveries) computed from orders. **Owner question:** third-party delivery providers (doc 11 says not in v1).

| Feature | Her status | Our status | Verdict |
|---|---|---|---|
| Auth / session / shell / zones | parallel copy | done | drop |
| Restaurants + Home Food, uploads | Super Admin only | done, zone-scoped | already done |
| Menu items + approvals | 6 tabs | done (items, categories, requests) | already done (compare tabs) |
| Hotels + room/table bookings | built | done | already done |
| Customers | API + screen + KPI row | done (list, detail, rewards, zonal) | done; KPI row = owner idea |
| Delivery partners | seeded metrics | done (detail, force-offline, cash) | done; derived metrics later |
| Third-party providers | table + API + screen | not in v1 (doc 11) | owner decides |
| Notifications | SSE + bell | done (Socket.IO, composer) | already done |
| Payments | hard-coded demo, unscoped | done (payments + refunds) | drop |
| Reference designs (11 images) | in repo | missing | **port** |
| E2E specs | one deletes audit rows | own suite | drop |

### Instructions for Chittra Priya
1. Thank you for the M09/M10 work and the reference designs; they helped check our screens.
2. Please **rotate the Neon database password today**; it is still readable in the pushed commit 3031d16. Never put real connection strings in `.env.example`.
3. Stop committing to `feature/m06-m07-restaurants-homemakers` (now archived). Our branch already has these modules (D117: we port, never merge).
4. Fetch our latest `main` and create `feature/<module>` from it. Delete your local copy of the old core (auth, zones, schema, migrations, shell).
5. Read `AGENTS.md`, doc 36 (zone scope), doc 38 (lanes) and decisions D117–D189. Copy an existing module's patterns (`apps/api/src/modules/refunds`, `apps/web/features/refunds`): AuthContext, `can()` / `zonesFor()`, `BaseRepository`, audit, Zod in `@zoauro/shared`, `api-client`.
6. No new tables or fields until they are in docs 08/09; migrations only as new files; never delete audit rows; Socket.IO for anything real-time.
7. Keep junk out of git (other lockfiles, test and lint output, debug scripts); one concern per commit with an honest message, about 5 files per task.
8. Scope tests for Super Admin, Admin(A), Admin(A+B) and Admin(none); run `pnpm lint && pnpm typecheck && pnpm test` before every push.
9. Next module: **hotel profile edit / onboarding requests** (D179, defaults H1–H4), then **Offers** (doc 60 §10.6).
