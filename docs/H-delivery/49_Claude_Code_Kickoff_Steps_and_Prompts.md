# 49 — Claude Code Kickoff: setup steps and copy-paste prompts

For the first two weeks (sprints S0–S1, tasks F0.3–F2.7 of doc 33). Later tasks use the template and lanes of doc 38. Every prompt below is meant to be pasted into Claude Code at the repository root. Run `pnpm lint && pnpm typecheck && pnpm test` after each prompt and commit only when green.

## Part A — One-time setup (about half a day, one person)
1. **Decide first (30 min).** Answer D18 (do the apps exist), D17 (separate repo/DB from CRM), D6 (gateway date). Put the answers in `docs/A-product/03_*` before coding, because the schema and the integration layer depend on D18.
2. **Create the repo.** Private GitHub repo `zoauro-admin`, protected `main`, require PR + CI. Clone it locally and open it in VS Code.
3. **Install tools.** Node 22 LTS, pnpm 9, Docker Desktop, Git, GitHub CLI, Claude Code.
4. **Put the pack in the repo.**
   ```bash
   unzip Zoauro-DevReady-Pack-v2.1.zip
   mkdir -p docs && cp -R Zoauro-DevReady-Pack/* docs/ && rm docs/AGENTS.md
   cp Zoauro-DevReady-Pack/AGENTS.md ./AGENTS.md
   printf '@AGENTS.md\n' > CLAUDE.md          # Claude Code reads CLAUDE.md and imports AGENTS.md
   touch docs/handoff.md
   git add -A && git commit -m "docs: add dev-ready pack v2.1"
   ```
5. **Give Claude Code the design inputs.** Put the Figma screenshots in `docs/design/screenshots/` and the designer PDF in `docs/design/`. (Claude Code cannot open your private Figma link without the Figma connector; screenshots are enough for tokens.)
6. **Permissions.** Start Claude Code in the repo; allow `pnpm`, `docker compose`, `git`, `prisma`; do **not** allow it to run against any real database or cloud account. Use plan mode (Shift+Tab) for the first prompt of each task.
7. **Split the team (doc 40).** Dev 1 takes Prompts 3, 5, 6; Dev 2 takes Prompts 4, 8; Dev 3 takes Prompts 2, 7, 9. Prompt 1 is done once by one person; everyone pulls after it merges.

## Part B — The prompts (in this order)

### Prompt 0 — Orientation (everyone, read-only, first session)
```
Read AGENTS.md, docs/README.md, docs/A-product/03_Business_Rules_and_Decision_Register.md (sections 1.3 and 1.4 only), docs/F-execution/40_Three_Developer_Allocation_and_Module_Plan.md and docs/F-execution/33_Shared_Foundation_Plan.md.
Do not write code. Reply with: (1) the stack and the monorepo layout you will create, (2) the 10 rules from AGENTS.md you consider most likely to be broken by accident, (3) every decision still marked Open or Assumed that blocks tasks F0.3 to F2.7, (4) anything in the docs that contradicts something else. Keep it under 40 lines.
```

### Prompt 1 — F0.3 Monorepo scaffold (one person)
```
Task F0.3 from docs/F-execution/33_Shared_Foundation_Plan.md. Lane D.
Load only: AGENTS.md, docs/B-architecture/06_*, 07_*, 12_*.
Create the pnpm monorepo: apps/web (Next.js App Router, TypeScript strict, Tailwind), apps/api (Express, TypeScript strict, ts-node-dev for dev, separate src/worker.ts entry), packages/shared (Zod, enums, permission keys, money helpers). Root: ESLint with import-boundary rules (apps/web must not import from apps/api or Prisma; only repositories may import Prisma), Prettier, Husky pre-commit (lint-staged), commitlint (conventional commits), tsconfig base, .editorconfig, .gitignore, .nvmrc.
Add scripts: dev, build, lint, typecheck, test (Vitest), db:migrate, db:seed.
Add /api/health and /api/ready placeholders and one smoke test per app.
Do not add features, auth, or database tables yet.
Done when: pnpm install && pnpm lint && pnpm typecheck && pnpm test pass; pnpm dev starts web on 3000 and api on 4000.
At the end append a handoff block to docs/handoff.md (format in docs/F-execution/38_*).
```

### Prompt 2 — F0.4 Local environment (Dev 3)
```
Task F0.4. Lane D. Load: AGENTS.md, docs/B-architecture/12_*.
Add docker-compose.dev.yml with PostgreSQL 16, Redis 7, MinIO (S3) with a bucket-creation init, Mailpit. Add apps/api/src/lib/env.ts that validates every variable listed in doc 12 with Zod at boot and fails fast with a readable message; add .env.example files (no secrets). Add a make-style script `pnpm infra:up` / `infra:down`.
Done when: pnpm infra:up starts all four services, the API refuses to start with a missing variable, and /api/ready reports DB and Redis reachable.
```

