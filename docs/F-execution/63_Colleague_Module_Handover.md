# 63: Module handover for the colleague team (2026-10-22)

The owner has assigned five modules to the colleague team for today. For each one, this document lists what is already built, what remains (by priority) and the reviewed build specs you can follow. **Deliver by end of day today. The core team adopts the work tomorrow morning, before the demo on 2026-10-23 at 15:00 IST.**

Priorities: **P0** = needed for the demo, **P1** = build next, **P2** = later. Paths are relative to the repository root.

## 0. How to deliver (adoption rule, D117: we port, we never merge)
A module goes into the demo only if **all** of these hold by **06:00 on 2026-10-23**:
1. It arrives as a **branch created from current `main`** (today `d585b85` or later) by end of day today.
2. `pnpm lint && pnpm typecheck && pnpm test` pass.
3. Every new or changed endpoint has authorization tests for the four profiles: **Super Admin, Admin(zone A), Admin(zones A+B), Admin(no zone)**.
4. No new tables or fields beyond docs 08 (schema) and 09 (API). If you need one, write it into those docs first and say so in the branch description.
5. It passes the core team's review.

Anything that misses the gate goes in right after the demo, and the demo keeps today's working version of that module.

## 1. Rules (from `AGENTS.md`; read it first)
- **Layers:** route → controller → service → repository. Only repositories import Prisma, and every repository method takes the `AuthContext`.
- **Zone scope:** a Zonal Admin sees only their zones. An object in another zone answers 404; a missing permission on a write answers 403. Use `can(ctx, 'module:action', zoneId)`, and never read zones from the session.
- **Validation:** Zod schemas live in `packages/shared`, shared by the API, the forms and the OpenAPI document (`apps/api/src/openapi/operations*.ts`).
- **Writes:** each write runs in a transaction with an audit entry, plus an outbox event when the apps must know (`docs/G-integration/contracts/events.catalog.json`).
- **Data:** money is integer paise. Deletes are soft. Contacts are masked in lists, and showing one is an audited "reveal".
- **Limits:**
  - no new libraries;
  - shipped migrations are never edited (add new files instead);
  - about 5 files per commit;
  - no invented fields or endpoints.
- **When you finish:** add a block to `docs/handoff.md`, and a row to `docs/E-quality-ops/32_Technical_Debt_and_Change_Log.md` for any decision or deviation.

## 2. Reviewed build specs (ready to follow)
| Spec | Module | What it adds |
|---|---|---|
| `specs/F1.md` | Restaurants and Home Food (+ hotels) | onboarding stage, history and "Ask for more info" on the vendor and hotel record pages |
| `specs/F2.md` | Delivery partner requests | Start review, Ask for more info, stage and age columns (needs a migration) |
| `specs/F3.md` | Hotels | hotel documents step: upload, view, accept or reject, the HOTEL checklist (no Verify gate; doc 09 rows first) |
| `specs/F5.md` | Customers (+ partners) | customer KPI row; delivery partner performance (satisfaction visible to Super Admins only) |
| no spec (small polish) | Menu, onboarding | sort on the menu items list; onboarding search by phone and area |

## 3. Restaurants and Home Food (shops, onboarding)
**Built**
- **API:** one vendors module serves `/restaurants` and `/homemakers`: list, create, edit, delete (asks for the password again), status, verification, move zone, audited reveal, documents (upload, view, verify) and export. Activation is allowed only after verification. A shop is a restaurant of kind SHOP; a cloud kitchen counts as Home Food (D168).
- **Onboarding queue:** `GET /onboarding` covers restaurants, homemakers and hotels together, with `…/onboarding/review` (claims the record, D174) and `…/onboarding/more-info` (D170).
- **Vendor plans:** `/vendor-plans` with subscriptions (D188).
- **Screens** (both roles): restaurants, homemakers, their detail pages, vendor onboarding, vendor plans.

