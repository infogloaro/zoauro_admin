# 03 — Business Rules and Decision Register (v2.0)

Status key: **Decided** (owner said so) · **Changed** (earlier decision reversed, see doc 32) · **Assumed** (default chosen so work can start; owner must confirm) · **Open** (blocks a named phase).
Naming: product brand in UI = **ZOAURO** (logo in Figma); company/platform = **GloAro**. See D21.

## 1. Decision register

### 1.1 Carried over from v1.0
| ID | Decision | Status | Impact |
|---|---|---|---|
| D1 | Homemaker is a separate entity from Restaurant, with own pages | **Decided** | Separate tables, routes, forms. Orders and menu items belong to exactly one vendor of either type |
| D2 | Zonal Admin has full control (view, add, edit, soft-delete, status) over restaurants, homemakers, delivery partners, customers, orders **inside the zones assigned to them**. Settings stay Super Admin only | **Decided** | Defaults seeded in the permission matrix; Super Admin can restrict per role (see D29) |
| D3 | ~~One Zonal Admin handles one zone~~ **One Zonal Admin handles one OR MANY zones, and one zone is handled by one OR MANY Zonal Admins** | **Changed** (was Decided in v1.0) | Reversal. `admin_zone_assignments` becomes the live source of scope; the "one zone" app rule is deleted. Full spec: doc 36 |
| D4 | Zonal Admin controls payments view and refunds within their zones | **Decided** | Refund limit guardrail (R-REF-3). Needs a Payments entry or order-detail panel in the zonal design (D36) |
| D5 | Auth provider | **Changed** — was Assumed Auth.js | Auth.js is a Next.js library and does not fit the Express API (D16). Replaced by in-house session auth in the API (doc 14), same pattern family as the GloAro CRM |
| D6 | Payment gateway | **Decided 2026-10-14 (owner): Razorpay** | Online payments through Razorpay behind PaymentProvider; COD and wallet stay separate (roadmap R14) |
| D7 | More than one Zonal Admin per zone | **Decided** (was Open) | Needed by D3. Schema already allowed it. Zone Management shows an admin stack, not one name |
| D8 | Refund cost bearer | **Assumed**: platform bears customer-service refunds; vendor bears quality/vendor-fault refunds | Settlement |
| D9 | Delivery assignment | **Assumed**: manual by Zonal/Super Admin; auto-assign later | Docs 05, 10 |
| D10 | Zonal Admin may edit commission | **Assumed**: no, view only | Permissions |
| D11 | Cancellation windows | **Assumed**: R-ORD-3 | Orders |
| D12 | Minimum order and delivery charge scope | **Assumed**: zone default, vendor override | Pricing |
| D13 | Zonal refund limit | **Changed 2026-10-14 (owner): dynamic per zone** | Super Admin sets refund limits per zone (and per member on the assignment, D20); INR 1,000 / 5,000 stay as defaults until changed. Management confirmation of the values pending |
| D14 | Customers shared across zones | **Assumed** yes; visibility rule in D25 | Schema |
| D15 | Offers, Notifications not in Zonal sidebar | **Assumed** (matches Figma) | Docs 18, 20 |

