# 60 — Admin Workflow Map and Change Requests

Version 1.2, 2026-10-20 (§8 adds the owner decisions D143–D166; §10 adds the new modules of D179 with the defaults the owner accepted, D182). Owner: docs lane. Visual version with flowcharts and per-screen wireframes: [`60_Admin_Workflow_Map.html`](60_Admin_Workflow_Map.html) (open in a browser; diagrams load from the internet).

This document records the change requests the owner raised on 2026-10-17, the end-to-end workflows they affect, and a check of the admin pages built so far against docs 18, 20, 21, 37 and 45. Items marked **Proposal** or **Needs decision** are not decided. Nothing here overrides doc 03; each proposal needs a D-number there before code changes.

## 1. Change requests (2026-10-17)

| # | Request | State today | What this document adds |
|---|---|---|---|
| CR-1 | Vendor onboarding as a request: the vendor raises a request, Super Admin or Zonal Admin verifies, then accepts or rejects. Covers restaurants, shops and Home Food (a cloud kitchen is a Home Food vendor, owner 2026-10-18) | Vendor list has a Pending verification tab; vendor detail can accept or reject documents, verify or reject the vendor, activate it. No request queue, no "more information" step, intake API empty | Flow W4 (§2), stages (§2.2), screen spec (§2.3), decisions needed (§6) |
| CR-2 | Adding a Zonal Admin and controlling their access | Built across separate pages (create dialog, member access editor, zone teams, profiles, history, access requests) | Guided five-step flow W1b (§3) and the gaps found (§3.2) |
| CR-3 | Onboarding is missing from the navigation | "Requests & approvals" group exists, but its onboarding entries open "Coming soon"; no Home Food onboarding entry; no Needs-a-zone view | Navigation fixes (§4) |
| CR-4 | Check the pages already built | — | Built-page check (§5) |

## 2. Vendor onboarding request (W4)

### 2.1 Flow
1. The vendor submits an onboarding request from the vendor app: type, business details, address, documents (`POST /intake/vendors`, doc 42). Or an admin adds the vendor for them; a zone is required.
2. The Core resolves the zone from the pincode (D53).
   - No zone matches: the request goes to **Needs a zone**, visible to the Super Admin only. The Super Admin assigns a zone (the zone team is notified) or rejects it as not serviceable.
   - A zone matches: the request is **Submitted** in that zone's Vendor onboarding queue. Age turns amber after 24 h and red after 48 h (doc 45 §1.2).
3. A reviewer opens it (**Under review**): a Super Admin, or a Zonal Admin with `restaurants:status` / `homemakers:status` in that zone.
4. The reviewer checks each document from the D97 checklist (restaurants: FSSAI, GST, PAN, bank; Home Food: not configured, D113) and accepts it, or rejects it with a note.
5. Decision:
   - Something missing: **More info required**, with a message to the vendor app; the vendor fixes and resubmits, and the request returns to Under review. *(Needs decision, §6.)*
   - Reject with a reason: **Rejected**; the vendor is told why and may apply again.
   - Approve: **Approved**; verification becomes VERIFIED.
6. The Super Admin sets the commission (D10); opening hours are checked.
7. Activate: status ACTIVE (only when verified); the vendor becomes visible in the customer app (`vendor.status_changed`).
8. The vendor adds menu items; name, price and similar changes go to Food item requests (R09).

Every decision asks for the password and writes an audit entry. Suspend blocks new orders; open orders finish.

### 2.2 Stages
`SUBMITTED → UNDER_REVIEW → (MORE_INFO_REQUIRED → UNDER_REVIEW)* → APPROVED | REJECTED`; `REJECTED → SUBMITTED` when the vendor applies again.

The database today stores only `verificationStatus` (PENDING, VERIFIED, REJECTED) and `status` (PENDING, ACTIVE, INACTIVE, SUSPENDED). Submitted and Under review can be shown from those fields. More info required needs a new field or status.

