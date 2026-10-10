# 07 — Repository Structure and Coding Standards (v1.1)

## 1. Structure (monorepo, pnpm workspaces)
```
/apps
  /web                         Next.js App Router (UI only)
    /app
      /(auth)/login, /forgot-password, /reset-password, /2fa
      /(super-admin)/super-admin/...      dashboard, zones, zonal-admins, roles, settings, orders, restaurants, ...
      /(zonal)/zone/...                   dashboard, orders, restaurants, homemakers, delivery-partners, customers, payments
    /components/ui            shadcn components
    /components/shared        data-table, filter-bar, confirm-dialog, status-badge, page-header, zone-scope-switcher
    /features/<module>/       components, hooks (TanStack Query), forms
    /lib                      api-client (generated), auth-context, format (en-IN money/date)
  /api                         Express
    /src/modules/<name>/      routes.ts controller.ts service.ts repository.ts permissions.ts events.ts index.ts
    /src/lib                  auth, authz, scope, db, env, logger, errors, audit, pagination, idempotency, outbox
    /src/realtime             socket server, zone rooms
    /src/worker.ts            BullMQ processors
    /prisma                   schema.prisma, migrations, seed.ts
/packages
  /shared                      zod schemas, types, permission keys, enums, money helpers
/tests                         unit, integration, e2e (Playwright), authz (matrix)
/docs                          this documentation pack
/infra                         docker-compose.yml, nginx conf, deploy scripts (Terraform later, D31)
AGENTS.md
```
API modules: auth, zones, admins, access, orders, restaurants, homemakers, menu, customers, delivery-partners, payments, refunds, cash-settlement, dashboard, search, settings, notifications, audit, uploads, intake.

## 2. Naming
Files kebab-case; React components PascalCase; functions camelCase; DB tables snake_case plural; enums UPPER_SNAKE; Zod schemas `fooSchema`, types `Foo`; routes plural nouns; permission keys `module:action`.

## 3. TypeScript
`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`; no `any` without a comment and ticket; no non-null `!` outside tests; use `unknown` and narrow; types inferred from Zod where possible.

## 4. Module boundaries
- A module imports another module only through its `index.ts`.
- Only `repository.ts` imports Prisma; only `apps/api` imports Prisma at all.
- `apps/web` imports `packages/shared` and the generated API client, never `apps/api`.
- ESLint `import/no-restricted-paths` enforces the above.

## 5. Lint and format
ESLint (next, typescript-eslint, jsx-a11y, import), Prettier, Tailwind class sorting, `commitlint` (conventional commits), Husky pre-commit running lint-staged and typecheck.

## 6. Error handling
Typed `AppError` (code, httpStatus, message, details). Services throw; Express error middleware converts to the standard error body (doc 09). Never leak stack traces or SQL.

## 7. Logging
Structured JSON (pino) with `requestId`, `userId`, `zoneIds`. No passwords, tokens, card or OTP data in logs.

## 8. Git workflow
Trunk-based, short-lived branches `feat/…`, `fix/…`; PRs need CI green and one review; squash merge; migrations in the same PR as code.

## 9. Definition of a good PR
Small (< 400 lines changed), tests included, authorization tests for new endpoints (1-zone and N-zone admin), docs updated if a contract changed.
