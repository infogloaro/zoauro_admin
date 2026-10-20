# 35 — Zonal Admin Execution Plan (Phases ZA-1 … ZA-7)

Scope: everything under `/zone`: one login that checks, monitors and operates restaurants, homemakers, delivery partners, customers, orders and payments across **all assigned zones** (doc 36). Prerequisites: Foundation gates F1, F2 and the matching SA phase gate (doc 33 "build once, expose twice").
Zonal Admin sidebar (Figma): Dashboard, Orders, Restaurants, Homemakers, Delivery Partners, Customers, plus Payments (D36).
Out of scope for this panel: zone/admin/role management, settings, offers, analytics, reviews, zone reports/performance/complaints. Support tickets ARE in scope for a Zonal Admin's own zones when granted (support:view / support:edit, D93; desk D139–D141).

## Phase ZA-1 — Zone-scoped access shell (≈ 1.5 weeks) — starts after SA-1.7 (stub resolver acceptable earlier)
Goal: a Zonal Admin with 1 or many zones logs in, sees only their scope, and can switch it.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-1.1 | `GET /me` with zones[], `PUT /me/zone-scope`, `user_preferences`, effective-scope plumbing for list endpoints | S | P0 | SA-1.7 | 09 /me; 14 §4 |
| ZA-1.2 | **Zone scope switcher** (sidebar zone card with chevron): All my zones / single zone, URL `?zone=`, preference save, static when 1 zone | M | P0 | ZA-1.1, F2.2 | 18 §4; 36 §2 |
| ZA-1.3 | Zonal AdminShell: orange active item, zonal menu from permissions, route guards, `/super-admin/*` → 404, `/zone/no-zones` page | M | P0 | F2.2 | 18 |
| ZA-1.4 | Multi-zone authorization suite: TC-MZ-1, 2, 3, 7, 13, 14 on the existing endpoints; fixtures Admin(A), Admin(A+B), Admin(none) | M | P0 | F1.6 | 36 §6 |
| ZA-1.5 | Socket.IO handshake auth + zone room join/leave on `scope.changed` (skeleton; events arrive in ZA-4) | M | P1 | SA-4.5 or stub | 06 §6 |
**Gate ZA-1:** admin(A+B) sees both zones, cannot reach C by URL or API; removing B mid-session yields 404 on next request and the switcher updates.

## Phase ZA-2 — Vendor operations (≈ 2 weeks) — after SA-2 gate
Goal: a Zonal Admin onboards and manages restaurants, homemakers and menus in their zones.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-2.1 | Enable `/zone/restaurants` and `/zone/homemakers`: Zone column/ZoneChip, zone filter (assigned only), required Zone field on create, commission read-only (D10), no move-zone | M | P0 | SA-2.2, SA-2.3, ZA-1.2 | 21 |
| ZA-2.2 | Vendor approval workflow screens for zonal use: document review, verify/reject with note, activate/suspend/deactivate, bulk status, area filter | M | P0 | ZA-2.1 | 05 UC-02 |
| ZA-2.3 | `/zone/menu` (Figma has menu only under Restaurants/Homemakers tabs): item management scoped by vendor's zone, bulk actions drop ids outside scope | M | P0 | SA-2.4, ZA-2.1 | 22 |
| ZA-2.4 | Tests: TC-MZ-4, TC-MZ-8, TC-ZONE-2, TC-ROLE-2 (commission edit rejected) | M | P0 | ZA-2.3 | 24 |
**Gate ZA-2:** admin(A+B) onboards a homemaker in B and a restaurant in A; cannot create in C; commission field is read-only.

### v2.0 addition to ZA-2/ZA-3
The **Pending registrations inbox** (`/zone/registrations`, doc 45 §1.2) and the "Pending verification" tabs on Restaurants, Homemakers and Delivery Partners are enabled with ZA-2/ZA-3: self-registered vendors and partners of the member's zones appear within seconds; verify/reject needs `…:status`; unzoned items are never visible to Zonal Admins.

## Phase ZA-3 — Delivery partners and customers (≈ 1.5 weeks) — after SA-3 gate
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-3.1 | `/zone/delivery-partners`: scoped list/add/verify, availability, force offline, cash-in-hand column, partner detail with assigned orders (read) | M | P0 | SA-3.2, ZA-1.2 | 05 UC-07 |
| ZA-3.2 | `/zone/customers`: D25 visibility, scope-filtered orders/total spent, add customer with zone for address, block/unblock, audited reveal of masked phone/email | M | P0 | SA-3.1 | D25–D28 |
| ZA-3.3 | Tests: TC-MZ-12, TC-ZONE masking, partner zone rule | S | P0 | ZA-3.2 | 24 |
**Gate ZA-3:** customer with address in A and orders only in C shows 0 orders/₹0 to admin(A); reveal is audited.

