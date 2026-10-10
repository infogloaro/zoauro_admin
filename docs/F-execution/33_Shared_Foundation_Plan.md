# 33 — Shared Foundation Plan (Phases F0–F2)

Super Admin and Zonal Admin are **one codebase, two route groups**. The foundation is built once; docs 34 (Super Admin) and 35 (Zonal Admin) then run as two plans on top of it. Sizes: S ≤ 1 day, M 2–3 days, L 4–5 days (one developer with AI assistance). Weeks assume 2 developers (one API-leaning, one web-leaning). All estimates are to be re-measured after the first two sprints.

## How the three plans fit together
```
F0 ─ F1 ─┬─ SA-1 ─ SA-2 ─ SA-3 ─ SA-4 ─ SA-5 ─ SA-6 ─ SA-7 ─ SA-9 (launch)
   └ F2 ─┘     │       │       │       │       │       │
               └ ZA-1 ─ ZA-2 ─ ZA-3 ─ ZA-4 ─ ZA-5 ─ ZA-6 ─────── ZA-7 (pilot)
```
Rule **"build once, expose twice"**: an SA phase builds the module (API, repository with scope, UI, tests). The matching ZA phase turns on the zonal route group, adds the zone column/chip/field, zonal-only operations and the multi-zone tests. A ZA phase never starts before its SA phase's API gate is green.

## Phase F0 — Decisions, setup, designs (≈ 1.5 weeks)
| ID | Task | Size | P | Depends |
|---|---|---|---|---|
| F0.1 | Close D16 (stack), D17 (separate repo/DB), **D18 (existing backend?)**, D21 (name). Update doc 03 | S | P0 | — |
| F0.2 | Send designer the gap list (doc 37 §4): missing screens, multi-zone changes, Payments for zonal, 5th permission column | S | P0 | — |
| F0.3 | Monorepo scaffold (pnpm), TypeScript strict, ESLint, Prettier, Husky, commitlint, import-boundary lint rules | S | P0 | — |
| F0.4 | Docker Compose (Postgres, Redis, MinIO, Mailpit), env validation (`lib/env.ts`) | S | P0 | F0.3 |
| F0.5 | GitHub Actions: lint, typecheck, unit/integration with service containers, `npm audit`, gitleaks | M | P0 | F0.3 |
| F0.6 | Extract design tokens from Figma/screenshots into Tailwind theme (doc 37 §3) | M | P0 | — |
| F0.7 | Staging host baseline: EC2 + Docker Compose + Nginx, RDS, S3, secrets (scripts, not Terraform) | M | P1 | F0.4 |
**Exit:** repo builds in CI; `docker compose up` gives a running empty stack; D16–D18 answered.

## Phase F1 — Platform core (API) (≈ 2.5 weeks)
| ID | Task | Size | P | Depends |
|---|---|---|---|---|
| F1.1 | Prisma schema: users, **access_profiles, profile_permissions, admin_zone_assignments (profile, limits), assignment_overrides, access_changes**, zones, sessions, login_history, audit_logs, settings, outbox, idempotency_keys, user_preferences | M | P0 | F0.3 |
| F1.2 | Session auth: login, logout, Argon2id, lockout, reset, first-login password change, CSRF, rate limiting | L | P0 | F1.1 |
| F1.3 | `AuthContext`, permission guard, **scope resolver (assigned ∩ requested)**, repository base class applying zone filter | L | P0 | F1.2 |
| F1.4 | Audit service (transaction-joined), `AppError` + error middleware, pagination/filter helpers, idempotency middleware | M | P0 | F1.3 |
| F1.5 | OpenAPI pipeline from shared Zod; generated client package | M | P0 | F1.3 |
| F1.6 | **Authorization matrix harness**: fixtures zones A, B, C; actors SuperAdmin, Admin(A), Admin(A+B), Admin(none); auto-generates 401/403/404/200 cases from OpenAPI | M | P0 | F1.5 |
| F1.7 | Seed: roles, default permission matrix (doc 04), first Super Admin | S | P0 | F1.1 |
**Exit (gate F1):** login works for both seeded roles; harness runs in CI and fails on a deliberately leaky test repository; audit row written for a sample write.

## Phase F2 — UI foundation (web) (≈ 2.5 weeks, parallel with F1 after F0.6)
| ID | Task | Size | P | Depends |
|---|---|---|---|---|
| F2.1 | Design system: tokens, shadcn theme, typography, status badge colours, Indian number/date formatting | M | P0 | F0.6 |
| F2.2 | AdminShell: collapsible gradient sidebar, role-driven menu config, top bar (search box placeholder, bell, profile), breadcrumbs | L | P0 | F2.1 |
| F2.3 | DataTable (server pagination, sort, URL state, row select, density, column visibility), FilterBar with dropdown overlays, Reset | L | P0 | F2.1 |
| F2.4 | Forms kit (RHF + Zod resolver, FormField, MoneyInput, PhoneInput), Sheet/Dialog overlays, ConfirmDialog, Toast | L | P0 | F2.1 |
| F2.5 | StatCard (KPI with delta line), chart wrappers (Recharts with legends), EmptyState/ErrorState/Skeleton | M | P0 | F2.1 |
| F2.6 | Auth screens: login (show/hide password, remember me), forgot/reset, 2FA step; role routing; 404 for wrong group | M | P0 | F1.2, F2.2 |
| F2.7 | API client wiring: generated client, TanStack Query provider, auth context, 401/403/404/409/422 handling | M | P0 | F1.5 |
**Exit (gate F2):** a stub "Zones" page lists seed zones through DataTable using the real API with permission-aware menu; login → role redirect works for both roles.

## Foundation risks
| Risk | Response |
|---|---|
| D18 answered "backend exists" | F1 shrinks (no order/payment tables); SA-4 becomes an adapter phase; re-plan before F1 starts |
| Designer is slow on missing screens | Build from doc 20/21/22 specs using the design system; mark screens "provisional" |
| CRM auth is shareable | Replace F1.2 with extraction task (S–M) |