### Prompt 3 — F1.1 Full Prisma schema (Dev 1, schema gatekeeper)
```
Task F1.1. Lane D. Load: AGENTS.md, docs/B-architecture/08_Database_Schema_and_Data_Dictionary.md (ALL of it), docs/B-architecture/10_* (enums only), docs/A-product/04_* (module keys).
Write prisma/schema.prisma for EVERY table and enum in doc 08, including the v1.2 access tables (access_profiles, profile_permissions, admin_zone_assignments with limits, assignment_overrides, access_changes) and the v2.0 integration tables and column additions (api_clients, api_client_secrets, external_refs, integration_inbound_log, webhook_subscriptions, webhook_deliveries, integration_alerts, unassigned-zone columns and CHECK constraint). Use UUID v7 ids, created_at/updated_at/deleted_at, money as integer paise, enums as in doc 08.
Create the first migration and add indexes named in doc 08 plus (client_id, received_at) and (entity_id) on integration_inbound_log, and (zone_id, status, created_at) on orders.
Do not create seed data or application code. If doc 08 is ambiguous, list the ambiguity in the handoff block instead of guessing.
Done when: prisma validate and prisma migrate dev succeed on an empty database; a script lists every table in doc 08 and confirms it exists.
```

### Prompt 4 — F0.6 + F2.1 Design tokens and theme (Dev 2)
```
Tasks F0.6 and F2.1. Lane D (components/ui). Load: AGENTS.md, docs/D-ui/19_*, docs/F-execution/37_* section 3, and the screenshots in docs/design/screenshots/.
Extract colours, typography, radii, shadows, spacing and status-badge colours from the screenshots into a Tailwind theme and shadcn CSS variables. Use the dark navy/blue gradient sidebar for Super Admin and the orange active item for Zonal Admin. Add Indian number/date/currency formatters (lakh/crore grouping, paise to rupees) in packages/shared with tests. Build a /design-system page in apps/web (dev only) showing tokens, buttons, inputs, badges for every status in docs/B-architecture/10_*.
Done when: the page renders in light mode, formatters tests pass, no hard-coded hex values outside the theme file.
```

### Prompt 5 — F1.2 Session authentication (Dev 1)
```
Task F1.2. Lane A (module auth). Load: AGENTS.md, docs/C-security/14_* sections 1-3, docs/C-security/13_* (T1-T10), docs/B-architecture/09_* (auth endpoints), docs/B-architecture/08_* (users, sessions, login_history).
Implement: POST /auth/login, /auth/logout, /auth/forgot-password, /auth/reset-password, /auth/reauth, GET /me (stub permissions for now), Argon2id hashing, Redis-backed opaque sessions in an HTTP-only Secure SameSite=Lax cookie, idle 30 min / absolute 12 h, lockout after 5 failures for 30 min, generic error messages, first-login forced password change, CSRF token for state-changing requests, login rate limiting, login_history rows, audit rows. The login request carries the selected tab (SUPER_ADMIN or ZONAL_ADMIN); the server must reject a credential used on the wrong tab with the same generic error.
Write the tests in doc 24 (TC-AUTH-1..5) plus a test that the session cookie flags are correct.
Do not build 2FA yet (SA-7.2).
```

### Prompt 6 — F1.3 AuthContext, access resolver, scope-aware repositories (Dev 1; review by Dev 3)
```
Task F1.3. Lane A + D. Load: AGENTS.md, docs/C-security/14_* section 4, docs/A-product/04_* (all), docs/F-execution/36_* sections 1 and 5, docs/B-architecture/08_* (access tables).
Implement AuthContext { userId, role, permissionsByZone, limitsByZone, requestedZoneIds } built on every request (never stored in the session), can(ctx, 'module:action', zoneId) and zonesFor(ctx, 'module:view'), the resolver (profile permissions + GRANT/DENY overrides, deny wins, non-grantable modules blocked for Zonal Admin), Redis cache <= 60 s with explicit invalidation, a requirePermission(module, action) route guard, and a BaseRepository whose every query applies zone_id IN zonesFor(...). Read in unassigned zone / unviewable module -> 404, write without action -> 403.
FIRST write the "leaky repository" test: a deliberately unscoped repository that the authorization harness must detect and fail.
Done when: unit tests for TC-AC-5 and TC-AC-6 pass and the leaky-repository test fails as intended when scoping is removed.
```

