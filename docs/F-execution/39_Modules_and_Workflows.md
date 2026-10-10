# 39 — Modules and Workflows (Super Admin + Zonal Admin)

Scope is only the ZOAURO **Super Admin panel** and **Zonal Admin panel**. Customer, restaurant/homemaker and delivery-partner apps are out of scope; their data **arrives automatically** through the Integration API and admin decisions flow back (docs 41–45).

## 1. The authority model in one picture
```
                         ┌───────────────────────────────┐
                         │          SUPER ADMIN          │  superior: sees everything,
                         │ zones · members · access ·    │  grants all access, approves money
                         │ commission · settings · money │
                         └───────────────┬───────────────┘
              grants access per member per zone (Access Control panel)
        ┌──────────────────┬─────────────┴──────────┬──────────────────┐
   Zone: Chennai      Zone: Coimbatore         Zone: Madurai       Zone: …
   team of members    team of members          team of members
   Karthik [Manager]  Arun    [Manager]        Divya  [Manager]
   Priya   [Operations] Priya [Support]        Karthik[Read Only]
        │                  │                        │
   Each member works only in the zones assigned to them, and in each zone only with the
   access granted there (profile + overrides + limits). Orders, vendors, partners,
   customers and refunds of a zone belong to that zone, never to a member.
```
A member can sit in many zones with different access in each; a zone can have many members with different access each (D3, D7, D41).

## 2. Module catalogue
Panel column: **SA** Super Admin, **ZA** Zonal Admin (when granted). Figma column: seen = frame reviewed; **gap** = no frame exists or not reviewed (doc 37, D47). Priority P0 launch-critical, P1 launch, P2 after pilot.

### Platform and access
| ID | Module | SA | ZA | What it does | Figma | P |
|---|---|---|---|---|---|---|
| M01 | Auth and Sessions | login, 2FA, sessions, lockout, password reset | same | Login card with Super Admin / Zonal Admin tabs, forgot password, remember me, role routing, 2FA | seen (Google login removed, D42) | P0 |
| M02 | Zone Management | create/edit zones, KPIs, team stack, impact check | — | Zone, city, state, pincode range, delivery charge, status Active/Inactive/Upcoming | seen | P0 |
| M03 | **Zonal Admins and Access Control** *(new)* | member accounts; **Zone Teams, Access Profiles, Member Access editor, Access Preview, Change History** | — | Who is on which zone's team and exactly what each can do there | **gap** | P0 |
| M04 | Audit and Logs | system logs, access history | entity Activity tab | Append-only audit of every write | partly (Settings > System Logs not seen) | P0 |
| M05 | Zone Scope Switcher | — | All my zones / one zone | Narrows every list, KPI, chart, export and alert | seen (chevron), no open state | P0 |

### Operations (master data)
| ID | Module | SA | ZA | What it does | Figma | P |
|---|---|---|---|---|---|---|
| M06 | Restaurants | all zones; sets commission; move zone | granted zones; approve/verify/suspend; commission read-only | Onboarding, documents, verification (separate from status), hours | seen (list); detail gap | P0 |
| M07 | Homemakers | same | same | Food category, experience, availability, daily capacity, rating, top cities | seen (SA list/charts, ZA list) | P0 |
| M08 | Menu / Food Items | all | granted zones | Items, categories, price, stock, featured, bulk, import | seen (SA) | P0 |
| M09 | Customers | all | granted zones (rule D25) | Profile, addresses, orders, block, add customer, masked contact + audited reveal | seen | P0 |
| M10 | Delivery Partners | all | granted zones | Onboarding, documents, verification, availability, cash in hand, rating | seen | P0 |

