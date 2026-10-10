# 40 — Three-Developer Allocation and Module-by-Module Execution Plan

Team: **3 developers** (D49), each able to run up to two Claude Code sessions. This document supersedes the calendar in doc 35. Task ids (F*, SA-*, ZA-*) come from docs 33–35; module ids (M01–M20) from doc 39.

## 1. Allocation principle
Each developer **owns whole modules end to end** (schema, API, UI, tests, zonal enablement). Ownership lines follow the three risk areas of the product, so the two security-critical areas have a different owner and can review each other:

| Developer | Role | Owns | Why |
|---|---|---|---|
| **Dev 1** | Platform and Access | M01 Auth, M04 Audit, M02 Zones, **M03 Zonal Admins and Access Control**, M05 Scope switcher, M17 Real-time and notifications, M18 Search, M19 Settings and Security; Prisma schema gatekeeper; final authorization suite | Everything that decides who can see and do what. Builds first because everyone else depends on the scope and access resolver |
| **Dev 2** | Operations and UI kit | UI kit and app shell (F2), M06 Restaurants, M07 Homemakers, M08 Menu, M09 Customers, M10 Delivery Partners, zonal enablement of those modules, Zonal order screens (ZA-4), dashboard UIs (M16 UI) | Master data and the screens members live in. Owns the shared components so the look stays consistent |
| **Dev 3** | Orders and Money | CI/CD and staging, test harness and fixtures, OpenAPI pipeline, M11 Orders, M12 Payments, M13 Refunds, M14 COD, M15 Payouts and Reconciliation, dashboard aggregate APIs (M16 API), Zonal money screens (ZA-6) | The critical path: order state machine, then money. Starts with infrastructure so Dev 1 and Dev 2 are never blocked on environments |

**Super Admin vs Zonal Admin:** nobody owns "the Super Admin panel" or "the Zonal Admin panel" as a whole. For each module the owner builds the Super Admin version first and then switches on the Zonal version (zone column/chip, zone field, granted-permission gating, zonal-only operations) in the sprint listed below. Dev 1 owns what separates the two panels (login routing, Access Control, scope).

## 2. Working agreements
1. **Contract first.** The module owner merges the Zod schemas in `packages/shared` and the OpenAPI shape before anyone consumes them. Consumers build against mocks generated from the OpenAPI file.
2. **Schema gatekeeper: Dev 1.** `prisma/schema.prisma` changes go in small PRs touching only your tables, reviewed by Dev 1 the same working day. Migrations are only added, never edited. The full doc-08 schema (all tables) is created in Sprint 0–1 so later sprints add columns, not tables.
3. **UI kit gatekeeper: Dev 2.** `components/ui`, `components/shared` change only by small PRs reviewed by Dev 2.
4. **Hotspot files are split per module** to avoid conflicts: `menu-config.<module>.ts`, `routes.<module>.ts`, `permissions.<module>.ts`. The central index files are append-only and owned by Dev 1.
5. **Buddy review.** Dev 1 ↔ Dev 3 review each other line by line on anything touching auth, scope, access, money, webhooks. Dev 2's PRs are reviewed by Dev 1 (authorization usage) or Dev 3 (orders, state). Every module therefore has a second person who can take it over.
6. **Trunk-based, protected main**, PRs ≤ 400 lines, feature flags for unfinished screens. No long-lived integration branch.
7. **Authorization tests are part of every PR**: actors Super Admin, Admin(A full), Admin(A+B: full in A, read-only in B), Admin(A, payments denied), Admin(none).
8. **Parallel Claude Code sessions:** a developer may run two sessions only on different modules or on API vs UI of the same module (lanes in doc 38). Prompt template and handoff block from doc 38.
9. **Rituals:** 15-minute daily sync, 2-week sprints, end-of-sprint demo against the gate line, handoff block appended to `docs/handoff.md` after every task.

