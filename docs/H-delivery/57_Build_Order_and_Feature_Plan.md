# 57 — Build order and feature plan (after doc 56)

Owner's answers of 2026-10-14 (doc 03 D6, D13, D18, D36, D47, D54, D68, D88, D91–D108) and the roadmap
`docs/A-product/roadmap/Zoauro_Admin_Panel_Prototype_Modification_and_Phase_Roadmap_v2_Full_Updated.docx` (R01–R25).
Principle the owner set: **everything configurable is a Super Admin setting** (values per zone where it makes sense), with the
decided defaults pre-filled, audited on every change.

How mature delivery platforms run their admin side (Swiggy, Zomato, Uber Eats patterns, public behaviour only), and what we
take from it:

| Pattern | What it means for ZOAURO |
|---|---|
| City/zone operations teams own a geography; central team owns policy | Zones + multi-zone Zonal Admins with per-zone access (built: M02, M03 next) |
| Partner onboarding is a document-driven pipeline with verification separate from go-live | R01/R12 queues; configurable document checklist (D97); verification status ≠ operational status |
| Menus change through approval, never edited live by the vendor | R09 item-change requests; approved value stays live until approval |
| Live order control room: delayed orders, unassigned orders, rider shortage alerts | Orders board with SLA timers per status, auto-flags, reassign partner |
| Refunds are rule-driven with limits and a second approver for big amounts | D13/D95/D96: per-zone limits, two approvers above a configurable amount, reason-based rules |
| Support desk with SLAs, auto-assignment and escalation, tickets linked to orders/refunds | D93/D98: zone queues, round-robin or skill assignment, SLA clocks, escalation |
| Surge, delivery fee and service-area switches per zone | D92 per-zone service switches; zone delivery charge (built); later dynamic fee rules |
| Campaigns and promotions approved centrally | D94: Zonal promotions need Super Admin approval; quiet hours (D100) |
| Payout cycles, reconciliation and COD cash control | M14/M15 with daily reconciliation and variance alerts |
| Everything audited; sensitive data masked with audited reveal | Built: M04 audit, D26 masking |

## Build order

| # | Workstream | Contents | Depends on | Lane |
|---|---|---|---|---|
| 1 | **M03 Access Control** (now) | Zonal Admin accounts (D102, D103), access profiles, member access editor per zone with grants/denies and limits, zone teams, access change history, effective-access preview (D104–D108) | M01, M02 | API: backend session; screens: web session |
| 2 | **Super Admin Control Panel** | Per-zone service switches (Restaurants, Home Food, Hotel Booking, …, D92); one place to see each zone's services, team and access; platform settings: refund limits per zone and the two-approver amount (D13, D95, D106), refund rules (D96), onboarding document checklist (D97), support SLAs (D98), notification channels and timing (D99, D100), order-number format (D88), SMS provider (D68), loyalty values (D101) | 1 | both |
| 3 | **Vendors: Restaurants + Home Food** | Port the colleague's `feature/m06-m07-restaurants-homemakers` onto the core (our schema already has the tables); restaurant detail tabs (R07); onboarding queue (R01) with the D97 checklist | 1, 2 | colleague + review |
| 4 | **Orders** | Port `dev_cb` orders onto the core: zone scope (AuthContext), state machine of doc 10, optimistic version, live board with delay flags | 3 | colleague + review |
| 5 | Menu and Food Item Requests | R07–R09 approval flow, global catalogue | 3 | |
| 6 | Delivery Partners + Partner Requests | R12 with the D97 checklist; availability, cash in hand | 1, 2 | |
| 7 | Payments (Razorpay, D6) + Refunds and letters | Webhooks, ledger, refund rules (D96), limits and dual approval (D95), letters (R16) | 4 | |
| 8 | Support desk | D93, D98: queues per zone, dynamic assignment, SLA clocks, ticket↔order/refund links | 4, 7 | |
| 9 | Notifications | D94, D99, D100: composer, approval for promotions, in-app and email first, MSG91 later | 2 | |
| 10 | Hotel Room Booking | D91: scope with the designers, then build | 2 | |
| 11 | COD settlement, payouts, analytics, reviews | | 4, 7 | |
| 12 | Phase 2: offers, loyalty, campaigns | D101: all values configurable | 9 | |

## Combining the colleagues' branches

Both remote branches (`dev_cb`, `feature/m06-m07-restaurants-homemakers`) start from the scaffold commit `869c70b` and rebuild
the foundation (schema, first migration, auth, zones). They must **not** be merged as they are: their migrations collide with
the 7 migrations applied to `zoauro`, and auth/zones would exist twice. The useful parts (vendors module and screens, orders
module) are ported module by module onto the core, on the existing `restaurants`, `homemakers` and `orders` tables, following
AGENTS.md (route → controller → service → repository with AuthContext and zone scope, audit, Zod in `@zoauro/shared`). For that
the colleagues need the core on GitHub: the owner decides when local `main` is pushed (it is 55+ commits ahead of
`origin/main`).