### 1.2 New in v1.1 — alignment with your CRM stack and the designs
| ID | Decision | Status | Impact |
|---|---|---|---|
| D16 | **Stack = GloAro CRM stack**: Next.js App Router frontend + Node.js/Express modular-monolith API, PostgreSQL + Prisma, Redis + BullMQ, Socket.IO, S3-compatible storage, shadcn/ui, TanStack Query, Zod, Docker + Nginx (+PM2). v1.0's "Next.js route handlers + Auth.js + ECS/Terraform" is dropped | **Assumed — confirm** | Docs 06, 07, 09, 12, 14, 23, 29. Your CRM rule is that the stack is not changed without permission, so this is the safe reading |
| D17 | Zoauro admin is a **separate repo and separate PostgreSQL database** from the CRM/ERP, sharing conventions and (if code is shareable) UI kit and auth patterns | **Assumed — confirm** | Different data class (payments, customer PII), different release cadence |
| D18 | **Is there an existing Zoauro backend / customer app / vendor app / partner app?** The designer PDF says "the existing operational flow is retained". This pack assumes **greenfield**: this project builds the API and DB, and exposes an Order Intake API for the other apps (doc 09 §Intake). If a backend already exists, SA-0 changes from "build" to "integrate" | **Decided 2026-10-14 (owner): greenfield** | Everything is new: this project builds the API, the database and the admin panel; the apps integrate through the intake API |
| D19 | Zone scope selector: default **"All my zones"**, switchable to one zone; scope lives in URL `?zone=` and is validated server-side | **Assumed** | Doc 36 |
| D20 | ~~Refund daily limit per admin across zones~~ **Refund limits are set per member per zone** (per-refund amount and daily amount on the assignment, profile gives the default) | **Changed in v1.2** (was Assumed in v1.1) | Docs 16, 04, 08. Total exposure = sum of the caps Super Admin sets, visible in the Access editor |
| D21 | UI brand **ZOAURO**; company **GloAro**; zone page subtitle "GloAro Mart" in Figma to be corrected by designer | **Assumed** | Copy, logos |
| D22 | Vendor **verification** (Verified/Pending/Rejected) is separate from vendor **status** (Active/Inactive/Pending/Suspended) — matches Figma columns | **Assumed** | Docs 08, 10 |
| D23 | Figma Restaurants page has tabs "Hotels" and "Restaurants Revenue". **Hotels = out of scope** unless confirmed; revenue tab = vendor Finance tab | **Assumed** | Avoids a third vendor type |
| D24 | Payment methods: ONLINE (UPI/Card as sub-method), COD, **WALLET** (shown in Figma). Wallet top-up is owned by the customer app; this panel records wallet payments and can refund to wallet | **Assumed** | Doc 08, 16 |
| D25 | A Zonal Admin sees a customer if the customer has an address or an order in an in-scope zone. Orders, total spent, order count are **scope-filtered** | **Assumed** | Docs 04, 08 |
| D26 | Phones and emails are **masked in lists** (doc 15) with audited click-to-reveal on detail. Figma lists show full numbers; designer to update | **Assumed** | Zonal admins call partners often: reveal must be one click |
| D27 | Super Admin: Homemakers is a tab beside Restaurants (Figma). Separate routes and tables still apply (D1) | **Assumed** | Doc 18 |
| D28 | "Add Customer" exists in Figma. Admin-created customers are flagged `source=ADMIN`; phone must be unique; no login credentials created | **Assumed** | Docs 08, 22 |
| D29 | Permission matrix gets a 5th column **Status** (approve/suspend/activate) beyond Figma's View/Add/Edit/Delete | **Assumed** — designer to add | Docs 04, 20 |
| D30 | Figma login-activity shows "Admin", "Support Staff", "Finance Staff". ~~Custom roles P1~~ Two identity roles (Super Admin, Zonal Admin) plus **Access Profiles as P0** (D41) | **Changed in v1.2** | Doc 04 |
| D31 | Hosting starts simple: one AWS host running Docker Compose + Nginx, RDS PostgreSQL, S3. ECS/Terraform/Multi-AZ/WAF are phase-2 hosting upgrades after the pilot | **Assumed** — pushes back on v1.0 doc 06/27 F0-6 | Scale: 50 admins, ~100k orders/month ≈ 2–3 orders/min average |
| D32 | Header global search ("Search orders, customers, restaurants…") is **P1** and must be scope-filtered like every list | **Assumed** | Leakage risk, doc 13 |
| D33 | Header theme toggle (sun icon) is **P2**; v1 is light only | **Assumed** | |
| D34 | Dashboard "Platform Health" card shows only DB-derived values (pending verifications, active sessions). No uptime figure in v1 | **Assumed** | Avoids new monitoring dependency |
| D35 | Zone adds **State** and status **UPCOMING** (both in Figma, absent from PDF) | **Assumed** | Docs 08, 22 |
| D36 | Zonal sidebar gets **Payments** (refund queue, COD settlement). Not in Figma sidebar — designer must add, or refunds stay inside Order Details only | **Decided 2026-10-14 (owner): yes** | Zonal Admins see Payments (refund queue, COD settlement) in their own zones, only as granted by the Super Admin |
| D37 | Account lock default **30 min** (Figma) instead of 15; all auth numbers live in Settings | **Assumed** | Doc 14 |
| D38 | "Area" (e.g. RS Puram) is a **text locality** on vendors, partners, customer addresses, used for filters and the area chart. Not a separate master table in v1 | **Assumed** | Docs 08, 22 |
| D39 | UI label "Pending" on orders = status `PLACED` | **Decided by mapping** | Docs 10, 20 |
| D40 | Order status `REFUNDED` is used only when the full captured amount is refunded; partial refunds keep the order status and set `payment_status = PARTIALLY_REFUNDED` | **Assumed** | Doc 10 |