### Orders and money
| ID | Module | SA | ZA | What it does | Figma | P |
|---|---|---|---|---|---|---|
| M11 | Orders | all zones | granted zones, live | List, details, timeline, accept on vendor's behalf, assign/reassign partner, cancel, export | list seen; **details gap** | P0 |
| M12 | Payments | transactions (Customer Payments, Restaurant Payouts, Delivery Partner Payouts, Refunds tabs) | transactions in granted zones | Signed webhooks, ledger, methods UPI/Card/Wallet/COD/Bank Transfer | SA seen; ZA **gap** (D36) | P0 |
| M13 | Refunds | approval queue, unlimited | create within the member's per-zone limits; track own requests | Types, reason codes, ceiling, approvals | partly (Recent Refunds widget) | P0 |
| M14 | COD Cash Settlement | all | granted zones | Partner cash-in-hand vs handed-in, variance | **gap** | P0 |
| M15 | Payouts and Reconciliation | vendor and delivery-partner payouts, daily reconciliation | view | Weekly payout generation, mark paid, mismatch report | SA tabs seen | P1 |

### Visibility and communication
| ID | Module | SA | ZA | What it does | Figma | P |
|---|---|---|---|---|---|---|
| M16 | Dashboards | global, 12 KPIs, charts, zones without a team | scope KPIs and charts (tiles hidden without permission) | Per-role dashboards | seen both | P0 |
| M17 | Real-time and Notifications | compose to audiences, bell | alerts per zone room, bell | Socket.IO events, new-order toast, sound toggle | bell seen; compose **gap** | P1 |
| M18 | Global Search | all | scoped by permission | Header search box | box seen | P1 |
| M19 | Settings and Security | 9 tabs; 2FA policy, sessions, login history | — | General, Business, Payment & Commission, Orders, User Management (D43), Security, Notifications, Integrations, Logs | Security, User Mgmt seen; rest gap | P1 |
| M21 | **Integration Hub and App Data Feed** *(new v2.0)* | clients, webhooks, event monitor, kill switch, unzoned registrations | pending-registrations inbox, order/entity "source" labels | Receives data from the customer, vendor and partner apps, sends admin decisions back, shows health | **gap** (Settings > Integrations tab exists, content missing) | P0 |
| M20 | Extras: Analytics, Offers & Coupons, Reviews & Ratings, Support | full | not in v1 | Drawn in Figma, not in the launch goal | seen | P2 |

## 3. Workflows
Actors: **SA** Super Admin, **ZM** Zonal Admin member, **System**. Each step names the module.

### W1 — Open a new zone and staff it (the control-panel flow you asked for)
1. SA creates the zone (M02): name, city, state, pincode range, delivery charge, status Upcoming → Active.
2. SA creates member accounts (M03): name, email, phone, initial password; system emails credentials and forces a password change on first login.
3. SA opens **Zone Teams → the zone → Add member** (M03), picks the member and an **Access Profile** (e.g. Zone Manager).
4. SA adjusts if needed in the **Member Access editor**: per-module grant/deny overrides, refund limits, reveal-contact and export flags. "Same access in all zones" for members in several zones.
5. SA checks the **Access Preview**: the member's effective permissions, sidebar items and dashboard tiles.
6. SA saves → diff dialog → re-authentication → audit + Access Change History → member gets an email → member's open tabs refresh on the next request.
7. Add a second member to the same zone with different access (e.g. Operations) by repeating steps 3–6. The zone now has a team of two.

### W13 — Data arrives from the apps (v2.0)
1. A vendor or partner registers in its app → Integration API (M21) → zone resolved from pincode (M02) → record created Pending → appears in the zone's Pending list within seconds (M06/M07/M10) and raises the "Pending verification" counter (M16).
2. Unknown pincode → only Super Admin sees it under Needs a zone → assigns a zone (M02) → the zone team is notified.
3. A member with `…:status` verifies or rejects → event goes back to the app (M21) → the vendor/partner can go live or sees the reason.
4. Customers, addresses and orders arrive the same way; each order is shown with its source app.

### W14 — Admin control reaches the apps (v2.0)
Suspend a vendor, block a customer, force a partner offline, disable a menu item, cancel or reassign an order, refund: action is checked against the member's access in that zone → saved and audited → signed event to the apps → the Core refuses further actions even if an app ignores the event. Super Admin can pause a whole app with the kill switch.

