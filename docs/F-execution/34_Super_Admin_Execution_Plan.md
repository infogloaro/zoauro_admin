# 34 — Super Admin Execution Plan (Phases SA-1 … SA-9)

Scope: everything under `/super-admin`: global dashboard, platform structure (zones, Zonal Admins, Access Control), all operational modules across all zones, money control, settings and security. Prerequisite: Foundation gates F1 and F2 (doc 33).
Sizes: S ≤ 1 day, M 2–3 days, L 4–5 days. "Docs" = the only sections an AI session should load for the task (doc 28).

## Phase SA-1 — Platform structure: zones, Zonal Admins, Access Control (≈ 7 dev-weeks; v1.2)
Goal: Super Admin can open a new city and give people access to it with no code change.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-1.1 | Zones API + UI: list with KPI cards (Total/Active/Inactive/Upcoming), table (name, city, state, admins, restaurants, homemakers, partners, customers, status), Add/Edit overlay (name, city, state, pincode range, delivery charge, status, description), deactivate with impact check | M | P0 | F1, F2 | 08 zones; 09 /zones; 20 Zone Mgmt; 22 Zone form |
| SA-1.2 | Zonal Admin **member accounts** API + UI: list, Add/Edit overlay (name, email, phone, password, status), credentials email, forced password change, reset password, revoke sessions. Zones and access are set in SA-1.7–1.9, not here | M | P0 | SA-1.1 | 08 users; 09 /zonal-admins; 20 |
| SA-1.3 | Superseded by SA-1.7 (`PUT /zonal-admins/{id}/access`) | — | — | — | 09 |
| SA-1.4 | **Access Profiles** UI + API: seed profiles (Zone Manager, Operations, Support, Finance View, Read Only), permission matrix View/Add/Edit/Delete/Status per module, default limits, delete blocked if in use, impact notice on save | M | P0 | SA-1.7 | 04; 09 /access-profiles; 20 |
| SA-1.5 | **Superseded by doc 50 phases AU-1…AU-4, AU-7** (audit schema and guard, write service, wiring and coverage guard, read API, Activity tab). Original: audit log reader (cursor list, filters) | M | P0 | F1.4 | 08 audit_logs; 09 /audit-logs |
| SA-1.6 | Tests: harness coverage for all SA-1 endpoints; TC-MZ-14 | S | P0 | SA-1.4 | 24 |
| SA-1.7 | **Member access model (backend):** profiles, assignments (member × zone), GRANT/DENY overrides (deny wins), limits, grantable-module allow-list, resolver `can()`/`zonesFor()`, Redis cache ≤ 60 s with invalidation, `scope.changed`, re-auth, diff, `access_changes` + audit | L | P0 | F1.3, SA-1.1 | 04; 08; 09; 14 §4 |
| SA-1.8 | **Zone Teams** API + UI: zone → members, add/remove member with profile, zones-without-team list | M | P0 | SA-1.7 | 20; 09 /zones/{id}/team |
| SA-1.9 | **Member Access editor** UI: zone × profile × overrides × limits, "same in all zones", diff dialog, **Access Preview** drawer (effective permissions, sidebar, tiles) | L | P0 | SA-1.7 | 20; 22 |
| SA-1.10 | Access Change History list + email to member on change | S | P0 | SA-1.7 | 09 /access-changes |
| SA-1.11 | Test suite TC-AC-1…14 + TC-MZ-1…15 on all existing endpoints | M | P0 | SA-1.7 | 36 §6, §6b |
**Gate SA-1:** create a zone → create two member accounts → put both in the zone with different profiles (Zone Manager, Read Only) → each logs in and sees exactly their access (Read Only gets 403 on writes, sidebar differs) → Access Preview matches API behaviour → removing a zone changes the next request → all changes audited and in Access Change History. TC-AC-1…14 pass.

## Phase SA-2 — Vendors and menu (≈ 3 weeks)
Goal: every restaurant and homemaker on the platform can be onboarded, verified, priced and listed.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-2.1 | Uploads: presign/confirm, allow-lists (5 MB images, 10 MB PDFs), private keys `zone/{id}/{entity}/{uuid}`, signed reads, DocumentViewer, ImageUploader | M | P0 | F1 | 11 Uploads; 09 /uploads |
| SA-2.2 | Restaurants: list (KPI cards, filters cuisine/status/area/zone, bulk status), Add/Edit, detail tabs (Overview, Documents, Menu, Orders, Commission & hours, Activity), verification flow (Verified/Rejected + note) separate from status, commission edit (Super Admin), soft delete, move-zone | L | P0 | SA-2.1, SA-1.1 | 08; 09; 21; 22 |
| SA-2.3 | Homemakers: same shape, daily capacity, speciality tags, kitchen verification | L | P0 | SA-2.2 | 21 §3 |
| SA-2.4 | Menu / Food Items: table (item, vendor, category, price, stock, status, featured toggle), KPI cards, add/edit overlay, categories, bulk availability/category/price with preview, optimistic toggles | L | P0 | SA-2.2, SA-2.3 | 22 bulk |
| SA-2.5 | Menu import CSV (Figma "Import" button) with dry-run, formula-injection escaping | M | P1 | SA-2.4 | 13 T16 |
**Gate SA-2:** verified restaurant + homemaker with items exist; suspended vendor hidden; TC-VEN-1/2, TC-UPL-1 pass; authz harness green.