## Phase ZA-4 — Live order operations (≈ 3 weeks) — after SA-4 gate
Goal: the daily job: watch orders arrive, move them, fix problems.
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-4.1 | `/zone/orders` list per Figma: KPI cards, tab filters, filters (restaurant, payment, date), Zone column, export (scoped, audited) | M | P0 | SA-4.3 | 20 Orders |
| ZA-4.2 | Order detail (zonal): all actions allowed by D2 within zone: accept on vendor's behalf, ready, assign/reassign (partners of the order's zone only), mark delayed, cancel with reason | L | P0 | SA-4.4, ZA-4.1 | 05 UC-04/05 |
| ZA-4.3 | Real-time: Socket.IO events per zone room, new-order highlight + optional sound toggle, per-zone toast, bell badge across scope, polling fallback | M | P1 | SA-4.5, ZA-1.5 | 23 §6 |
| ZA-4.4 | Incoming-orders monitor for a vendor (live PLACED/ACCEPTED/PREPARING with timers and acceptance timeout) | M | P1 | ZA-4.3 | 21 §2 |
| ZA-4.5 | Tests: TC-MZ-9, TC-MZ-11, TC-ORD-3/4 as zonal actor, E2E "new order → assign → delivered" with admin(A+B) | M | P0 | ZA-4.2 | 24 |
**Gate ZA-4:** two zonal admins sharing zone B act on the same order: one 200, one 409 with refresh prompt; admin(A) never receives zone B events.

## Phase ZA-5 — Zonal dashboard (≈ 1.5 weeks) — after SA-5 gate
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-5.1 | Scope-aware dashboard endpoints (reuse SA-5.1 with scope), zone-orders chart: bars per zone when scope > 1, per area when 1 zone | M | P0 | SA-5.1, ZA-1.1 | 36 §2 |
| ZA-5.2 | Dashboard UI per Figma: welcome line + zone subtitle, KPI cards (Total Orders, Restaurants, Homemakers, Delivery Partners, Customers) and **Today's Revenue** (in PDF, missing from screenshot: confirm), Order Overview, Order Status, Top Performing Restaurants, Zone/Area orders, Recent Orders/Restaurants/Partners/Customers | L | P0 | ZA-5.1 | 20 Zonal Dashboard |
| ZA-5.3 | Cache keys include scope hash; TC-MZ-5, TC-MZ-6 | S | P0 | ZA-5.1 | 36 §5 |
**Gate ZA-5:** KPIs for admin(A+B) equal direct DB counts for A+B; no cache bleed between scopes; p95 < 2 s.

## Phase ZA-6 — Money operations (≈ 2.5 weeks) — after SA-6.2–6.4 — **needs D36 design**
| ID | Task | Size | P | Depends | Docs |
|---|---|---|---|---|---|
| ZA-6.1 | `/zone/payments` (transactions, scoped) or payment panel inside order detail if D36 is declined | M | P0 | SA-6.2 | 16 |
| ZA-6.2 | Refund dialog for zonal: type, amount ≤ refundable, reason code, note; **limit banner with remaining per-refund and daily amount for the order's zone (from the member's assignment)**; over-limit → PENDING_APPROVAL; own request status list | L | P0 | SA-6.4 | 16 §3; D20 |
| ZA-6.3 | COD cash settlement screen: per-partner expected vs handed-in, variance flag, history | M | P0 | SA-6.3 | 16 §2 |
| ZA-6.4 | Tests: TC-AC-9/10, TC-REF-1/2/5 as zonal actor; alert on refund spike per member | M | P0 | ZA-6.2 | 24 |
**Gate ZA-6:** member with limits ₹500/refund in A and ₹300 in B: ₹800 in A is queued, ₹400 in B is queued, ₹250 in each is processed; limits counted separately per zone (D20); Super Admin approves; requester cannot approve.

## Phase ZA-7 — UAT, training, pilot (≈ 2 weeks, runs inside SA-9)
Pilot Zonal Admin with **two zones** on staging (UAT), short guide and recorded walkthrough, support runbook rows for "zone data missing" and "switcher shows wrong zones", production pilot with the multi-zone admin, 2-week stability review (doc 31).

## Zonal Admin phase summary
| Phase | Weeks | Starts after |
|---|---|---|
| ZA-1 | 1.5 | SA-1.7 |
| ZA-2 | 2 | SA-2 gate, ZA-1 |
| ZA-3 | 1.5 | SA-3 gate |
| ZA-4 | 3 | SA-4 gate, ZA-1 |
| ZA-5 | 1.5 | SA-5 gate |
| ZA-6 | 2.5 | SA-6.4, D36 |
| ZA-7 | 2 | all P0 |

## Combined calendar
**Superseded by doc 40** (three developers, 13 two-week sprints, about 26 weeks to pilot with app integration). The earlier two-developer 26-week figure was optimistic: the task sums are about 62 dev-weeks, so two developers would need about 31 weeks (about 40 with app integration). Phase contents above remain valid; ZA phases are scheduled inside the sprints of doc 40 §3.
