# 38 — Claude Code Lanes and Prompt Guide

You run two or more Claude Code sessions at once. This guide keeps them from editing the same files. It extends doc 28 (token efficiency).

## 1. File-ownership lanes
| Lane | Owns (only this lane edits) | Never touches |
|---|---|---|
| A — API module | `apps/api/src/modules/<one module>/**`, its tests in `tests/api/<module>/` | other modules, `packages/shared` schema files of other modules, `prisma/schema.prisma` |
| B — Web feature | `apps/web/features/<one feature>/**`, `apps/web/app/**/<route of that feature>/**` | `components/ui`, `components/shared`, other features |
| C — Shared contracts | `packages/shared/src/<module>/**` (Zod schemas, enums, permission keys) | app code |
| D — Platform (serialised) | `prisma/schema.prisma` + migrations, `apps/api/src/lib/**`, `apps/web/components/{ui,shared}/**`, `AGENTS.md`, `docs/` | feature code |
Rules: (1) only **one** session at a time works in lane D, and it merges before others rebase; (2) a task starts only after its lane-C contract (schema + OpenAPI) is merged; (3) a Prisma change goes through lane D first, then lane A uses it.

## 2. Safe parallel pairs
| Parallel session 1 | Parallel session 2 |
|---|---|
| A: restaurants API | B: zones UI |
| A: customers API | B: restaurants UI (needs only merged restaurants contract) |
| B: orders list UI | A: refunds engine |
| Two A sessions | only if they own different modules |

## 3. Task prompt template
```
Task: <one sentence, task id from docs 33–35, e.g. SA-2.2>
Lane: A|B|C|D        Module: <name>
Load only: AGENTS.md, docs/<08 §table>, <09 §endpoints>, <04 rows>, <36 §x if zone-related>
Files you may change (max 5): <list>
Rules: scope via repository (effectiveZoneIds), Zod from packages/shared, audit every write,
       authorization tests for Admin(A), Admin(A+B), Admin(none), SuperAdmin.
Done when: <gate line from the plan>; pnpm lint && pnpm typecheck && pnpm test pass.
```

## 4. Per-phase kickoff prompts
| Phase | One-line kickoff |
|---|---|
| F1 | "Implement F1.3: AuthContext + scope resolver + repository base. Contract: doc 14 §4, doc 36 §1. Add the leaky-repository test that the harness must catch." |
| SA-1 | "Implement SA-1.7: PUT /zonal-admins/{id}/access with profile, overrides, limits, re-auth, audit diff, cache invalidation, scope.changed. Tests TC-AC-1…14." |
| SA-2 | "Implement SA-2.2 restaurants API only (lane A). UI follows after the contract merges." |
| SA-4 | "Implement SA-4.1 state machine from doc 10 with version check and outbox row in the same transaction." |
| ZA-1 | "Implement ZA-1.2 zone scope switcher (lane B). It reads /me.zones and writes ?zone=. No API changes." |
| ZA-4 | "Implement ZA-4.2 zonal order actions. Partner list must be limited to the order's zone. Add TC-MZ-9." |

## 5. Handoff block (append to `docs/handoff.md` after every task)
```
Date / task id:
Lane / files changed:
Contract changes (docs 08/09/10/36):
Decisions or [ASSUMPTION]s touched (D-numbers):
Gate line status (pass/fail):
Next step:
Verify: pnpm lint && pnpm typecheck && pnpm test
```

## 5. Per-developer lanes (three developers, doc 40)
| Developer | Default lanes | Notes |
|---|---|---|
| Dev 1 Platform and Access | D (schema gatekeeper) + A for auth, zones, access, audit, settings, search, realtime | Only person who merges `prisma/schema.prisma` changes |
| Dev 2 Operations and UI | D for `components/{ui,shared}` + B everywhere, A for vendor/customer/partner modules | Owns the UI kit |
| Dev 3 Orders and Money | A for orders, payments, refunds, COD, payouts; CI/CD | Starts with CI and staging |
A developer may run one lane-D session at a time across the whole team (coordinate in the daily sync).