## 3. Sprint-by-sprint plan (13 sprints × 2 weeks = 26 weeks to pilot, v2.0)
Estimate basis: task sizes of docs 33–35 (S 0.2, M 0.5, L 1 dev-week) plus the new Access Control work (≈ 3.5 dev-weeks) ≈ **62 dev-weeks** of build, **plus ≈ 7.5 dev-weeks of app integration (phase SA-10, v2.0) ≈ 69.5 dev-weeks**. Over 3 developers that is ≈ 23 weeks, plus ≈ 15% review and integration overhead, which gives **26 weeks (13 sprints)**. If D18 turns out to be Mode B (adapter to an existing backend) add ≈ 3 dev-weeks, about one more week. The v1.2 figure of 24 weeks is superseded. Re-measure after Sprint 2.

| Sprint | Dev 1 — Platform and Access | Dev 2 — Operations and UI | Dev 3 — Orders and Money |
|---|---|---|---|
| **S0** W1–2 | F0.3 monorepo; F1.1 **full Prisma schema** (doc 08); auth design review | F0.6 tokens; F2.1 design system; F2.2 shell and role-driven sidebars | F0.4 compose + env validation; F0.5 CI; F0.7 staging host; fixtures skeleton |
| **S1** W3–4 | F1.2 session auth, lockout, reset, CSRF; F1.3 `AuthContext` with **permissionsByZone** and `zonesFor()`; F1.7 seeds | F2.3 DataTable/FilterBar; F2.4 forms kit/dialogs/toasts; F2.5 StatCard/charts/states | F1.4 errors, pagination, idempotency; F1.5 OpenAPI + client; F1.6 **authorization harness**; start SA-4.1 state-machine unit tests |
| **S2** W5–6 | M04 audit service; **M02 Zones API+UI (SA-1.1)**; SA-1.7 access model backend (profiles, assignments, overrides, resolver, cache) | F2.6 login screens (role tabs); F2.7 client wiring; SA-2.1 uploads | SA-4.1 order schema/service/history/outbox row; **IH-1** integration framework (HMAC, inbound log, idempotency, `client:create` CLI) |
| ▶ **Gate 1** | F1/F2 done: login → role redirect, harness fails on a leaky repo, Zones list via DataTable | | |
| **S3** W7–8 | SA-1.2 member accounts; SA-1.8 Zone Teams; SA-1.9 Member Access editor + Preview (UI) | SA-2.2 **Restaurants** (list, add/edit, detail tabs, verification); **IH-2** zone resolver, vendor/partner self-registration inbound, pending-registrations inbox | SA-4.3 Orders list; **IH-3** order intake + minimal simulators |
| **S4** W9–10 | SA-1.4 Access Profiles UI; SA-1.10 history + member email; SA-1.11 TC-AC suite; ZA-1.1–1.3 switcher, no-zones, zonal shell | SA-2.3 **Homemakers**; SA-2.4 **Menu** + bulk | SA-4.4 order detail and actions; SA-4.6 concurrency, acceptance-timeout and payment-expiry jobs |
| ▶ **Gate 2** | SA-1 and ZA-1 gates: Super Admin builds a zone team of two with different access, both log in and see exactly their access; vendors and orders work end to end with the simulator. **D6 gateway must be decided here** | | |
| **S5** W11–12 | SA-4.5/ZA-1.5 Socket.IO zone rooms + outbox publisher; **IH-5** outbound webhooks, retries, feed; ZA-1.4 multi-zone suite on all existing endpoints | SA-3.1 **Customers**; SA-3.2 **Delivery Partners**; **IH-4** menu/availability/customer/partner inbound | SA-6.1 PaymentProvider + gateway adapter; SA-6.2 webhooks, dedupe, ledger |
| **S6** W13–14 | SA-7.1 Settings sections; SA-7.2 Security tab, 2FA, sessions, login history | ZA-2 **zonal vendor ops** (Restaurants, Homemakers, Menu in zones) | SA-6.3 COD + cash settlements; SA-6.4 refund engine with per-assignment limits and approval queue |
| ▶ **Gate 3** | Money backend core: TC-PAY, TC-REF pass; 2FA enforced; zonal vendor ops live | | |
| **S7** W15–16 | **IH-6** Integration Hub UI; SA-7.3 notifications API + UI | ZA-3 zonal Partners and Customers; ZA-4.1 zonal Orders list | SA-6.5 payouts (restaurants, homemakers, partners); SA-6.6 reconciliation |
| **S8** W17–18 | SA-7.5 global search; SA-7.4 system logs (AU-6); SA-7.6 polish; **IH-7** fault-injecting simulators + TC-INT suite in CI; **IH-8**; authorization hardening and TC-AC/TC-MZ/TC-INT full run (continues in S9) | ZA-4.2 zonal order actions; ZA-4.3 real-time UI; ZA-4.4 incoming monitor | SA-6.7 Payments screens (tabs per Figma); SA-5.1 and ZA-5.1 dashboard aggregate APIs + scope-hash cache |
| ▶ **Gate 4** | Zonal live operations: two members on one zone act on the same order (one 200, one 409); no cross-scope events | | |
| **S9** W19–20 | SA-9 security: ZAP baseline, secrets scan, dependency audit, fixes | SA-5.2 and ZA-5.2 dashboard UIs; ZA-4.5 E2E | ZA-6 zonal money: payments view, refund dialog with limit banner, COD settlement screen |
| **S10** W21–22 | UAT support; pen-test fixes; restore drill | UAT fixes; a11y pass (axe); **IH-9** import rehearsal (if apps hold data) | Load test (k6); reconciliation drill; UAT fixes |
| ▶ **Gate 5** | Release gates of doc 31 except pilot data | | |
| **S11** W23–24 | **Real-app integration UAT** (doc 48): app teams run the contract suite on sandbox, E2E-1…8 with real apps; fixes | same | same |
| ▶ **Gate 6** | All three real apps pass the contract suite and E2E-1…8 on staging | | |
| **S12** W25–26 | Pilot launch with one multi-zone member and a two-member team; hyper-care; handoff docs | same | same |
| After pilot | SA-8 extras (Analytics, Offers, Reviews, Support) split across the three developers | | |