### 2.3 Screen: Vendor onboarding requests
- Route: `/super-admin/registrations` and `/zone/registrations` (doc 18, doc 45 §1.2). The current menu slug is `restaurant-requests`.
- Header: title with the waiting count; "Add vendor" button.
- Tabs by type: Restaurants · Shops · Home Food (includes cloud kitchens) · Needs a zone (Super Admin only).
- Stage tabs: Submitted · Under review · More info · Decided.
- Filters: search, zone, source app, age.
- Table: applicant, type, zone, submitted, age, documents checked (for example 3/4).
- Right panel: submitted data, address with a map link, documents with preview and accept/reject, source app and time.
- Actions: Approve, Reject (reason), Ask for more info (message; proposal), Assign zone (Needs a zone only).
- Zonal Admin: only assigned zones and only vendor types they can view; no Needs-a-zone tab.

### 2.4 Built today vs missing
| Built | Missing |
|---|---|
| Admin adds restaurant or shop (Home Food separately); new vendor starts Pending and Not verified | Intake API (`apps/api/src/modules/intake/` is empty), so vendors cannot apply from the app (IH-2) |
| Restaurants and Home Food lists: tabs All, Pending verification, Active, Inactive, Suspended, Rejected | Onboarding queue screen (R01, IH-9) |
| Vendor detail: checklist from `onboarding.documents`, upload, view, accept or reject each document | "Ask for more info" action and stage |
| Verify, reject (note required), activate (only if verified), deactivate, suspend; each with password | Request timeline on the vendor page |
| Super Admin moves a vendor into a zone; API lists unzoned vendors (`assignment=UNASSIGNED`) | Needs-a-zone tab or filter in the web |
| | Home Food document list: defaults in use until the Super Admin sets it in the Control Panel (D145) |

## 3. Add a Zonal Admin and control access (W1b)

### 3.1 Proposed guided flow
1. **Details:** name, email, mobile, temporary password (Generate).
2. **Zones:** pick one or more Active or Upcoming zones.
3. **Access per zone:** access profile, grant/deny overrides (deny wins), per-refund and daily refund limits (capped by the zone, D110), reveal and export.
4. **Preview the draft:** sidebar, dashboard tiles and permissions per zone, before saving.
5. **Review and save:** diff, password; then audit, access history, email to the member; first sign-in forces a password change.

Later: edit access, suspend, reset password or 2-step, sign out everywhere, remove a zone (last zone removed → `/zone/no-zones`). Zonal Admins can ask for more through Access requests (R13); the Super Admin approves with a profile, reason and password, or rejects with a reason.

### 3.2 Gaps in the built pages
- Creating an account is a dialog, then a separate page: closing after step 1 leaves an account with no zone.
- Creating an account does not ask for the password; most other sensitive actions do.
- Zones cannot be chosen on the create form.
- The preview shows saved access only.
- Zone teams "Add member" cannot set reveal, export or overrides.
- The "Without a zone" and "Without 2-step" tiles on Zonal admins count only the current page.

## 4. Navigation fixes
The built sidebar (`apps/web/lib/navigation.ts`) is newer than the list in doc 18.
1. Build the onboarding queue so the Requests & approvals entries stop opening "Coming soon". Until then, point them at the Restaurants and Home Food lists with the Pending verification tab open.
2. Add Home Food onboarding. Simplest: rename "Restaurant onboarding" to "Vendor onboarding" with type tabs.
3. Add "Needs a zone" for the Super Admin as a tab in Vendor onboarding and Delivery partner requests.
4. Show pending counts as badges on each Requests & approvals entry and in the bell.
5. Add an "Add Zonal Admin" quick action on the dashboard and on Zone teams.
6. Update doc 18 to match the built sidebar.

## 5. Built-page check (2026-10-17)
All built pages call the real API; none use sample data.