### W2 — A member's working day
1. Member logs in on the Zonal Admin tab (M01) → lands on the dashboard for **All my zones**.
2. Sidebar and dashboard show only what the member's access allows (M16); zones without `orders:view` are not in the Orders scope.
3. Member switches the scope to one zone (M05); URL `?zone=` and saved preference.
4. New order alert arrives only from zones where the member has `orders:view` (M17).
5. Member acts on orders (M11) where `orders:status/edit` is granted; where it is not, controls are disabled with a tooltip and the API returns 403.

### W3 — Change or take away access
1. SA opens the member in Access Control (or edits an Access Profile used by several members).
2. Changes profile, overrides, limits or removes a zone; impact notice shows how many members are affected.
3. Re-auth → saved → cache invalidated → `scope.changed` emitted → next request enforces. Removing a zone makes that zone's objects return 404; revoking `orders:edit` makes writes return 403.
4. Suspending the account revokes sessions.

### W4 — Vendor onboarding (M06/M07/M08)
1. ZM (with `restaurants:add` in the zone) or SA creates the restaurant/homemaker in a chosen zone (status Pending, verification Pending).
2. Uploads documents; reviewer (ZM with `:status`, or SA) verifies or rejects with a note.
3. SA sets commission (ZM cannot). Hours set.
4. Verified vendor activated → visible to customers. Items added in M08.
5. Suspension blocks new orders; open orders continue.

### W5 — Order life (M11, with M12–M14)
1. Order arrives through the Intake API as Placed (UI label "Pending") in the vendor's zone.
2. Vendor accepts (or ZM accepts on its behalf; or 5-minute timeout cancels and refunds).
3. Preparing → Ready. ZM assigns a verified, online partner **of the same zone** under the concurrent-order cap.
4. Partner picks up → Out for Delivery → Delivered; COD: collection confirmed.
5. Interventions: reassign, cancel with reason (until Out for Delivery), mark delayed, refund. Two members acting at once: second gets 409 and refreshes.

### W6 — Refund (M13)
1. Member opens order → Refund: type, amount ≤ refundable, reason code.
2. System reads the member's limits for the order's zone. Within per-refund and daily limit → processed via gateway (online), wallet or manual (COD) with an idempotency key and a ledger entry.
3. Above limit or none granted → Pending Approval → SA sees the queue → approves or rejects with a note (requester cannot approve).

### W7 — COD settlement (M14)
Partner delivers COD orders → cash-in-hand grows → at end of day ZM records the amount handed in → variance flagged → history kept.

### W8 — Payouts (M15, SA)
Weekly job builds payouts for restaurants, homemakers and delivery partners (commission and refund attribution applied) → SA reviews → marks paid with re-auth → daily reconciliation flags mismatches older than 48 h.

### W9 — Platform monitoring (SA)
Dashboard (M16) → click a KPI or zone bar → list pre-filtered by zone (M11/M06…) → open record. "Zones without a team" card leads to Zone Teams.

### W10 — Settings and security (SA, M19)
Edit password policy, 2FA enforcement, lock duration, session rules, commission default, refund defaults, order rules → confirmation for risky fields → audited → effective within 60 s.

### W11 — Notifications (M17)
SA composes to an audience (zone, vendors, partners, customers), channel and schedule; members receive operational alerts for their zones only.

### W12 — Customer data privacy (M09)
Lists show masked phone/email → member with `customers:reveal` clicks reveal → audited → no export of contact data without `customers:export`.

## 4. Module dependency order (build order)
```
M01 Auth → M04 Audit → M02 Zones → M03 Access Control ─┬→ M05 Switcher
                                                      ├→ M06/M07 Vendors → M08 Menu ┐
                                                      ├→ M09 Customers              ├→ M11 Orders → M12 Payments → M13 Refunds → M15 Payouts
                                                      └→ M10 Partners ──────────────┘          └→ M14 COD
M21 Integration framework (IH-1) before M11 Orders and before any vendor/partner/customer inbound; outbound (IH-5) after the outbox exists · M16 Dashboards after M11 (orders) and M12 (revenue tiles) · M17 after M11 · M18 after M11 · M19 anytime after M01 · M20 after pilot
```