Integration note (v2.0): app teams need sandbox credentials from the end of S2 (created by the `client:create` CLI; the Hub UI arrives in S7) and a stable contract from the workshop in week 0. Dev 1 is tight in S5 and S8; if integration slips, IH-7 fault injection and IH-9 move to S9–S10. Buffer note: Dev 2's Sprint 7–9 are the fullest. If Dev 2 slips, ZA-5.2 dashboards move to Dev 1 in S9 (Dev 1 has slack after S8).

## 4. Module-by-module execution plan
Every module follows the same build order: **(1) contract** (shared Zod + OpenAPI) → **(2) schema** → **(3) repository + service** with scope and permission checks → **(4) API tests** incl. actor matrix → **(5) UI** → **(6) zonal enablement** → **(7) gate**. "Zonal" means switching on the `/zone` route group with zone chip/field, permission-gated controls and `TC-MZ`/`TC-AC` cases.

| Module | Owner / reviewer | Sprints | Key steps | Done when (gate line) |
|---|---|---|---|---|
| **M01 Auth and Sessions** | Dev 1 / Dev 3 | S1, S2 UI by Dev 2 | Argon2id, session store, lockout, reset, first-login change, CSRF, rate limit, login tabs validated server-side, redirect by role | Login works for both tabs; wrong-tab credentials give the generic error; 5 failures lock 30 min; TC-AUTH-1…5 |
| **M04 Audit** (doc 50, AU-1…AU-9; ≈ 3.3 dev-weeks) | Dev 1 / Dev 3 | S2, S4 reader, S7 logs | Transaction-joined audit writer, append-only table, cursor list, entity Activity filter | Every write in every module has an audit row with actor and zone; TC-AUD-1 |
| **M02 Zones** | Dev 1 / Dev 2 | S2 | CRUD, State, Upcoming, pincode range, impact check, team stack column | Duplicate name rejected; deactivate shows impact; list matches Figma columns |
| **M03 Zonal Admins and Access Control** | Dev 1 / Dev 3 | S2–S4 | Profiles + matrix, assignments, overrides, limits, resolver + cache, Zone Teams, Member Access editor, Access Preview, re-auth, diff, history, member email, grantable-module allow-list | TC-AC-1…14 pass; Preview equals actual API behaviour; a zone with two members of different access verified live |
| **M05 Scope switcher** | Dev 1 / Dev 2 | S4 | `/me` zones + permissions, `PUT /me/zone-scope`, URL sync, single-zone static, no-zones page | TC-MZ-1,2,7,13; switching narrows every list and KPI |
| **M06 Restaurants** | Dev 2 / Dev 1 | S3 SA, S6 ZA | Documents, verification vs status, commission (SA only), hours, move-zone (SA only), soft delete | SA: verified restaurant listed; ZA: create only in zones with `restaurants:add`, commission read-only; TC-VEN-1, TC-MZ-8 |
| **M07 Homemakers** | Dev 2 / Dev 1 | S4 SA, S6 ZA | Food category, experience, availability, daily capacity, verification | Same as M06 for homemakers |
| **M08 Menu** | Dev 2 / Dev 3 | S4 SA, S6 ZA | Items, categories, stock, featured toggle (optimistic), bulk with preview, import (P1) | Bulk with foreign-zone ids rejects them (TC-MZ-4); TC-VEN-2 |
| **M09 Customers** | Dev 2 / Dev 1 | S5 SA, S7 ZA | Visibility rule D25, block, add customer, masked contact + audited reveal, scope-filtered spend/orders | TC-MZ-12; reveal needs `customers:reveal` and is audited |
| **M10 Delivery Partners** | Dev 2 / Dev 3 | S5 SA, S7 ZA | Documents, verification, force offline, cash in hand, rating | Partner of zone B cannot be assigned to zone A order |
| **M11 Orders** | Dev 3 / Dev 1 | S2–S4 SA, S7–S9 ZA (screens by Dev 2) | State machine with version check, history, outbox row, Intake API + simulator, list, detail, assign/cancel, acceptance timeout | Simulator walks PLACED→DELIVERED; invalid transition 409; two members race → 200 + 409; TC-ORD-1…4, TC-AC-8 |
| **M17 Real-time and notifications** | Dev 1 / Dev 3 | S5, S7 | Socket.IO handshake, per-zone, per-module rooms, `scope.changed`, outbox publisher, bell feed, compose | Member never receives an event for a zone/module without view permission (TC-MZ-11) |
| **M12 Payments** | Dev 3 / Dev 1 | S5, S8 UI | Provider interface, signed webhook, dedupe, amount check, ledger | TC-PAY-1…4; ledger balanced per order |
| **M13 Refunds** | Dev 3 / Dev 1 | S6 SA, S9 ZA | Types, reason codes, ceiling, per-assignment limits, approval queue, retry | TC-REF-1…5, TC-AC-9/10 |
| **M14 COD Settlement** | Dev 3 / Dev 2 | S6 SA, S9 ZA | Cash-in-hand, handed-in, variance | Variance flagged; history kept |
| **M15 Payouts and Reconciliation** | Dev 3 / Dev 1 | S7 | Weekly job, idempotent per (payee, period), partner payouts, daily reconciliation, 48 h alert | Re-running the job creates no duplicates; mismatch report works |
| **M16 Dashboards** | API Dev 3, UI Dev 2 / Dev 1 | S8–S9 | Aggregates keyed by scope hash, tiles hidden without permission, zones-without-team card | KPIs equal DB counts; no cache bleed (TC-MZ-5/6); tiles follow TC-AC-3; p95 < 2 s |
| **M18 Search** | Dev 1 / Dev 3 | S7 | Per-entity permission + scope | TC-MZ-15 |
| **M19 Settings and Security** | Dev 1 / Dev 2 | S6–S7 | 9 tabs, 2FA enforcement, session rules, lock duration, risky-field confirmation | Changes audited, effective ≤ 60 s; 2FA enrolment forced |
| **M21 Integration Hub and App Data Feed** | Framework and intake Dev 3, outbound and Hub UI Dev 1, registration/menu/people inbound Dev 2 / buddy: Dev 3↔Dev 1 | S2 framework, S3 intake and registration, S5 outbound and people inbound, S7 Hub UI, S8 simulators, S11 real apps | HMAC auth, inbound log, idempotency, zone resolver, order intake with price validation, webhooks with retries, pull feed, Hub screens, simulators | TC-INT-1…26 pass; real apps pass contract suite; vendor registration visible in the right zone in under 5 s |
| **M20 Extras (P2)** | split | after pilot | Analytics, Offers, Reviews, Support | Not on the launch path |