**Remaining**
| Item | Pri | Where | Ref |
|---|---|---|---|
| Onboarding stage, history and "Ask for more info" on the record pages | P0 | `specs/F1.md` | D170 |
| Onboarding search by phone and area | P0 | `features/onboarding/OnboardingPage.tsx`, onboarding repository | D170 |
| Menu badge with the count of pending onboarding records | P1 | `apps/web/components/shell/usePendingCounts.ts` | D172 |
| Detail page tabs: Menu, Orders, Commission and hours, Activity (cards only today) | P1 | `features/vendors/VendorDetailPage.tsx` | doc 20, doc 60 §5 |
| Saved views on the onboarding queue | P1 | `OnboardingPage.tsx` | D170 |
| Bulk actions; filters by type, cuisine and area; rating and commission columns | P2 | `features/vendors/VendorsPage.tsx` | doc 20 |
| Vendor requests to override minimum order or delivery charge | P2 | new request type | D157 |

Note: `MoreInfoDialog.tsx`, `record-actions.ts` and `recordOnboardingSchema` were in progress in the core team's working tree. Pull `main` first to make sure you have them.

## 4. Menu and Food Item Requests
**Built**
- **Menu items:** create, edit, delete, admin-disable with a reason, Veg / Non-veg / Egg, image.
- **Bulk change:** availability, category or price, with a preview, up to 500 items, all or nothing (D124).
- **Categories:** soft delete, refused while items still use the category.
- **Food item requests:** list and detail. The detail shows, for each field, the original, live and proposed value, with a stale warning. Approve and reject are version-checked (D119, D125, D126).
- **Screens** (both roles): menu items, categories, food item requests.

**Remaining**
| Item | Pri | Where | Ref |
|---|---|---|---|
| Sort on the menu items list | P0 | `features/menu/MenuItemsPage.tsx` | audit finding |
| Menu import from a file (CSV). Only the bulk change exists | P1 | `modules/menu`, `MenuItemsPage.tsx` | doc 37 #12 |
| Menu tab on the vendor detail page | P1 | `features/vendors` | doc 60 |
| Playwright flow for menu and food item requests | P1 | `tests/e2e/flows` | AGENTS.md |
| Database unique index on category name (checked in the service only today) | P2 | new migration | doc 32 |

Food item requests reach the queue only from the demo seed. The vendor app's route for them belongs to the paused Integration API, so it is not yours.

## 5. Hotels, rooms, tables, pre-orders
**Built**
- **Hotels:** create, edit, status, verification, export; in the onboarding queue and record claims.
- **Room bookings:** a booking is refused when it exceeds the hotel's total rooms (409 `NO_ROOMS_AVAILABLE`, D127). Statuses: confirmed, checked in, checked out, cancelled.
- **Table bookings:** for a hotel or a restaurant. Statuses: confirmed, completed, no-show, cancelled.
- **Pre-orders:** schedule, reschedule (`POST /orders/{id}/reschedule`), dispatch sweep, cancel cut-off (D150, D167).
- **Screens** (both roles): hotels and hotel detail with booking panels; pre-order card and Reschedule on the order detail page; pre-orders filter on the orders list.
- **Data model:** there is no Room or Table model yet. Room type is free text and a table is a `tableArea` field.

**Remaining**
| Item | Pri | Where | Ref |
|---|---|---|---|
| Hotel documents step (GST, PAN, trade licence, bank; FSSAI optional) | P0 | `specs/F3.md` | D182 H2, D145 |
| Hotel, booking and dining routes in the authorization test matrix | P1 | `apps/api/tests/authz` | AGENTS.md |
| Hotel profile change requests: table, queue, approve or reject with the password; `hotels.profileApprovalFields` setting | P1 | new migration, `modules/hotels`, settings | D182 H4 |
| Reveal for hotel and booking contacts | P2 | `modules/hotels` | D26 |
| Hotels without a zone (Super Admin only); `zoneId` is required today | P2 | schema | D182 H3 |
| Room types and table inventory as real records (needs a decision) | P2 | docs 08/09 first | D127 |

## 6. Customers
**Built**
- **Customers:** list (tabs, search, source, zone), add customer (source ADMIN, first address with a zone, D28), edit, block and unblock with a reason, audited reveal (30 per hour, D26), export with contacts masked.
- **Reward points:** balance, ledger, adjust, convert to the wallet, earned on delivery, expiry job, settings per zone (D169).
- **Screens** (both roles): customers and customer detail (Profile, Wallet balance, Rewards, Addresses, latest orders).

