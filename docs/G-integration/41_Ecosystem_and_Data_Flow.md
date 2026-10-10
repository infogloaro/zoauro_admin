# 41 — Ecosystem and Data Flow (how the three apps feed the admin panel)

Scope of this project is only the **Super Admin panel and the Zonal Admin panel**. The customer app, the restaurant/shop (vendor) app and the delivery-partner app are separate products. This document defines how their data arrives in the admin panel automatically, and how the admin panel's decisions go back to them. Detailed contracts: doc 42 (inbound), doc 43 (outbound), doc 44 (who owns which field), doc 45 (admin screens for it).

## 1. The idea in one picture
```
 CUSTOMER APP            VENDOR APP (restaurant / homemaker / shop)        PARTNER APP
 browse, order, pay      register, menu, open/close, accept, ready         register, online, accept, pick up, deliver, COD
      │                              │                                              │
      │  app backends call the Integration API (server-to-server, HMAC-signed)       │
      ▼                              ▼                                              ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 │                       ZOAURO CORE  (apps/api  +  PostgreSQL)                              │
 │  Integration API (inbound)  →  validate → idempotency → zone resolve → state machine       │
 │                                  → write DB + audit + outbox event (one transaction)       │
 │  Outbox worker  →  signed webhooks / event feed (outbound)  →  apps                         │
 │  Socket.IO      →  admin browsers, per zone and per permission                              │
 └───────────────▲───────────────────────────────────────────────────────▲───────────────────┘
                 │ operate, verify, cancel, assign, refund                │ live updates, KPIs
         SUPER ADMIN panel  ◄───────── grants access per member per zone ─────────►  ZONAL ADMIN panel
```
Rules that follow from the picture:
1. **Push, not pull.** Apps send each event to the Integration API the moment it happens. The admin panel never scrapes the apps. Admins see new data within seconds (Socket.IO) and can reload any list at any time.
2. **The admin Core is the record of truth for the shared business objects after they arrive** (orders and their status, vendors, partners, customers, payments, refunds, payouts, zones). Apps keep their own end-user data (login, device tokens, carts, favourites) that the admin panel does not need.
3. **Admin decisions go back out** as signed events (suspend a vendor, cancel an order, assign a partner, refund processed). Apps must obey them (doc 43 §4).
4. **Each field has one owner** so the two sides never fight over a value (doc 44).
5. **An app can be down without losing data.** Apps retry with the same Idempotency-Key; the Core replays its own events through a pull feed (doc 43 §3).

## 2. What each app sends, and what the admin panel does with it
| App | Sends (inbound) | Appears in the admin panel as | Admin controls (outbound) |
|---|---|---|---|
| **Customer app** | Customer sign-up and profile, saved addresses, **orders**, payment attempts, customer cancel requests, (P2: reviews, support tickets) | Customers list/detail, Orders (new order alert), Payments, Dashboard counters | Block/unblock customer, cancel order, refunds, delivery charge and zone availability, broadcast notifications |
| **Vendor app** (restaurant, homemaker, shop) | Self-registration with documents, profile and hours, open/closed toggle, **menu items and stock**, accept/reject/preparing/ready, prep time | Restaurants/Homemakers (Pending verification badge), Menu, order progress | Verify/reject, activate/suspend, commission, disable a menu item, move zone (Super Admin), accept on vendor's behalf |
| **Delivery-partner app** | Self-registration with documents, online/offline, last location, assignment accept/reject, picked up, delivered, COD collected, cash handed over | Delivery Partners (Pending verification), order timeline, cash-in-hand | Verify/reject, suspend, force offline, assign/reassign to an order, confirm cash settlement |