### Prompt 7 — F1.4 to F1.7 Platform plumbing and the authorization harness (Dev 3, then Dev 1 reviews)
```
Tasks F1.4, F1.5, F1.6, F1.7 in that order, one commit each. Lane A + D. Load: AGENTS.md, docs/B-architecture/09_*, docs/E-quality-ops/24_* section 2, docs/F-execution/36_* section 6.
F1.4: transaction-joined audit service (append-only), AppError and error middleware using the error codes of doc 09, pagination/filter helpers, idempotency middleware (Idempotency-Key, 24 h, request hash).
F1.5: generate OpenAPI 3.1 from the shared Zod schemas, publish /api/v1/openapi.json, generate a typed client package, fail CI if the committed spec differs.
F1.6: authorization matrix harness. Fixtures: zones A, B, C; actors SuperAdmin, Admin(A full), Admin(A+B: full in A, read-only in B), Admin(A, payments denied), Admin(none). It reads the OpenAPI file and auto-generates 401/403/404/200 expectations per route.
F1.7: seed script: default access profiles (Zone Manager, Operations, Support, Finance View, Read Only), the permission matrix of doc 04, the first Super Admin from INITIAL_SUPERADMIN_*.
Done when: the harness runs in CI and reports every route it covers.
```

### Prompt 8 — F2.2 to F2.7 UI foundation (Dev 2)
```
Tasks F2.2 to F2.7 in order, one commit each. Lane D (components) then B. Load: AGENTS.md, docs/D-ui/18_*, 19_*, 22_*, 23_*, screenshots.
Build AdminShell (collapsible sidebar driven by a role-and-permission menu config, top bar with search box placeholder, notification bell, profile menu, breadcrumbs), DataTable (server pagination, sort, URL-state filters, row selection), FilterBar, forms kit (React Hook Form + Zod resolver, MoneyInput, PhoneInput), Sheet/Dialog/ConfirmDialog/Toast, StatCard, chart wrappers (Recharts), Empty/Error/Skeleton states, the login screen with the Super Admin / Zonal Admin tabs (no Google login, fix the "Gocart" footer copy to ZOAURO), forgot/reset screens, role routing, 404 for the wrong route group, and the TanStack Query + generated client wiring with 401/403/404/409/422 handling.
Use mocks from the OpenAPI file until the API endpoints exist. No feature screens yet.
Done when: login works against the real API for both tabs and lands on empty dashboards in the right shell.
```

### Prompt 9 — Start the integration layer (Dev 3, sprint S2)
```
Task IH-1 from docs/F-execution/34_* (phase SA-10). Lane A (module integration). Load: AGENTS.md, docs/G-integration/42_*, 44_*, docs/G-integration/contracts/intake.openapi.yaml, docs/B-architecture/08_* (integration tables), docs/C-security/14_* section 8, docs/C-security/13_* (T23-T26).
Implement the Integration API framework under /api/v1/intake: raw-body capture (do not re-serialise JSON), HMAC verification (key id, timestamp window 300 s, constant-time compare, secrets decrypted with ENCRYPTION_KEY, two active secrets during rotation), scopes, IP allow-list, per-client rate limits, Idempotency-Key storage for 7 days with replay header, the inbound log, error codes of doc 42 section 4, GET /ping and GET /config, and a CLI `pnpm client:create --type CUSTOMER_APP --env SANDBOX` that prints the secret once.
Write TC-INT-1 to TC-INT-7 and TC-INT-20, TC-INT-21 as automated tests. Do not implement orders yet (IH-3).
```

## Part C — Daily working loop (each developer)
1. Pull `main`. Open the task row in doc 33/34/35. Read `docs/handoff.md`.
2. Start Claude Code, enter plan mode, paste the **task prompt template** of doc 38 §3 filled in (task id, lane, files, done-when). Review the plan before approving.
3. Let it implement. Ask it to write the tests first when the task touches access, scope, money or integration.
4. Run `pnpm lint && pnpm typecheck && pnpm test` yourself. Read the diff. For security-critical paths (auth, access, scope, payments, webhooks, integration) a second human reviews line by line (doc 40 agreement 5).
5. PR ≤ 400 lines, linked to the task id. Append the handoff block. Never let Claude Code edit `prisma/schema.prisma` unless you are Dev 1 (or Dev 1 approved).
6. If Claude Code proposes anything not in the docs (new table, endpoint, permission key), stop: change the document first, then the code.

## Part D — Guardrails to paste at the start of any long session
```
Constraints: follow AGENTS.md. Do not change the stack. Do not invent endpoints, fields, permission keys or enum values: if the docs do not define them, stop and ask. Every write: transaction + audit row. Every query on zone-owned data goes through a scope-aware repository. Never log request bodies containing phone, email or addresses. Never put secrets in code or tests; use env. Keep each change under 400 lines and list the files you will touch before you touch them.
```

## Part E — After Prompt 9: what comes next
S2–S4 follow doc 40 §3. The next prompts are the task rows themselves: SA-1.1 Zones, SA-1.7 member access model, IH-2 registrations, SA-2.2 Restaurants, IH-3 order intake, SA-4.1 order state machine. For each, use the doc 38 template, name the lane, and list which of docs 08/09/10/36/42 to load.