**Remaining**
| Item | Pri | Where | Ref |
|---|---|---|---|
| Customer KPI row | P0 | `specs/F5.md` | — |
| Take back points when an order is fully refunded (`reverseForRefundedOrder` has no caller) | P1 | `modules/refunds/refunds.service.ts` | D169 |
| Wallet ledger: `GET /customers/{id}/wallet` and a section on the detail page | P1 | customers module, `CustomerDetailPage.tsx` | D24, D159 |
| Refunds section on the customer detail page | P1 | `CustomerDetailPage.tsx` | doc 20 |
| Soft delete of a customer | P2 | customers module | doc 04 |
| Open owner question: may a Zonal Admin edit a profile the app wrote? | decision | — | doc 44 |

## 7. Delivery partner requests
**Built**
- **Partners:** create, edit (version-checked), status (active only once verified), verification (approve, or reject with a note, D132), force offline, move zone, reveal, documents, export.
- **Assign picker:** lists partners who are online, active and verified (D133). It blocks partners over the COD cash limit on cash orders (D173).
- **Sign-up from the partner app** (Integration API): 201 when the pincode maps to a zone, 202 when it does not ("Needs a zone"), 409 for a duplicate mobile.
- **Screens** (both roles): partner requests (pending view; "Needs a zone" for the Super Admin), delivery partners, partner detail, a menu badge.

**Remaining**
| Item | Pri | Where | Ref |
|---|---|---|---|
| Start review, Ask for more info, stage and age columns (needs a migration) | P0 | `specs/F2.md` | D170 by analogy, D132 |
| Delivery partner performance metrics | P0 | `specs/F5.md` | — |
| Bank, licence and ID number fields (documents only today) | P2, needs a decision | — | D97 |

Partner-app intake (resubmit, documents, availability, location, cash hand-over) and auto-assign belong to the core team; leave them.

## 8. Shared areas: coordinate before touching
- **Onboarding** (`modules/onboarding`, `features/onboarding`) is shared by modules 3 and 5 (and 7 through F2). Agree who edits it.
- **Refunds** call into rewards and the wallet (module 6).
- **The demo seed** (`apps/api/scripts/demo/*`) belongs to the core demo lane. Send it the sample records your feature needs, and it adds them.

## 9. Core team work (not for the colleague team; listed so nobody builds it twice)
| # | Item | Pri | State on 2026-10-22 | Lane |
|---|---|---|---|---|
| C1 | Control Panel limited to a Super Admin's granted areas (D178, demo Act 12) | P0 | written, being committed | backend |
| C2 | Payouts: mark paid (Super Admin, password again) and exports | P1 | in progress (migration `payout_mark_paid`) | backend + web |
| C3 | Settings history filters; Super Admin 2-step reset dialog | P1 | in progress | web |
| C4 | Unpaid order timeout job (D161) and cancellation windows (D156) | P1 | settings exist, rule not enforced | backend |
| C5 | "Remember me" read from the Control Panel (D163) | P1 | setting exists, sign-in still reads the server environment | backend |
| C6 | Cleanup jobs: idempotency purge, export files, audit retention | P1 | not started | backend |
| C7 | Live updates for the new screens (D142) | P1 | planned | web |
| C8 | Automatic partner assignment (D154), off by default | P1 | after the demo | backend |
| C9 | Payment gateway: demo gateway and the key settings (D6, D194) | P1 | waiting for the Razorpay keys | backend |
| C10 | Integration API: orders, documents, menu, partner events, Hub screens, simulators (IH-2b to IH-9) | P1 | paused until after the demo | both |
| C11 | Offers and coupons (D182) | P2 | waiting for the owner's colleague's 2 modules | both |
| C12 | Ads and commission, meal plans, multi-restaurant checkout, map zones, analytics | P2 | after the demo, contracts first | both |
| C13 | Production: Dockerfiles, deploy job, AWS | P1 | waiting for AWS access | ops |
| C14 | Demo stack: builds at 13:30, 19:00, 23:30 and 06:00; final at 10:00 on 10-23; seed data for each new feature | P0 | running | demo |