| Screen | Status | Gaps |
|---|---|---|
| Sign in, 2-step, password pages, account security | Built | None found |
| Super Admin dashboard | Built | Order and revenue tiles and charts wait for the orders and payments APIs; no pending-onboarding tile |
| Zonal Admin dashboard | Built | Operational tiles wait for counts APIs; no pending-onboarding count |
| No zones page | Built | No "Request a zone" button |
| Recent activities, audit logs, security settings | Built | None found |
| Zones list, zone detail, add/edit zone | Built | Zone detail Team tab has no link to add a member |
| Zonal admins, Zonal admin detail | Built | See §3.2 |
| Member access editor | Built | Preview of saved access only; no "same access in all zones" |
| Zone teams | Built | Add member cannot set reveal, export, overrides; no banner for empty zones |
| Access profiles, access requests, access history | Built | Reject of an access request does not ask for the password (approve does): confirm intended |
| Control panel, platform settings, settings history | Built | Home Food onboarding documents empty (D113) |
| Restaurants and Home Food list | Built | No type filter, no Needs-a-zone filter, no bulk actions; rating, commission, today's orders wait for orders data |
| Vendor detail, add/edit vendor | Built | No "more info", no onboarding timeline; menu, orders and finance tabs later |
| Orders list | Built | No export, no live toast, no partner filter |
| Order detail | Built | Refund and internal notes not built |
| Vendor onboarding, partner requests, food item requests, menus, customers, delivery partners, payments, refunds, COD, payouts, integration hub, notifications, support, hotel, analytics, offers, reviews, global search | Coming soon or in progress | Built by the module lanes in doc 57 order |

## 6. Decisions needed
| Item | Proposal | Status |
|---|---|---|
| Cloud kitchen vendor type | A cloud kitchen is a home cook: it is a **Home Food** vendor (homemaker record, Home Food screens, Home Food document list). No new vendor type, no `CLOUD_KITCHEN` value. Delivery-only commercial kitchens (no home cook) join as restaurants | **Decided by the owner 2026-10-18: D168** |
| More info required stage | Add a stage the reviewer can set with a message; the vendor app shows it and resubmits | **Decided 2026-10-20: D170** (shows "Waiting for vendor" until resubmitted) |
| Guided Add Zonal Admin flow | Replace the dialog plus separate access page with the five steps in §3.1; ask for the password on create | **Decided 2026-10-20: D171** (password asked at save; member page with tabs; "same access in all my zones" on by default) |
| Pending-onboarding tile and badges | Count on both dashboards and on menu entries | **Decided 2026-10-20: D172** |

Status after the owner's answers of 2026-10-18 (§8): D18 is closed for the build by D147 (build intake and outbound now, test with simulators). D113 is replaced by D145 (dynamic document catalogue with defaults). The owner then decided that a cloud kitchen is a Home Food vendor (no new type, D168), so "restaurant / cloud kitchen" in D154 means the restaurant and Home Food sides. On 2026-10-20 the owner decided the remaining rows (D170–D172). D47 (missing Figma frames) stays open.

## 7. Progress snapshot
From the module tracker `ZOAURO_Module_Build-members.xlsx`, 2026-10-17 evening: overall 45% (28 rows; 5 done, 4 in review, 12 in progress, 7 not started); core modules 94%.

Colleague branch work (ported module by module, never merged, D117):
| Work | Developer | Branch commits | Ported to main |
|---|---|---|---|
| Restaurants and Home Food | Chittra priya | 3031d16, 8c6312c | Yes (89d6a81, 2fc55c5) |
| Menu and food items | Chittra priya | cafea11 | In progress (tables, contract, rules on main) |
| Hotel room booking | Chittra priya | cafea11 | In progress (tables, contract, state machines on main) |
| Orders API | Maharaj | 7c3f43a, 98d6b2c | Yes (0730646) |
| Zones changes, auth backend | Chittra priya, Maharaj | 3031d16, 8739f64 | Not adopted (main already had M02 and M01) |