## Phase SA-3 — People: customers and delivery partners (≈ 2 weeks)
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-3.1 | Customers: list (KPIs, filters location/status/user type), detail (addresses, orders, refunds), block/unblock, Add Customer (`source=ADMIN`), masked contact with audited reveal, export | M | P0 | F2 | 08 customers; D25–D28 |
| SA-3.2 | Delivery Partners: list (KPIs incl. On Duty Now), add, documents, verification, force offline, vehicle fields, rating and deliveries display | M | P0 | SA-2.1 | 05 UC-07 |
**Gate SA-3:** TC-ZONE and masking tests pass for both modules.

## Phase SA-4 — Orders (≈ 4 weeks)
Goal: every order on the platform can be seen, moved through its life and intervened on.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-4.1 | Order schema, state machine service (doc 10), history, optimistic `version`, outbox write in same transaction | L | P0 | SA-2.4, SA-3.2 | 08 orders; 10 |
| SA-4.2 | Superseded by IH-1 and IH-3 (Integration API, order intake, simulators) in phase SA-10 | — | — | — | G-integration 42 |
| SA-4.3 | Orders list: KPI cards, tab filters (All/Preparing/Out for Delivery/Delivered/Cancelled), filters restaurant/payment/date, search, export (async), row actions | L | P0 | SA-4.1 | 20 Orders |
| SA-4.4 | Order detail: items, amounts, customer/address, vendor, partner, payment panel, timeline, internal notes; actions accept, ready, assign/reassign, cancel with reason | L | P0 | SA-4.3 | 20 Order details |
| SA-4.5 | Outbox publisher worker + Socket.IO server with zone rooms; live list refresh, new-order highlight | M | P1 | SA-4.1 | 06 §6 |
| SA-4.6 | Concurrency: version conflicts (TC-ORD-3), partner cap (TC-ORD-4); acceptance timeout job (R-ORD-4) | M | P0 | SA-4.4 | 10 §6 |
**Gate SA-4:** simulator order walks PLACED→DELIVERED with history; invalid transition 409; two-admin race yields one 200 and one 409.

## Phase SA-5 — Super Admin dashboard (≈ 2 weeks)
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-5.1 | Dashboard APIs: summary (orders, customers, restaurants, active, pending verification, suspended, partners), order overview, order status, top categories, new registrations, recent orders, zone performance | L | P0 | SA-4.1 | 09 /dashboard |
| SA-5.2 | Dashboard UI per Figma: KPI rows, Order Overview (with tooltip), Order Status donut, Top Food Categories, Recent Orders, New Registrations tabs, Platform Health (DB-derived only, D34), date filter, click-through to lists, zones-without-team card | L | P0 | SA-5.1, F2.5 | 20 Dashboard |
| SA-5.3 | Redis aggregate cache keyed by scope hash (TTL 30–60 s) | S | P1 | SA-5.1 | 36 §5 |
Revenue, Commission, Refunds, Payouts, Avg Order Value, Revenue Overview widgets are wired in SA-6.7 once the ledger exists; until then they show "—".
**Gate SA-5:** KPIs equal direct DB counts; dashboard p95 < 2 s on seeded 100k orders.

## Phase SA-6 — Money (≈ 4 weeks) — **needs D6 (gateway) closed**
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-6.1 | `PaymentProvider` interface + chosen gateway adapter, payment attempt creation | L | P0 | D6 | 11; 16 |
| SA-6.2 | Webhook endpoint: raw-body signature verify, `webhook_events` dedupe, job processing, ledger entries, amount check vs gateway | L | P0 | SA-6.1 | 16 §3–4 |
| SA-6.3 | COD collection → payment PAID, partner `cash_in_hand`, `cash_settlements` API | M | P0 | SA-4.4 | 16 §2 |
| SA-6.4 | Refund engine: types, reason codes, ceiling, per-member per-zone limits (per refund, per day) read from the assignment, PENDING_APPROVAL queue, approve/reject (requester ≠ approver), retry with same key, wallet/manual targets | L | P0 | SA-6.2 | 16; 10 §3 |
| SA-6.5 | Commission and payouts: weekly generation job idempotent per (vendor, period), mark paid with re-auth | L | P1 | SA-6.2 | 16 §5 |
| SA-6.6 | Daily reconciliation job and report, 48 h alert | M | P1 | SA-6.2 | 16 §6 |
| SA-6.7 | Payments screens (Transactions, Refunds + pending queue, Payouts, Reconciliation); revenue/commission/refund widgets on dashboard | L | P0 | SA-6.4 | 20 Payments |
**Gate SA-6:** TC-PAY-1…4 and TC-REF-1…5 pass; ledger balances per order; a controlled real transaction + refund succeeds in staging.