### 1.3 New in v1.2 — Super Admin hierarchy and access control, Figma file review
| ID | Decision | Status | Impact |
|---|---|---|---|
| D41 | **Access model**: Super Admin is superior and the only actor who grants access. Access is granted **per member per zone** through an **Access Profile** (template) + optional per-module **overrides** (grant/deny, deny wins) + **limits**. Super Admin manages it in a new **Access Control panel** (Zone Teams, Zonal Admins, Access Profiles, Member Access editor, Access Preview). This replaces v1.1's single role matrix for all Zonal Admins | **Decided by request** (your message); granularity per zone **Assumed — confirm** | Docs 04, 08, 09, 14, 18, 20, 22, 36, SA-1.7–1.11. No screen exists in Figma for this (D47) |
| D42 | "Login with Google" on the Figma login card is **not in v1** | **Assumed** | Doc 14 |
| D43 | Figma Settings > User Management is a directory of all platform users (admins, restaurants, customers, partners, with registration trend). v1 builds the **Admins** tab as the real control (links to Zonal Admins/Access Control) and shows the other tabs as read-only links to their own modules, not duplicate tables | **Assumed** | Avoids a second copy of four lists |
| D44 | Figma Payments has **Delivery Partner Payouts** and Restaurant Payouts tabs. Payouts cover RESTAURANT, HOMEMAKER and DELIVERY_PARTNER payees | **Assumed** (was vendor-only in v1.0/1.1) | Docs 08, 16 |
| D45 | Figma Home Makers adds **food category**, **experience**, **availability** and rating filters, and a "Top Cities" widget. Homemaker gets `food_category`, `experience_years`, `is_available` | **Assumed** | Doc 08, 22 |
| D46 | Login role tabs (Super Admin / Zonal Admin) are kept as in Figma; server validates (doc 14 §3). Supersedes doc 18 note that skipped Role Selection | **Decided by design** | Docs 14, 18 |
| D47 | Frames missing from Figma and needed for build: Zonal Admins list + Add/Edit, **Zone Teams, Access Profiles, Member Access editor, Access Preview**, Roles & Permissions, Add/Edit Zone, Order Details, Restaurant/Homemaker detail, Zonal Payments | **Decided 2026-10-14 (owner)** | Until the designers deliver the frames, the team designs them in the current ZOAURO theme |
| D48 | Login footer text "Gocart" is a template leftover | **Assumed** copy bug | Doc 37 |
| D49 | Exact team: 3 developers. Allocation in doc 40 | **Decided by request** | Doc 40 |