## 5. Dependencies that can stall a developer, and the workaround
| Waiting on | Who waits | Workaround |
|---|---|---|
| Access resolver (S1–S2) | Dev 2, Dev 3 | Dev 1 ships a **stub resolver** at end of S1 that returns "Zone Manager" access for seeded actors; real resolver replaces it with no API change |
| Full Prisma schema | all | Created in S0–S1 from doc 08, so later work only adds columns |
| Missing Figma frames (Access Control, Order Details, Zonal Payments) | Dev 1, Dev 3, Dev 2 | Build from doc 20/22 specs using the UI kit; mark provisional; designer reviews at the sprint demo |
| Gateway decision D6 | Dev 3 | Needed by end of S4; the interface and the simulator let Dev 3 proceed until then |
| D18 existing backend | everyone | Needed before F1.1 (end of S0); if "yes", S2 Orders becomes an adapter task and the schema shrinks |
| Order data for dashboards | Dev 2 | Dev 3's simulator seeds 100k orders by end of S2 |

## 6. Capacity check (dev-weeks)
| | Dev 1 | Dev 2 | Dev 3 |
|---|---|---|---|
| Foundation | 4.2 + 1.0 | 5.7 | 2.6 |
| Platform and access modules | 12.0 | — | — |
| Operations modules | — | 12.5 | — |
| Orders, money, aggregates | — | — | 15.5 |
| Zonal enablement | 2.2 (switcher, suite) | 4.7 + 2.0 (dashboard UIs) | 2.5 |
| Hardening and launch | 1.5 | 1.5 | 1.5 |
| **Total** | **≈ 20.9** | **≈ 26.4** → move ZA-5.2 and some ZA-3 work to Dev 1 → ≈ 22 | **≈ 22.1** |
v2.0 adds the integration work (IH-1…IH-9, ≈ +7.5): Dev 1 ≈ +3.4 (outbound, Hub UI, full simulators, broadcast), Dev 2 ≈ +2.3 (registrations, menu and people inbound, import), Dev 3 ≈ +2.0 (framework, order intake, minimal simulators). After the rebalance every developer carries ≈ 24–25 dev-weeks, which is why the plan is now 13 sprints (26 weeks). The earlier two-developer calendar in doc 35 (26 weeks) was too optimistic: the same work (with integration) is ≈ 40 weeks for two developers.

## 7. Risks
| Risk | Response |
|---|---|
| Dev 3 is on the critical path (orders → money) | Dev 1 takes the review role and the dashboard-scope work; if Dev 3 slips, SA-6.5/6.6 (P1) move after the pilot |
| Access Control UI has no design | Spec in doc 20; designer reviews in S3 demo; component set reused from the UI kit |
| Gateway or backend decisions late (D6, D18) | Dates above; decision owner: product owner |
| Security-critical code written by AI | Line-by-line human review by the buddy (agreement 5) |
| One developer unavailable | Each module has a named reviewer who already knows the code |