## Phase SA-7 — Settings, security, notifications, search (≈ 2.5 weeks) P1
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| SA-7.1 | Settings sections (General, Business & Operations, Payment & Commission, Order Settings, User Management, Security, Notifications, Integrations, System Logs) with Save Changes confirmation for risky fields | L | P1 | F2.4 | 20 Settings |
| SA-7.2 | Security tab: TOTP 2FA setup/enforcement, email OTP, session timeout, attempts, lock duration, new-login notice, active sessions, login history, Security Status card | L | P1 | F1.2 | 14 |
| SA-7.3 | Notifications module: compose to audience (zone/vendors/partners/customers), channel, schedule, history; bell + operational alerts feed | M | P1 | SA-4.5 | 20 Notifications |
| SA-7.4 | System Logs viewer = doc 50 phase AU-6 (export AU-8 and retention AU-5 after pilot) | M | P1 | SA-1.5 | |
| SA-7.5 | Global search (orders, customers, vendors, partners), per-entity permission + scope | M | P1 | SA-4.3 | D32 |
| SA-7.6 | Profile polish: clone profile, list of members using a profile | S | P1 | SA-1.4 | D30 |
**Gate SA-7:** 2FA enforced → un-enrolled user forced to enrol; settings changes audited and effective ≤ 60 s.

## Phase SA-8 — Extras (≈ 4 weeks, P2, after pilot launch if time is tight)
Analytics (tabs from Figma), Offers & Coupons, Reviews & Ratings moderation, Support tickets. Each is a separate M–L module with its own gate; none blocks launch. Re-confirm scope first: these four are in the Figma sidebar but not in the pilot goal.

## Phase SA-9 — Hardening and launch (≈ 3 weeks; shared with ZA-7)
Load test (k6), accessibility audit (axe), ZAP baseline + pen test, monitoring dashboards and alarms, backup restore drill, data import rehearsal, UAT, release checklist (doc 31), pilot zone go-live.

## Phase SA-10 — Integration with the three apps (≈ 7.5 dev-weeks, v2.0; split across developers, see doc 40)
Goal: data from the customer, vendor and partner apps arrives automatically; admin decisions go back to them. Contracts: `G-integration/42–45`, `contracts/`. Needs D18 answered.
| ID | Task | Size | P | Depends | Owner |
|---|---|---|---|---|---|
| IH-1 | Integration framework: `api_clients` + encrypted secrets, HMAC verification on raw body, timestamp window, scopes, IP allow-list, rate limits, idempotency (7 days), inbound log, error codes, `client:create` CLI | L | P0 | F1.4, F1.5 | Dev 3 |
| IH-2 | Zone resolver (`/zones/resolve`, pincode ranges), `external_refs`, **vendor and partner self-registration** inbound with documents, UNASSIGNED handling, pending-registrations inbox and Needs-a-zone tab | L | P0 | IH-1, SA-1.1 | Dev 2 |
| IH-3 | Order intake: create with price and zone validation, cancel, vendor-response, partner-events, `GET /orders/{id}`, payment-expiry job (15 min), `source_app` on history; minimal simulators (customer, vendor, partner) | L | P0 | IH-1, SA-4.1 | Dev 3 |
| IH-4 | Menu items, hours, availability, stock inbound; customer and address upsert; partner availability, location, cash-handover | M | P0 | IH-2 | Dev 2 |
| IH-5 | Outbound: subscriptions, signer, delivery worker with retries and dead letter, event catalogue, pull feed, SSRF guard | L | P0 | SA-4.5 outbox | Dev 1 |
| IH-6 | Integration Hub UI: App connections, Webhook endpoints, Event monitor (inbound/outbound, retry/replay), Needs attention, Sandbox | L | P0 | IH-5 | Dev 1 |
| IH-7 | Full simulators with fault injection, scenario runner (100k order seed), contract suite TC-INT-1…26 in CI | M | P0 | IH-3, IH-5 | Dev 1 (basic part by Dev 3 inside IH-3) |
| IH-8 | `broadcast.created` and `config.changed` outbound from Notifications and Settings | S | P1 | IH-5, SA-7.3 | Dev 1 |
| IH-9 | Import tool (dry run, report, idempotent) for existing app data (doc 44 §5), only if the apps hold data | M | P1 | IH-2, IH-4 | Dev 2 |
**Gate SA-10:** all three simulators and then the real apps pass the contract suite in sandbox; a vendor that registers in the app appears in the right zone's Pending list in under 5 seconds; E2E-1…8 of doc 48 pass.

## Super Admin phase summary
| Phase | Weeks | Needs |
|---|---|---|
| SA-1 | 7 dev-weeks (was 3; Access Control added) | F1, F2 |
| SA-2 | 3 | SA-1.1 |
| SA-3 | 2 | SA-2.1 |
| SA-4 | 4 | SA-2, SA-3 |
| SA-5 | 2 | SA-4.1 |
| SA-6 | 4 | SA-4, **D6** |
| SA-7 | 2.5 | SA-1, SA-4.5 |
| SA-8 | 4 (P2) | — |
| SA-9 | 3 | all P0/P1 |
| SA-10 | 7.5 dev-weeks (v2.0) | D18, SA-4.1 |
