# AGENTS.md — ZOAURO Admin Panel (GloAro Food Delivery)

## Project

Web admin panel for ZOAURO food delivery. Roles: **Super Admin** (all zones) and **Zonal Admin** (1..N assigned zones; one admin can operate restaurants, homemakers, delivery partners, customers, orders and payments across all of them).
Stack (D16, Assumed: do not change without the owner's permission): TypeScript strict; Next.js App Router web; Node.js + Express API (modular monolith); PostgreSQL + Prisma; Redis + BullMQ; Socket.IO; S3; Tailwind + shadcn/ui + Radix; React Hook Form + Zod; TanStack Query; Sentry; GitHub Actions; Docker + Nginx on AWS. **Do not change the stack without explicit permission.**
Monorepo: `apps/web`, `apps/api`, `packages/shared`; plus `tools/simulators` (app simulators, doc 48), `.github/workflows` (CI), and the contracts under `docs/G-integration/contracts/`.

## Read order (load only what the task needs)

1. This file. 2. `docs/FEATURES.md` (what is built), then the task row in `docs/F-execution/34|35` (it names the docs to load; the finished foundation plan 33 is in `docs/archive/`). 3. `docs/A-product/03_*` (decisions) only if business rules matter. 4. Relevant sections of 08 (schema), 09 (API), 10 (state machines), 04 (permissions), 36 (multi-zone). 5. UI tasks: 18–22, 37 and Figma. 6. Only then source files. Parallel sessions: obey the lanes in doc 38.

## Before changing code

- Inspect the existing module and copy its patterns.
- Check whether the endpoint, table, enum or permission already exists in docs 08/09/04.
- Check `docs/handoff.md` for the latest state.

## Architecture rules

- API layers: route → controller → service → repository → Prisma. Only repositories import Prisma. `apps/web` never imports Prisma or `apps/api`.
- Every repository method takes `AuthContext`. Non-Super-Admin queries ALWAYS filter by `zone_id IN ctx.effectiveZoneIds`, where effective = requested ∩ assigned (doc 36). Scope is resolved per request from `admin_zone_assignments`, never stored in the session.
- Cross-zone object → 404. Unassigned zone id in a query → 404 `ZONE_NOT_FOUND`. Missing capability → 403.
- Counts, aggregates, exports, search, global search, caches, Socket.IO rooms and notifications all use the same effective scope. Cache keys include the scope hash.
- Authorization is server-side on every route and query; UI hiding is not a security boundary. Strip restricted fields on the server.
- Validate all input with Zod (schemas live in `packages/shared`, shared with forms and OpenAPI).
- Money: integer paise, never floats. Dates: UTC in DB. Display: Indian grouping.
- Writes: transaction + audit entry. Order changes only via the state machine (doc 10) with optimistic version check.
- Payments/refunds: idempotency keys, signed webhooks, ledger entries (doc 16). Refund limits (per refund, per day) are per member per zone, read from the assignment (doc 04, D20).
- Soft delete by default (`deleted_at`).
- Restaurants and Homemakers are separate modules; an order or menu item belongs to exactly one vendor. Vendor, partner and order each belong to exactly one zone.
- Mask phone/email in lists; reveal is an audited call (D26).

## Allowed changes

Files inside the task's module and lane (doc 38), its tests, shared components when the task says so, and docs the change makes outdated. Migrations only as new files.

## Prohibited

- Inventing endpoints, fields, enums, roles or permissions not in the docs; ask instead.
- Weakening or bypassing authorization, zone scoping, CSRF, rate limits, validation.
- Resolving items marked **[ASSUMPTION]**, Assumed or Open in doc 03 without asking (current Open: D6, D18, D36, D47, D54, D68, D88; Assumed but not yet confirmed by the owner: D16, D17, D41, D52, D53, D73, D75, D78–D87, D89, D90).
- Editing shipped migrations; destructive DB commands; touching production config.
- Secrets in code, logs, tests or commits; PII in logs.
- `any`, non-null `!`, `dangerouslySetInnerHTML`, raw SQL string concatenation.
- Large refactors mixed with feature work; more than ~5 files per task (exception: scaffold and schema tasks F0.3, F1.1 and generated files; they still stay reviewable, one concern per commit).
- Adding libraries or infrastructure (Terraform, ECS, new queues) not in doc 06.

## Testing

Add or update: unit tests for services; integration tests for endpoints; **authorization/scope tests for every new or changed endpoint for SuperAdmin, Admin(A), Admin(A+B), Admin(none)**; Playwright flow for new journeys. Before finishing run: `pnpm lint && pnpm typecheck && pnpm test`.

## UI rules

Follow Figma, doc 19 and doc 37. Use shadcn components from `components/ui`. Every list: search, filters (URL state), sort, pagination, loading/empty/error states, Zone chip when scope > 1. Confirm destructive actions. Toasts for results.

## Definition of done

See doc 25 and the gate line of the task's phase. Update docs/OpenAPI if contracts change; add a row to doc 32 for any decision or deviation.

## When unsure

Stop and ask with a concrete question and a proposed default.

## Handoff

At the end of a task append the block from doc 38 §5 to `docs/handoff.md`.

## Access model (v1.2, D41)

- Roles: SUPER_ADMIN and ZONAL_ADMIN. Zonal access = Access Profile + GRANT/DENY overrides + limits, per member per zone. Deny wins.
- Never read a zone list from the session. Use `can(ctx, 'module:action', zoneId)` and `zonesFor(ctx, 'module:view')` (doc 14 §4). Unassigned zone or unviewable module on read → 404; missing action on write → 403.
- Non-grantable to Zonal Admin: zones, access, settings, commission edit.
- Access changes: re-auth, audit + `access_changes`, member email, cache invalidation, `scope.changed`.
- Team: 3 developers, ownership and lanes in docs 40 and 38. Do not change the stack without permission.

## App integration (v2.0)

- Data from the customer, vendor and partner apps arrives only through `/api/v1/intake/*` (HMAC-signed, Idempotency-Key). Contract: `docs/G-integration/42` and `contracts/intake.openapi.yaml`. Never invent field names: change the contract first.
- Apps never write locked fields (status, verification, commission, zone, admin_disabled). One writer per field (doc 44).
- Every state change that apps must know about goes through the outbox and the catalogue in `contracts/events.catalog.json`. Receivers are idempotent; so are we.
- Test every inbound handler with the simulators (`tools/simulators`) and TC-INT cases (doc 48). Do not log request bodies with PII.