### 1.4 New in v2.0 — data comes from the customer, vendor and partner apps
| # | Decision | Status | Where |
|---|---|---|---|
| D50 | Integration model: the three apps **push** events to this system's Integration API (server-to-server); this system never polls them. After arrival, the Core is the record of truth for orders, vendors, partners, customers, payments and zones. Admin decisions go back as signed webhooks plus a pull feed | **Decided by request**, details Assumed | Docs 41–43 |
| D51 | App-client authentication is **HMAC-signed requests** (key id, timestamp, signature, idempotency key), replacing the v1.1 "Bearer token" idea. Secrets stored encrypted (needed to verify), rotated with 24 h overlap | **Changed** (was Assumed in doc 09) | Docs 42, 14, 08 |
| D52 | Online-payment orders become visible to vendor and ops only when payment is PAID (COD immediately); unpaid online orders auto-cancel after 15 minutes (`PAYMENT_TIMEOUT`) | **Assumed — confirm** | Docs 42, 10, 16 |
| D53 | Vendors and partners that self-register get their zone from the pincode ranges. No match → they stay **unzoned** (Super Admin only) until assigned. This refines R-VEN-3 | **Assumed** | Docs 42, 45 |
| D54 | "Shop" vendor type from the vendor app is stored as a restaurant record with `kind=SHOP` until the designer supplies shop screens | **Decided 2026-10-14 (owner): yes** | Shops are restaurant records with kind=SHOP until shop screens exist |
| D55 | One writer per field; where both sides need influence there are two fields (e.g. `is_open` by vendor, `status` by admin). Locked fields (status, verification, commission, zone, admin_disabled) can never be written by apps | **Decided (design)** | Doc 44 |
| D56 | Event delivery is at-least-once with signed webhooks, retries up to 24 h, dead-letter with manual retry, and a 14-day pull feed. Receivers must be idempotent | **Decided (design)** | Doc 43 |
| D57 | Integration Hub (clients, webhooks, event monitor, kill switch) is Super Admin only and not grantable to Zonal Admin; zone members get the pending-registrations inbox and "source" labels through their normal view permissions | **Decided (design)** | Doc 45 |
| D58 | Timeline: integration adds about 7.5 dev-weeks; total about 69 dev-weeks, **about 26 weeks (13 sprints) with 3 developers**; +1 week if Mode B (adapter) | **Estimate** | Doc 40 |
| D59 | `audit_logs` records admin and system decisions, master-data changes by apps, and sensitive reads; it does **not** copy high-volume app event streams (order steps, location, stock toggles), which live in domain history and the integration log | **Decided (design)** | Doc 50 |
| D60 | Audit retention: one table for 3 years, monthly S3 archive, delete only after a verified archive (replaces "hot 12 months then archive" of doc 15) | **Assumed** | Docs 50, 15 |
| D61 | Audit failure fails the business transaction (fail closed); reveals and exports return no data if they cannot be audited | **Decided (design)** | Doc 50 |
| D62 | DENIED outcomes are recorded only for a short list, rate limited to 1 per minute per actor and action | **Assumed** | Doc 50 §4.3 |
| D63 | Audit rows about a customer carry the zone in which the action happened (or the zone of the customer's latest order/address for Super Admin edits); rows with no zone are visible to Super Admin only | **Assumed** | Doc 50 §4.0. Needs owner confirmation before the customers module |
| D64 | Audit retention deletes run as a separate database role (`zoauro_purge`) with its own connection string, never as the application role | **Decided (design)** | Doc 50 §3.2, doc 12 |
| D65 | 2-step verification methods: authenticator app (TOTP), email OTP, SMS OTP, backup codes; allowed methods set per role in policy | **Decided** (owner request 2026-10-12) | Doc 52 |
| D66 | Every admin (Super Admin included) chooses ONE 2-step method at sign-in from the allowed list: authenticator, email OTP, or SMS OTP once SMS is switched on; one successful method is enough. Default allowed for both roles: authenticator + email OTP. Super Admin can narrow it in Settings > Security. Risk accepted: SMS and email are only as strong as SIM and mailbox | **Decided 2026-10-14 (owner)**; was Assumed "Super Admin authenticator only" | Doc 52 §1, §5; doc 32 |
| D67 | SMS OTP is built in v1 behind a provider interface and **off by default**; cannot be switched on without a real provider and a registered DLT template. **Supersedes** doc 14 §2 ("kept off") and TD-17 for SMS OTP | **Decided** | Doc 52 §6, doc 32 |
| D68 | SMS provider and DLT registration (entity, sender ID, template) | **Decided 2026-10-14 (owner): MSG91 default, configurable** | SMS (and WhatsApp later) provider is a Super Admin setting; MSG91 is the default adapter; DLT entity/template still to register |
| D69 | Login is two-step: no session cookie until the second step is passed; pending state in cookie `zo_mfa` (5 min) | **Decided (design)** | Doc 52 §2.1 |
| D70 | TOTP SHA-1/6 digits/30 s, ±1 step, replay guard; secret AES-256-GCM with key id | **Decided (design)** | Doc 52 §2.2 |
| D71 | 10 single-use backup codes, stored HMAC-hashed | **Decided (design)** | Doc 52 §2.2 |
| D72 | OTPs go only to the verified email/phone on the account record; first enrolment starts with a mailbox check | **Decided (design)** | Doc 52 §2.3 |
| D73 | 2-step required for both roles by default; per-role switch (Super Admin cannot be switched off) | **Assumed** | Doc 52 §5 |
| D74 | Re-auth levels: `PASSWORD` (doc 14 list) and `STRONG` (password + code) for 2-step changes, 2-step reset and security policy | **Decided (design)** | Doc 52 §2.4 |
| D75 | At least two active Super Admins at launch; recovery by another Super Admin, last resort audited CLI | **Assumed** | Doc 52 §2.5 |
| D76 | Password reset never bypasses or removes 2-step | **Decided** | Doc 52 §2.1 |
| D77 | Wrong second-step codes count toward the lockout of D37 | **Decided** | Doc 52 §2.1 |
| D78 | Password denylist is local (no online breach-check API) | **Assumed** | Doc 52 §1.2 |
| D79 | Remember me = 7 days absolute, 8 h idle | **Assumed** | Doc 52 §2.6 |
| D80 | Add `qrcode` (web) now and `libphonenumber-js` when SMS ships | **Assumed** | Doc 52 §7 |
| D81 | Zone `code`: 2–6 chars A–Z/0–9, unique, immutable | **Assumed** | Doc 53 §3 |
| D82 | A pincode belongs to at most one zone (DB unique index); inactive zones keep theirs until removed | **Assumed** | Doc 53 §2.6 |
| D83 | Serviceability by pincode only in v1; polygons/PostGIS after the pilot; lat/lng accepted but unused | **Assumed** | Doc 53 §2.3 |
| D84 | Registrations in an UPCOMING zone are accepted into it and wait | **Assumed** | Doc 53 §2.1 |
| D85 | Deactivation stops new intake only; open orders finish; no cascade writes; members may act on open orders | **Assumed** | Doc 53 §2.6 |
| D86 | Zone delivery charge ceiling ₹1 000 | **Assumed** | Doc 53 §2.6 |
| D87 | Resolve returns `NONE` for closed zones; `zone.updated` gets `pincodeCount` (needs the app teams) | **Assumed** | Doc 53 §2.5 |
| D88 | Order-number prefix: `GA-<zonecode>-<seq>` (R-ORD-1) or `ZO-<seq>` (intake example) | **Decided 2026-10-14 (owner): configurable** | Order-number format is a Super Admin setting; default ZO-<zonecode>-<seq> |
| D89 | Zone name editable, code not | **Assumed** | Doc 53 |
| D90 | No scheduled zone activation | **Assumed** | Doc 53 |
| D91 | Hotel Room Booking is a new module in Phase 1 | **Decided 2026-10-14 (owner)** | Scope and screens to be designed (roadmap); not in doc 39 yet |
| D92 | Per-zone service switches (Restaurants, Home Food, Hotel Booking, …) controlled by the Super Admin only | **Decided 2026-10-14 (owner)** | A Super Admin control panel allocates services and Zonal Admin permissions per zone; every change audited |
| D93 | Support tickets: Zonal Admins handle their own zones (View and Edit) when granted | **Decided 2026-10-14 (owner)** | Changes D15 for support: the `support` module becomes grantable (doc 04 update) |
| D94 | Notifications: Zonal Admins may send to their zones when granted; promotions need Super Admin approval | **Decided 2026-10-14 (owner)** | Plain offer/news messages and in-app promotion of products and shops allowed in Phase 1 under that approval |
| D95 | Refund approvals: within each member's limits; two approvers above INR 10,000 (value configurable) | **Decided 2026-10-14 (owner)** | Roadmap R15 |
| D96 | Refund rules (eligibility, windows, cost bearer) are Super Admin settings, built dynamically | **Decided 2026-10-14 (owner)** | Values need management confirmation; no hard-coded policy |
| D97 | Onboarding documents are configurable by the Super Admin; mandatory by default: restaurants FSSAI, GST, PAN, bank details; partners licence, RC, ID, bank details | **Decided 2026-10-14 (owner)** | Roadmap R01, R12 |
| D98 | Support SLAs are configurable with dynamic assignment; defaults: first reply 2 h, resolve 24 h, escalate at 12 h, reopen within 7 days | **Decided 2026-10-14 (owner)** | Roadmap R18 |
| D99 | Launch channels: in-app and email first; SMS and WhatsApp after D68 is in place | **Decided 2026-10-14 (owner)** | Roadmap R25 |
| D100 | Notification timing is configurable; defaults: no quiet hours for order updates, promotions only 09:00–21:00 IST | **Decided 2026-10-14 (owner)** | |
| D101 | Phase 2 loyalty values have no defaults: every value is a Super Admin setting | **Decided 2026-10-14 (owner)** | Roadmap R22, R23 |
| D102 | M03 member rules: statuses ACTIVE/SUSPENDED (suspend revokes sessions); delete = soft delete that ends assignments and sessions (never a Super Admin or oneself); removing the last zone keeps the session (no-zones page) | **Decided 2026-10-14 (owner, approved defaults 1–3)** | |
| D103 | M03 credentials: reset = temporary password + forced change + all sessions end + email without the password (PASSWORD re-auth); no password is ever emailed on creation; zones are assigned on the access screen, not the create form | **Decided 2026-10-14 (owner, approved defaults 4–6)** | |
| D104 | M03 access writes: assignments updated in place (daily refund usage kept), removed zones end their assignment, overrides replaced; profile edit writes one PROFILE_EDITED row per affected member; reveal/export changes are LIMIT_SET | **Decided 2026-10-14 (owner, approved defaults 7–8)** | |
| D105 | Permission actions stay View/Add/Edit/Delete/Status; reveal and export are flags; refunds:create = refunds:add; refund approval Super Admin only (until D95 dual approval) | **Decided 2026-10-14 (owner, approved default 9)** | |
| D106 | Empty refund limit = INR 0 (approval needed); maximum INR 1,00,000 per refund and per day | **Decided 2026-10-14 (owner, approved default 10)** | Configurable per zone (D13) |
| D107 | Access changes take effect on the next request (cache cleared, admin.zones_changed event); re-auth PASSWORD for access, profile, team, reset-password, revoke-sessions; PASSWORD+STRONG for an email change | **Decided 2026-10-14 (owner, approved defaults 11–12)** | |
| D108 | Assignable zones: ACTIVE or UPCOMING, Zonal Admins only; never-grantable permissions refused (422); profile delete blocked while in use; profile names unique ignoring case; access preview shows effective permissions, limits and visible screens | **Decided 2026-10-14 (owner, approved defaults 13–16)** | |
| D18 (refined) | Still **open and blocking**: do the apps exist and have backends? Mode A (apps call this Integration API, default) vs Mode B (adapter to an existing backend). I cannot see the apps; app teams must review the contract | **Open — blocks IH-1** | Doc 41 §4 |

Every change to a decision is appended to doc 32.

## 2. Business rules

### Orders
- R-ORD-1 Order numbers are human-readable and unique: `GA-<zonecode>-<sequence>`.
- R-ORD-2 Status moves forward only: Placed → Accepted → Preparing → Ready → Assigned → Out for Delivery → Delivered; Cancelled and Refunded are side branches.
- R-ORD-3 Cancellation: customer until Accepted; vendor until Preparing (reason required); Zonal Admin and Super Admin until Out for Delivery (reason required); after that only admins with a refund decision.
- R-ORD-4 Vendor acceptance timeout default 5 minutes, then auto-cancel and refund if paid.
- R-ORD-5 An order belongs to one zone, taken from the vendor at placement, never changed (even if the vendor later moves zone).
- R-ORD-6 An order has exactly one vendor (restaurant or homemaker).

### Pricing, tax, commission
- R-PRC-1 Money is integer paise. Display uses Indian grouping (`₹12,48,320`).
- R-PRC-2 GST rate configurable; tax amount stored on the order at placement.
- R-PRC-3 Commission percent per vendor with platform default; stored on the order at placement. Changes apply to future orders only.
- R-PRC-4 Delivery charge defaults to zone value; minimum order value per zone and per vendor.

### Payments and refunds
- R-PAY-1 Methods: online, COD, wallet (D24).
- R-PAY-2 Online payment is confirmed only by a verified signed webhook.
- R-PAY-3 COD is marked paid when the partner confirms collection; amount joins partner cash settlement.
- R-REF-1 Refund types: full, partial, goodwill; reason code required.
- R-REF-2 Total refunds never exceed captured amount.
- R-REF-3 A member's refund limits come from their assignment for the order's zone (D20); above the per-refund or daily limit, or with no limit granted, the request goes to the Super Admin approval queue. Requester never approves own.
- R-REF-4 Every refund writes an immutable ledger entry.
- R-REF-5 COD refunds are recorded as manual or wallet credit.

### Vendors
- R-VEN-1 Status: Pending, Active, Inactive, Suspended. Verification: Pending, Verified, Rejected (D22). New vendors start Pending/Pending. Only Verified vendors can become Active.
- R-VEN-2 Only Active vendors are visible to customers; suspension blocks new orders but open orders continue.
- R-VEN-3 A vendor belongs to exactly one zone (v2.0: except a self-registered vendor/partner whose pincode matched no zone stays unzoned and Super-Admin-only until assigned, D53). Moving a vendor to another zone is **Super Admin only** and does not change old orders.
- R-VEN-4 Vendors with order history are soft deleted only.

### Delivery partners
- R-DEL-1 Verified partners only receive assignments.
- R-DEL-2 One zone per partner (unchanged by multi-zone admins); concurrent order cap configurable. An order can only be assigned to a partner of the order's zone.

### Accounts and multi-zone scope
- R-ACC-1 Zonal Admins cannot create admins and cannot see or change any member's access, including their own.
- R-ACC-2 All writes are audited. R-ACC-3 Deletes are soft; permanent purge is Super Admin only.
- R-ACC-4 A Zonal Admin may be assigned 1..N zones; a zone's team may have 0..N members. A zone with no member is allowed and flagged on the Super Admin dashboard.
- R-ACC-7 Access is per member per zone (profile + overrides + limits). Deny overrides win. Effective access is previewable by Super Admin without logging in as the member.
- R-ACC-8 Every access change needs re-authentication, is audited with before/after, applies on the next request, and notifies the member by email.
- R-ACC-9 Several members acting on one order is allowed; conflicts are resolved by the order `version` check (second actor gets 409). Every action records the acting member.
- R-ACC-5 Effective scope of any request = requested zones ∩ assigned zones. Anything outside returns 404. Assignment changes take effect on the next request.
- R-ACC-6 Creating a vendor, partner or customer address as a Zonal Admin with several zones requires choosing one of their assigned zones; there is no default zone.