## 8. Owner decisions and new features (2026-10-18, D143–D166)
The owner answered the coordinator's numbered list on 2026-10-18. The decisions are recorded in doc 03 as D143–D166; this section maps each one to the admin screens and flows it changes. The common thread: almost every business value becomes a **dynamic Super Admin setting** in the Control Panel, with a default until the Super Admin changes it.

### 8.1 New features
| Feature | Decision | Admin panel work |
|---|---|---|
| Hotels: room booking, table booking and **pre-orders** | D150, D144 | Hotels module built in-house (no Figma). Pre-order: a customer (for example a traveller) orders for a chosen time and delivery location; dispatch starts so the partner delivers at that time. Admin screens control access, rules and monitoring for rooms, tables and pre-orders. Phase 1 access through existing admin roles only; no Hotel Manager profiles until phase 2 |
| Auto-assign delivery partners | D154 | Per-zone Super Admin setting, **OFF by default**: nearest available partner (online, active, verified, under the cap) within a radius (default 5 km), offered in order of distance, timeout (default 60 s), then the next; falls back to manual assignment with an alert. The restaurant / cloud kitchen (Home Food) side can also see the nearest partners and assign one through the intake contract |
| Map-based zones and delivery | D164 | OpenStreetMap + Leaflet in the web, PostGIS for zone polygons and distances. Zones and delivery locations work on the map alongside pincodes (supersedes D83 "pincode only") |
| Global search in v1 | D143 | Header search across orders, customers, restaurants, homemakers and partners, up to 5 rows per group with "see all", filtered to the admin's zones |
| Vendor override of minimum order and delivery charge | D157 | Values are set per zone; a vendor asks for an override through a request that the Super Admin approves (new request type in Requests & approvals) |
| Commission edit by Zonal Admins | D155 | Zonal Admins see commission; they edit it only where the Super Admin enables it for that member and zone in the Control Panel |
| Unzoned vendors and partners handled by the nearest zone | D162 | Super Admin can grant the nearest zone's admins the Needs-a-zone items (Control Panel grant) |
| More Super Admins | D148 | One Super Admin at launch; a Super Admin creates further Super Admins from the Control Panel (strong re-auth, audited, the last Super Admin can never be demoted) |
| Exports everywhere | D149 | Every list and report exportable by the Super Admin; Zonal Admin export only where the Super Admin grants the flag for that zone and module |
| Payments with wallet | D159, D160 | Methods Online (UPI/Card), COD and Wallet (mandatory); payments list filters by method, status, zone, date, vendor; "Refund processing" while a refund runs |

### 8.2 New dynamic settings in the Control Panel
| Setting | Default until the Super Admin changes it | Decision |
|---|---|---|
| Onboarding documents per party (restaurant, homemaker, delivery partner, hotel): add, edit, remove, mandatory or optional | Restaurants and partners per D97; homemakers: FSSAI registration, ID proof, address proof, bank details mandatory, PAN and kitchen photo optional | D145 |
| Refund rules: cancellation windows, reason list, who bears the cost per reason | Windows per R-ORD-3; vendor-fault reasons (wrong item, missing item, quality, item unavailable, vendor cancelled), platform reasons (delay, partner issue, payment issue, goodwill), customer (cancelled after preparation) | D146, D156 |
| Payout cycle (per zone) | 7 days; vendor-fault refunds deducted in the cycle they are decided | D152, D153 |
| Unpaid online order timeout (per zone, by payment method) | 15 minutes; COD visible at once | D161 |
| Zone delivery charge cap | ₹1,000 | D165 |
| Remember-me length and idle sign-out | 7 days, 8 hours | D163 |
| Auto-assign per zone: on/off, radius, offer timeout | Off, 5 km, 60 s | D154 |
| Commission edit per member and zone | Off | D155 |
| Export flag per zone and module for Zonal Admins | Off | D149 |
| Nearest-zone handling of unzoned items | Off | D162 |