## 3. End-to-end flows
### F1 Vendor joins the platform
1. Vendor app → `POST /vendors` (details, pincode/lat-lng, documents via pre-signed upload).
2. Core resolves the **zone** from the pincode ranges. Found → vendor created in that zone, `verification_status=PENDING`. Not found → created with no zone, visible only to Super Admin in **Pending registrations → Needs a zone** (doc 45).
3. Admin panel: the zone's members with `restaurants:view` see it with a Pending badge; the dashboard "Pending verification" KPI rises; Socket.IO alert. A member with `restaurants:status` verifies or rejects (note required).
4. Core emits `vendor.verified`/`vendor.rejected` → Vendor app unlocks go-live or shows the reason. Super Admin sets commission (`vendor.updated`).
5. Vendor adds menu items from the app (`PUT /menu-items/{id}`); they appear in Menu immediately. Vendor toggles open/closed.

### F2 Order life (customer → vendor → partner → customer)
1. Customer app → `POST /orders` (items, address, totals, payment method). Core re-validates prices against the menu, checks the delivery address lies in the vendor's zone, stores the order as `PLACED`.
2. Online payment: the customer app asks the Core for a payment attempt, pays at the gateway, the **gateway webhook goes straight to the Core** (signed, doc 16). The order becomes visible to the vendor and zone team when payment is `PAID` (COD is visible at once). Unpaid online orders expire after 15 minutes (D52).
3. Vendor app → accept / reject / preparing / ready. No answer in 5 minutes → Core auto-cancels (and refunds if paid). A member can also accept on the vendor's behalf.
4. Assignment: auto-offer or a zone member assigns a verified, online partner **of the same zone**. Core emits `order.assigned` to the partner app. Partner accepts (event) or rejects (order returns to READY).
5. Partner app → picked up → delivered (COD: collected amount). Core updates status, history, ledger, cash-in-hand.
6. Every transition emits `order.status_changed` to all three apps and to admin browsers of the order's zone. Invalid or out-of-order events get `409` with the current state so the app can resync.

### F3 Admin intervenes
Cancel, reassign, refund, block a customer, suspend a vendor or partner, disable a menu item: the action runs inside the Core (permission + zone checked), is audited, and an outbound event tells the affected apps. Apps must show the new state and stop offering the blocked action.

### F4 Partner cash
Partner collects COD (event) → cash-in-hand grows → partner app reports a hand-over (`cash-handover`, pending) → a zone member with `settlements:edit` confirms the amount; variance is flagged → `settlement.confirmed` goes back to the partner app.

### F5 Broadcast
Super Admin composes a notification (zone, audience, channel) → Core emits `broadcast.created` → each app delivers the push/SMS to its own users (the Core does not hold device tokens).

## 4. Two integration modes (decision D18)
| Mode | When | What changes |
|---|---|---|
| **A — Integration API (default in this pack)** | The apps have backends that can call this system, or their backends will be pointed at it | Everything in docs 42–45 as written. App teams implement the contract |
| **B — Adapter to an existing backend** | The apps already run on a backend with its own database that must stay the source of truth | Docs 42–43 become the *internal* contract of an adapter service that reads the existing backend (events, change feed, or scheduled sync) and calls the same Integration API. Admin-side modules are unchanged. Adds about 3 dev-weeks (adapter + backfill + reconciliation) |

**Decision needed from you (D18, now blocking):** do the three apps already exist, and do they have a backend? This pack can be built either way, but I cannot see the apps. Everything on the app side (field names, payloads) is a proposal that the three app teams must review (doc 48 contract workshop).

## 5. What is deliberately out of scope
- End-user login for customers, vendors and partners (OTP, JWT, device sessions). That belongs to the app backends. The Core trusts the *app backend* (signed), not the end user's phone. Embedding the signing secret inside a mobile app is forbidden (doc 13 T23).
- Push-notification delivery, maps/routing, live ride tracking, ratings engine, dispatch optimisation. The Core stores partner last-known location and emits events; auto-dispatch beyond "nearest eligible online partner in the zone" is a later decision.
- Building the three apps. If they do not exist yet, this panel cannot show data until someone builds them or the simulators (doc 48) feed it. That is the schedule risk D18 already named.