### 8.3 Confirmed as they were
D8 (vendor bears vendor-fault refunds, D153), D11 (R-ORD-3 windows, D156), D14/D25 (shared customers; Super Admin sees all, D158), D40 (full refund marks the order REFUNDED, D160), D53 (unzoned until assigned, D162), D60 (audit kept 3 years, monthly S3 archive), D73 (2-step required for both roles), D85 (deactivating a zone stops only new orders, D165), D16/D17/D31, D33, D42 (stack, separate repo and database, light theme, no Google sign-in in v1; dark theme and Google sign-in as soon as possible after, D166).

### 8.4 Other answers
- D147: the apps are still being designed. Build the full admin panel now with two-way integration ready (intake API in, outbox and webhooks out) and test it end to end with the simulators; connect the real apps later.
- D151: colleague branches stay on GitHub untouched; the build is pushed to `feature/admin-panel-v1`; `main` is updated after testing and the demo.
- The two root files (module tracker and workflow map) stay local. The committed copy of the map is `60_Admin_Workflow_Map.html`.

### 8.5 Still open
- Razorpay test keys; payout details beyond the 7-day default.
- The "More info required" onboarding stage (§6). (Cloud kitchen settled: it is Home Food.)
- Home Food document list: defaults in use until the owner defines it in the Control Panel (D145).
- "Advanced" zone deactivation: only the basic mode (stop new orders, finish open ones) is chosen.

## 9. Competitor patterns used
Summarised in the HTML map, section 09: joining-request queues per vendor type (StackFood, 6amMart), FSSAI checks per outlet (Zomato), food-safety onboarding and audits for home cooks (Shef), mandatory reason codes (Deliveroo, DoorDash), SLA timers on live orders (Deliveroo, Uber Eats). Items not in the spec are listed there as proposals.

## 10. New modules: accepted defaults (D182)
D179 brought five new modules into scope. The coordinator drafted their design and 26 questions with proposed defaults; on 2026-10-20 the owner accepted every default (D182). Every value below is a Control Panel setting the Super Admin can change later. Docs 04, 08, 09, 10 and 43, `intake.openapi.yaml`, `events.catalog.json` and the simulators are updated before any code.

**Rules for all five modules:** route → controller → service → repository with `AuthContext`; outside the view scope 404, missing action 403; origin check, permission and CSRF on every write; `version` on writes (409 `STALE_VERSION`); row, audit entry and outbox event in one transaction; soft delete; money in paise; Zod schemas in `packages/shared/src/<module>/`; new settings groups `ads`, `plans`, `subscriptions`, `offers`, `hotels`; new permission modules; one migration per module; an authz matrix row for every route; a TC-INT simulator test for every intake handler. Prisma already has `OfferStatus` (auto-assign, D154), so the offers module uses `PromotionStatus`.

**Build order:** Order overview → Hotel onboarding → Offers → Advertising & Commission → Vendor plans → Meal plans, about 65 developer-days.

### 10.1 Advertising & Commission
Permission `ads`; about 14 developer-days.
- **Tables:** `ad_slots` (zone; page HOME / RESTAURANTS / HOME_FOOD / HOTELS; placement BANNER / TOP_LISTING / FEATURED; position; capacity; pricing FLAT_PER_DAY or COMMISSION; price per day or commission %; minimum and maximum days; terms; status ACTIVE / PAUSED / RETIRED). `ad_terms` (zone, or platform when empty; insert-only versions). `ad_requests` (exactly one of restaurant, homemaker or hotel; page; placement; requested start and days; creative; status; quote and decision fields; intake source). `ad_campaigns` (slot, request, vendor, start and end, status, price, commission, terms, billing status). Orders gain `ad_campaign_id`, `ad_commission_pct`, `ad_commission_paise`.
- **Request:** SUBMITTED → QUOTED (re-quote allowed) → ACCEPTED (vendor accepts the terms through the app, which schedules the campaign); or REJECTED, WITHDRAWN, EXPIRED.
- **Campaign:** SCHEDULED → LIVE → ENDED (60-second sweep); LIVE ↔ PAUSED; CANCELLED. Capacity is checked under a slot lock; an overlap above capacity returns 409 `SLOT_FULL`.
- **API:** `/ads/slots` (create, edit, status), `/ads/terms`, `/ads/requests` (quote, reject), `/ads/campaigns` (pause, resume, cancel), `/ads/availability`, `/ads/dashboard`, export. Slots exist only where the zone service is on (D92).
- **Setting `ads.rules`:** quote valid 72 h, minimum lead 24 h, booking up to 60 days ahead, campaign at most 30 days, at most 3 live campaigns per vendor, quote band 0%, commission at most 10%, banners need a creative.
- **Apps:** vendor intake `ads:write` (slots, ad requests, accept, withdraw); customer `GET /ads/placements`; events `ad_request.updated`, `ad_campaign.status_changed`.

### 10.2 Hotel onboarding and profile-edit queue
About 8 developer-days.
- Hotels gain `onboarding_stage` (SUBMITTED / UNDER_REVIEW / MORE_INFO_REQUIRED / DECIDED, shared with the D170 vendor queue), submitted time, more-info note, source; zone may be empty with `zone_assignment_status` (D53).
- `hotel_change_requests` follows the food item request pattern (R09): one pending request, newer ones supersede, the live value stays until approved.
- Documents through `vendor_documents` with type HOTEL and `onboarding.documents.HOTEL`; claim/lock through the generic D174 `record_claims`.
- **API:** `GET /hotels/onboarding`, `POST /hotels/{id}/onboarding/review` and `/more-info`, `/hotels/change-requests` (approve or reject with password).
- **Settings:** `hotels.profileApprovalFields`; `onboarding.ageWarnings` 24 h / 48 h.
- **Apps:** vendor intake `hotels:register` / `write` (register, edit, documents, resubmit); events `hotel.status_changed`, `hotel.change_decided`.

### 10.3 Order overview
About 5 developer-days, no new table.
- `GET /orders/overview` for a range and zones: open orders per status, delayed orders per status, READY orders unassigned past the threshold, pre-orders due within 2 hours, cancellations (count, rate, top reasons), average accept / prepare / deliver minutes, COD vs online, GMV and average order value (empty without `payments:view`). `GET /orders?delayed=true`.
- Live through Socket.IO, with a 30-second poll as fallback.
- **Setting `orders.sla`:** accept 5 min, prepare 30, ready to assigned 10, assigned to pickup 15, out for delivery 40.

### 10.4 ZOAURO-to-vendor plans
Permission `plans`; the catalogue is edited by the Super Admin only; about 9 developer-days.
- **Tables:** `vendor_plans` (code, price, cycle MONTHLY / QUARTERLY / YEARLY, trial days, vendor types, zones, status DRAFT / ACTIVE / RETIRED), `vendor_plan_features` (from a features catalogue), `vendor_plan_subscriptions` (TRIAL / ACTIVE / PAST_DUE / CANCELLED / EXPIRED, a snapshot of the plan, billing by payout deduction or online), `vendor_plan_invoices` (ledger entry when paid). Daily renewal job.
- **Setting `plans.billing`:** grace 7 days, GST 18%, deducted from payouts by default, renewal reminder 3 days before.
- **Apps:** vendor intake for plans; event `vendor_plan.changed`.

### 10.5 Vendor-to-customer meal plans
Permission `subscriptions`; about 16 developer-days; **blocked until payments (M12) exist**.
- **Tables:** `meal_plans` (vendor, weekly or monthly, slots, days, menu, price; changes approved like R09), `meal_subscriptions` (customer, plan snapshot, address; PENDING_PAYMENT / ACTIVE / PAUSED / CANCELLED / COMPLETED / EXPIRED; skips and pauses), `meal_deliveries` (date, slot; SCHEDULED / SKIPPED / ORDERED / DELIVERED / FAILED / CANCELLED; each becomes a paid D167 pre-order). Payments gain an optional `meal_subscription_id`.
- **Settings:** `mealPlans.rules`: skip until 12 h before, at most 4 skips per cycle, pause until 24 h before, at most 7 pause days per cycle, a skip credits the wallet, a cancel credits the unused share to the wallet, deliveries generated 2 days ahead. `mealPlans.slotTimes`: 08:00, 13:00, 20:00.
- **Apps:** customer and vendor intake; events `meal_plan.*`, `meal_subscription.status_changed`, `meal_delivery.updated`.

### 10.6 Offers review and management
Permission `offers`; about 13 developer-days.
- **Tables:** `offers` (scope PLATFORM / ZONE / VENDOR, zones, vendor, optional code, type PERCENT / FLAT / FREE_DELIVERY, limits, validity, eligibility, funded by PLATFORM / VENDOR / SHARED, budget, status, approval fields), replacing the unused `coupons` table (kept, not dropped); `offer_redemptions` (APPLIED / REVERSED).
- **Statuses:** DRAFT → PENDING_APPROVAL → SCHEDULED → ACTIVE → EXPIRED; also REJECTED, PAUSED, CANCELLED. The approver is never the requester. Vendor offers are approved by the zone's admin with `offers:status`; Zonal Admin platform or zone offers by the Super Admin; a Super Admin's own offer goes straight to SCHEDULED.
- **Redemption:** the customer app sends the offer with the order; it is checked under a row lock (422 `OFFER_INVALID` when not valid) and reversed if the order is cancelled before delivery.
- **Setting `offers.rules`:** at most 50% off, at most ₹500 flat, valid at most 90 days, at most 5 uses per customer, no stacking, use returned on cancel, approval age warning after 24 h.

### 10.7 The 26 questions and the accepted answers (D182)
| # | Question | Accepted answer |
|---|---|---|
| A1 | Pages that carry ads | Home, Restaurants, Home Food, Hotels, where the service is on |
| A2 | How vendors pay for ads | Deducted from the next payout; online payment later |
| A3 | Orders the ranking commission applies to | All orders of the vendor while the campaign is live |
| A4 | Who sets the commission % | Super Admin, or a Zonal Admin with the commission-edit switch (D155); flat prices by `ads:edit` |
| A5 | Billing on pause or cancel | Unused days are not billed; the end date stays fixed |
| A6 | Creatives | Banners need an uploaded image, reviewed with the quote |
| H1 | How hotels register | Through the vendor app (intake) |
| H2 | Hotel documents | GST, PAN, trade licence, bank details mandatory; FSSAI optional |
| H3 | Hotel outside every zone | Needs a zone, Super Admin only (D53) |
| H4 | Hotel fields that need approval | All, from an editable list |
| O1 | Delay thresholds | 5 / 30 / 10 / 15 / 40 minutes |
| O2 | Money tiles on the overview | Only with `payments:view` |
| P1 | Plan features | Meal plans, monthly ad credit, free top-listing days, priority support, analytics |
| P2 | Is a plan mandatory? | No |
| P3 | Plan billing | 18% GST, deducted from payouts |
| P4 | Do plans lower commission? | No |
| M1 | Meal-plan payment | Prepaid per cycle, online or wallet; no COD |
| M2 | Each delivery | A paid pre-order (D167) at its share of the cycle, normal commission |
| M3 | Refunds | Skip → wallet; pause extends the plan; cancel → unused share to the wallet |
| M4 | Approval of plans and changes | Yes, like food item requests (R09) |
| M5 | Auto-renew | Off by default; the customer opts in |
| F1 | Offers grantable to Zonal Admins (reverses D15) | Yes: view, add, edit, status, export; their offers still need Super Admin approval (D94) |
| F2 | Who funds the discount | Vendor offers by the vendor, platform offers by the platform, shared only by the Super Admin |
| F3 | Stacking | One offer per order; reward points (D169) may be used alongside |
| F4 | When a used offer is returned | On cancel before delivery only |
| F5 | Old coupons table | Replaced by offers; kept, not dropped |

The H2 answer gives the hotel onboarding document list the tracker had listed as missing.
