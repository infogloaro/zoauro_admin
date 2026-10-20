# 53 — Module Guide M02: Zones (v1.0)

What a zone is, why the product needs the module, how it works, and how to build and verify it. Owner Dev 1, reviewer Dev 2 (doc 40). Related: doc 03 (D3, D7, D12, D19, D25, D35, D53, R-ORD-1/5, R-VEN-3, R-ACC-4; new D81–D90), 04 (access), 08 (schema), 09 (API), 20/22 (screens, forms), 36 (multi-zone), 42/44/45 and `contracts/` (app integration), 50 (audit), 54 (prompts).

> **Status.** Specification only; nothing here is built or tested. Where the pack was silent or contradictory I made a choice and marked it **Assumed** (list in §14). Three gaps are stated plainly because they affect the apps: **(1)** the pack has no map geometry, so serviceability is decided by pincode only (§2.3); **(2)** the order-number prefix is inconsistent across docs (§14, D88); **(3)** a pincode can belong to only one zone, which the Figma "pincode range" field did not say (D82).

---
## 1. What the module does, and why it exists

### 1.1 In one paragraph
A **zone** is a named service area (for example "Chennai Central") that the business opens, prices and staffs as one unit. The Zones module lets the **Super Admin** define zones, say which pincodes belong to each, set the default delivery charge, and open or close the zone. Everything else in the product hangs from that definition: each restaurant, homemaker, delivery partner and order belongs to exactly **one** zone; each Zonal Admin member is given access **per zone**; and every list, count, export, search, cache, real-time room and audit row is filtered by zone.

### 1.2 Why a separate module (what breaks without it)
| If zones were just a text field on each record | What goes wrong |
|---|---|
| No single place decides who is serviceable | The customer app and vendor app each guess; an order is accepted for an address nobody can serve |
| Access is per member per zone (D41) | There is nothing to assign; "Karthik runs Chennai and Madurai, Priya only Chennai" cannot be expressed |
| A new city launches | No way to prepare it (UPCOMING), or to pause it (INACTIVE) without touching vendors one by one |
| Delivery charge differs by area | Prices hard-coded or edited per vendor (D12 wants a zone default with a vendor override) |
| Data isolation | The zone filter is the security boundary of Zonal Admins (doc 36); a wrong zone on a record leaks or hides data |
| Reporting | No "orders and revenue by zone", no zone team view |
So Zones is small in code and **high in blast radius**: a wrong pincode mapping sends orders to the wrong team, and an accidental deactivation stops revenue. That is why §5 has an impact check, re-auth and audit on every change.

### 1.3 Questions the module answers
"Which zone does this address belong to?" · "Can we deliver here today?" · "What does delivery cost here by default?" · "Who runs this zone?" · "What happens if I switch this zone off?" · "Which areas are not covered yet?"

### 1.4 In scope
Zone CRUD with soft delete rules; status lifecycle (UPCOMING / ACTIVE / INACTIVE); pincode coverage (range + individual + CSV) with overlap protection; default delivery charge; colour for chips and charts; KPI cards and the list/detail screens; impact check; team column and Team tab (read-only here; edited in M03); zone resolution for the apps (`GET /zones/resolve`); `zone.updated` event to the three apps; `admin.zones_changed` internal event (cache invalidation, real-time); audit.

### 1.5 Out of scope (and why)
| Item | Why |
|---|---|
| Map drawing / polygon geofence / distance-based serviceability | The pack has no geometry anywhere (`zones` has no polygon, the contract has lat/lng but nothing to test them against). Needs a maps provider and PostGIS: post-pilot (D83) |
| Delivery radius per vendor | That is the Order Settings "delivery fee/radius" (settings module), not a zone attribute |
| Per-zone commission, per-zone tax | Not in docs 02/03; commission is per vendor with a global default |
| Surge or time-based pricing | Not requested |
| Moving a vendor/partner between zones | Vendor move is Super Admin only and lives in M06/M10 (R-VEN-3) |
| Zone teams and access | M03 owns it; this module only shows the team |
| Scheduling a future activation/deactivation | Not requested; UPCOMING + manual Activate covers launch |

---
## 2. How it works

### 2.1 Lifecycle
```
              create                 Activate                    Deactivate (impact check + re-auth + reason)
 (nothing) ───────────► UPCOMING ───────────────► ACTIVE ◄──────────────────────────────────────────────────┐
                           │   ▲                      │  ▲                                                    │
                           │   └──── (edit only) ─────┘  └──────────── Reactivate ◄── INACTIVE ◄─────────────┘
                           │ delete (pristine only)                                          │ delete (pristine only)
                           ▼                                                                 ▼
                       soft-deleted                                                      soft-deleted
```
| Status | Meaning | Customer app | Vendor / partner onboarding | New orders | Admins |
|---|---|---|---|---|---|
| **UPCOMING** | Being prepared, not yet launched | resolve returns `UPCOMING`, `serviceable=false` ("coming soon") | Registrations in its pincodes are accepted into the zone and wait (**assumed** D84) | Rejected `NOT_SERVICEABLE` | Super Admin full; assigned members can see it and prepare vendors if granted |
| **ACTIVE** | Live | `serviceable=true`, delivery charge returned | Auto-assigned by pincode (D53) | Allowed | Normal |
| **INACTIVE** | Paused/closed | `serviceable=false`, status `NONE` to the apps (the apps need not know why) | New registrations in its pincodes: unzoned, "Needs a zone" | Rejected; **open orders finish normally** | Read access to history kept; members may still act on **open** orders (cancel, refund, complete) so nothing is stranded |
Transitions allowed: UPCOMING→ACTIVE, ACTIVE→INACTIVE, INACTIVE→ACTIVE, UPCOMING→INACTIVE. ACTIVE→UPCOMING is **not** allowed (it would hide a live zone from customers while orders exist). Every transition: Super Admin only, `PASSWORD` re-auth (doc 14 lists "deactivate zone"), audit, `zone.updated` event.

**Activation preconditions (server-checked):** name, city, state present; ≥ 1 pincode; delivery charge set (0 is allowed, null is not). A zone with no team can be activated; it is flagged on the dashboard (R-ACC-4).

### 2.2 The six operations, as the Super Admin experiences them
1. **Open a new area (UC-01).** Zone Management > Add Zone: name, code, city, state, pincode range and/or pincodes, delivery charge, status (default UPCOMING), colour, description → Save. The form checks the pincodes against other zones live and refuses overlaps (names the other zone). Then add members in M03.
2. **Launch.** Open the zone > Activate. The dialog shows what will go live (pincode count, delivery charge, vendors already registered, team size).
3. **Change the delivery charge.** Edit > charge. Applies to **new** orders only (an order stores the charge at placement; D12 vendor override still wins). Audited as `zone.delivery_charge_changed`; apps receive `zone.updated`.
4. **Change coverage.** Add or remove pincodes. Removing shows the **mismatch list**: vendors and partners registered in the zone whose pincode is being removed. They are *not* moved automatically (R-VEN-3); Super Admin moves them in their own modules.
5. **Pause or close (impact check).** Deactivate: the dialog loads `GET /zones/{id}/impact` (open orders by status, vendors by type, partners online, members, scheduled orders, pending registrations, pending refunds/payouts), asks for a reason, requires the checkbox "I understand open orders will continue and new orders will be refused", then re-auth.
6. **Retire.** Delete is allowed only for a zone that has **never** had vendors, partners, customers' addresses, orders or members (typo in a new zone). Otherwise deactivate. Soft delete (`deleted_at`); the code stays reserved.

### 2.3 Zone resolution (the heart of the module)
Used by: vendor/partner self-registration (D53), customer address check (app), order intake serviceability (doc 42), admin "Needs a zone" assignment hints.
```
input: pincode (preferred), lat/lng (accepted, not used for matching in v1)
 1. normalise pincode: trim, 6 digits, ^[1-9][0-9]{5}$ else NONE (reason INVALID_PINCODE)
 2. lookup serviceable_pincodes.pincode (unique) → zone (not soft-deleted)
 3. status → response:
      ACTIVE   → { serviceable:true,  zoneId, zoneName, status:"ACTIVE",   deliveryChargePaise }
      UPCOMING → { serviceable:false, zoneId, zoneName, status:"UPCOMING", deliveryChargePaise:null }
      INACTIVE → { serviceable:false, status:"NONE" }                    (zone identity not disclosed to the apps)
      no match → { serviceable:false, status:"NONE" }
```
The contract's `ZoneResolution.status` enum includes `INACTIVE`; this guide returns `NONE` for inactive zones so an app cannot learn about closed zones. If you prefer to expose `INACTIVE`, the contract already allows it (D87, one-line change).
**The gap:** `GET /zones/resolve?lat&lng&pincode` accepts coordinates but there is nothing to test them against. Apps that only know lat/lng must reverse-geocode to a pincode themselves; with neither a valid pincode nor a match, the result is `NONE`. This is stated in doc 42's notes by this release (D83). Polygons are the post-pilot upgrade; the resolver is one function so the swap is local.
**Performance:** the endpoint is hot (every address entry). Resolution reads a Redis cache `zones:pin:<pincode>` (TTL 300 s) keyed with a global counter `zones:version`; any zone or pincode change increments `zones:version` in the same request that commits, so stale answers last at most one cache read after commit. Target p95 < 50 ms on a warm cache, < 150 ms cold with 10 000 pincodes. Rate limited per API client.

### 2.4 Where zones are used (so you know what a change affects)
| Module / area | Use of the zone |
|---|---|
| Restaurants, Homemakers, Delivery Partners | `zone_id` required (nullable only while "Needs a zone"); list filter; zone chip |
| Customers | Visible by address/order zone (D25) |
| Orders | `zone_id` fixed at placement (R-ORD-5); order number prefix (D88); state machine per zone |
| Payments, Refunds, COD, Payouts | Filtered by zone; refund limits per member per zone (D20) |
| Access (M03) | Assignments are member × zone; the Zone Teams screen |
| Dashboard | KPIs by scope; "zones with no team" alert |
| Real-time (M17) | Socket.IO rooms `zone:<id>:<module>` |
| Audit (M04) | `entity.zoneId` on every row (doc 50 §4.0); zone entity rows carry their own id |
| Apps | `zone.updated` events and `/zones/resolve` |

### 2.5 Events
| Event | To | When | Payload |
|---|---|---|---|
| `zone.updated` (outbound, `contracts/events.catalog.json`) | Customer, Vendor, Partner apps | created, name/status/charge/pincodes changed, activated, deactivated | `{zoneId, name, status, pincodeRange, deliveryChargePaise}` |
| `admin.zones_changed` (internal, doc 10) | Admin web (TanStack Query invalidation), workers | any change | `{zoneId, change}` |
| `scope.changed` | affected members | zone deactivated/reactivated (their effective scope changes) | per M17 |
Gap in the contract: `pincodeRange` is a single string and cannot express individual pincodes. This guide sends the range when the zone is defined by one, otherwise `"multiple"` plus `pincodeCount`; apps should call `/zones/resolve` rather than parse it. Proposed contract change (needs the app teams): add `pincodeCount: int` to the payload (D87). Do not change the contract file without them.

### 2.6 Rules
| Id | Rule |
|---|---|
| R-ZONE-1 | Only Super Admin creates, edits, activates, deactivates or deletes zones; the `zones` module is not grantable to Zonal Admin (doc 04). Zonal Admins see their zone names via `/me`, never via `/zones` |
| R-ZONE-2 | A pincode belongs to **at most one** zone, forever, unless explicitly removed from the first (D82). Enforced by a database unique index, not only by code |
| R-ZONE-3 | Zone `code` is unique including soft-deleted zones and **cannot be changed** after creation (it appears in order numbers and exports) |
| R-ZONE-4 | Zone name is unique case-insensitively among non-deleted zones |
| R-ZONE-5 | Delivery charge is integer paise, 0 ≤ charge ≤ 100 000 (₹1 000 sanity ceiling, Assumed) |
| R-ZONE-6 | Deactivation never cancels or alters open orders, vendors' own statuses or partner records; it only stops **new** intake (derived, no cascade writes) |
| R-ZONE-7 | Reactivating restores everything automatically because nothing was changed |
| R-ZONE-8 | Changing pincodes never moves existing vendors or partners (R-VEN-3) |
| R-ZONE-9 | Edits use optimistic locking (`version`); a stale save gets 409 and shows the newer values |
| R-ZONE-10 | Every write is a transaction plus audit row plus event row (outbox), or none of them |

---
## 3. Data model (amends doc 08)
```
zones                (changes)
  id uuid pk, name text, code text, city text, state text,
  pincode_from char(6) null, pincode_to char(6) null,       -- the *entered range*, display only (Figma column); truth is serviceable_pincodes
  delivery_charge int not null default 0,                    -- paise (D12)
  status ZoneStatus {UPCOMING, ACTIVE, INACTIVE} default UPCOMING,
  description text null, color_hex char(7) not null,
  version int not null default 1,
  activated_at, deactivated_at, deactivation_reason text null,
  created_by uuid, created_at, updated_at, deleted_at null
  UNIQUE (code)                                              -- includes soft-deleted
  UNIQUE (lower(name)) WHERE deleted_at IS NULL
  CHECK (code ~ '^[A-Z][A-Z0-9]{1,5}$'), CHECK (delivery_charge BETWEEN 0 AND 100000)
  CHECK (pincode_from IS NULL OR (pincode_from <= pincode_to))
serviceable_pincodes (changes)
  id, zone_id fk, pincode char(6) CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  source PincodeSource {RANGE, MANUAL, IMPORT}, created_at
  UNIQUE (pincode)                                           -- R-ZONE-2, global
  INDEX (zone_id)
```
- A **range** of more than **2 000** pincodes is refused (`RANGE_TOO_LARGE`); this blocks `100000–999999` typos that would swallow the country. Numeric ranges are not geographic ranges in India (pincodes are postal, not contiguous), so the form also takes a pasted list / CSV (`MANUAL`/`IMPORT`).
- Range edits recompute only `source=RANGE` rows inside one transaction guarded by `pg_advisory_xact_lock(hashtext('zones.pincodes'))` so two Super Admins cannot interleave overlap checks; the unique index is the final safety net.
- Inactive zones **keep** their pincodes (history and reactivation). To reuse a pincode in another zone the Super Admin must first remove it from the inactive zone (explicit, audited).
- `color_hex` comes from a fixed palette of 12 design tokens (Zod enum), so chips and charts stay legible; uniqueness not required.
- `ZoneStatus` loses nothing; `NONE` exists only in the resolve response.
- Counts on the list (restaurants, homemakers, partners, customers, admins) are computed with grouped queries on the indexed `zone_id` columns, not stored.
- Seeds: no default zones in production; dev seed creates two zones (one ACTIVE, one UPCOMING) with disjoint pincodes.

---
## 4. Action catalogue additions (amends doc 50 §4)
Existing: `zone.created`, `zone.updated`, `zone.deactivated`, `zone.activated`. **Add first:** `zone.delivery_charge_changed`* (HIGH, before/after paise), `zone.pincodes_changed`* (HIGH, counts added/removed + the removed list capped at 200 in `diff`), `zone.deleted`. `zone.updated` covers name/city/state/description/colour. `entity.zoneId` = the zone itself; actor zone-less rules as doc 50 §4.0.

---
## 5. REST API (amends doc 09 §Zones)
All Super Admin, permission `zones:*`; mutations need CSRF; `PATCH/activate/deactivate` carry `version`.
| Method | Path | Permission | Request → response | Notes |
|---|---|---|---|---|
| GET | /zones | zones:view | `?status&state&q&cursor` → rows with colour, city, state, status, counts, team avatars (top 3 + count), pincode count | KPI cards from `GET /zones/summary` (Total/Active/Inactive/Upcoming + "no team" count) |
| GET | /zones/summary | zones:view | → counts | |
| POST | /zones | zones:add | `{name,code,city,state,pincodeFrom?,pincodeTo?,pincodes?[],deliveryChargePaise,status?,colorHex,description?}` → zone | 409 `ZONE_NAME_TAKEN`, `ZONE_CODE_TAKEN`, `PINCODE_OVERLAP{conflicts:[{pincode,zoneName}]}`; creating directly as ACTIVE enforces §2.1 preconditions |
| GET | /zones/{id} | zones:view | zone + pincodes (paged) + team summary | |
| PATCH | /zones/{id} | zones:edit | partial, `version` → zone | `code` rejected; charge/pincode changes produce their own audit action |
| PUT | /zones/{id}/pincodes | zones:edit | `{range?:{from,to}, add?:[], remove?:[]}` → `{added,removed,mismatches:[…]}` | dry-run with `?preview=true` returns the overlap list and mismatch vendors without writing |
| GET | /zones/lookup | zones:view | `?pincode=` → owning zone or null | powers the form's live overlap hint |
| POST | /zones/{id}/activate | zones:status + `PASSWORD` | `{version}` | 422 `ZONE_NOT_ACTIVATABLE{missing:[…]}` |
| GET | /zones/{id}/impact | zones:view | → counts (see §2.2) + `impactVersion` | cacheable 30 s |
| POST | /zones/{id}/deactivate | zones:status + `PASSWORD` | `{version, reason, impactVersion}` | 409 `IMPACT_CHANGED` if the impact moved since the dialog loaded; 422 `REASON_REQUIRED` |
| DELETE | /zones/{id} | zones:delete + `PASSWORD` | | 409 `ZONE_HAS_HISTORY{counts}` |
| GET | /zones/{id}/team | access:view | members, profile, overrides count, limits | read side of M03 |
| GET | /zones/resolve | client scope `zones:resolve` (intake) | `?pincode&lat&lng` → `ZoneResolution` | contract file unchanged |
Zonal Admin on any `/zones*` admin route → 403. Cross-checks: PUT pincodes and POST /zones run overlap detection inside the advisory-locked transaction.

---
## 6. UI specification (Figma: Zone Management list + Add/Edit overlay exist; the rest from this section)
- **List** `/super-admin/zones`: four KPI cards (Total/Active/Inactive/Upcoming) + a "Zones without a team" alert chip; table columns per Figma: zone (colour dot + name + code), city, state, Zonal Admin avatar stack, status badge, restaurants, homemakers, delivery partners, customers; filters status/state, search; row action menu (Edit, Activate/Deactivate, View team). Loading/empty/error states.
- **Add/Edit overlay** (doc 22 rules): Zone Name (2–60), **Code** (2–6, A–Z/0–9, disabled after creation, helper "appears in order numbers"), City, State (required), **Pincode coverage**: "Range" (from/to, 6-digit) and "Add pincodes" (comma/newline paste, CSV upload), live chip list with per-chip remove, live overlap hint from `/zones/lookup`; Delivery Charge (MoneyInput, ₹, paise-safe); Status (default Upcoming); Colour (12 swatches); Description (≤ 500). Server errors map to fields (overlap lists the pincodes and owning zone).
- **Zone detail** `/super-admin/zones/{id}` (new, small): header with status and actions; tabs **Overview** (counts by module, last changes), **Pincodes** (searchable list with source), **Team** (read-only list + link "Manage access" to M03), **Activity** (audit ActivityTab of doc 50).
- **Activate dialog**, **Deactivate dialog**: impact table (numbers link to filtered lists), reason (required, ≥ 10 chars), acknowledgement checkbox, re-auth, destructive button style; shows "Open orders (n) will continue to completion".
- **Zonal Admin panel**: no Zones screen. The zone chip/switcher (M05) reads names and colours from `/me`.
- Accessibility: colour is never the only status signal (badge text); dialogs trap focus; table sortable by keyboard.

---
## 7. Module structure
```
packages/shared/src/zones/    schemas.ts (Zod: create, patch, pincodes, deactivate), pincode.ts (normalise, range expand, validate), palette.ts, errors.ts
apps/api/src/modules/zones/
  zones.routes.ts  zones.controller.ts  zones.service.ts  zones.repository.ts (only Prisma importer)
  pincodes.service.ts   (range expand, overlap detection under advisory lock, mismatch report)
  impact.service.ts     (counts via other modules' repositories' read-only count methods, never their tables directly)
  resolve.service.ts    (cache + lookup; also used by intake routes)
  zones.events.ts       (outbox rows zone.updated, internal admin.zones_changed, cache version bump)
apps/web/src/app/super-admin/zones/  page.tsx, [id]/page.tsx, components/ ZoneForm, PincodeEditor, ZoneImpactDialog, ZoneStatusBadge
```
The impact service depends on counts from Restaurants, Homemakers, Partners, Orders, Access. Those modules are built later; ship `impact.service.ts` with a port interface `ImpactSources` and register real implementations as each module lands (until then it returns zeros and the response carries `partial:true` so the UI says "Some modules are not built yet"). Never ship a version that silently reports zeros as if complete.

---
## 8. Security and threats (amends doc 13)
| ID | Threat | Impact | Mitigation | Test |
|---|---|---|---|---|
| T40 | Pincode overlap or hijack: a pincode silently captured by another zone moves its orders/vendors to a different team | Wrong team sees data, revenue misrouted | DB unique index, advisory-locked check, audit `zone.pincodes_changed` HIGH, mismatch report, Super Admin only | TC-ZONE-6…9 |
| T41 | Accidental or malicious deactivation of a live zone | Outage | Impact check, reason, ack, `PASSWORD` re-auth, audit HIGH, `scope.changed` alert to members, easy reactivation (no cascade) | TC-ZONE-14…17 |
| T42 | Resolver abuse (enumerating covered pincodes, scraping closed zones) | Info leak, load | Per-client rate limit, scope `zones:resolve`, inactive zones disclosed as `NONE`, cache | TC-ZONE-20, 21 |
| T43 | Stale cache after a change (orders accepted for a closed zone) | Wrong serviceability | `zones:version` bump inside the commit path, order intake re-checks zone status in its own transaction (does not trust the cache) | TC-ZONE-19 |
| — | Cross-zone leak via zone endpoints | Data exposure | Zonal Admin gets 403 on all `/zones*`; names via `/me` only | TC-ZONE-5 |

---
## 9. Test plan (add to doc 24; existing TC-ZONE-1…4 are isolation tests of other modules and stay)
| ID | Area | Case | Expected |
|---|---|---|---|
| TC-ZONE-5 | Auth | Zonal Admin calls every `/zones*` admin route; unauthenticated call | 403 / 401; no data |
| TC-ZONE-6 | Pincodes | Create zone B with a pincode owned by zone A | 409 `PINCODE_OVERLAP` naming A; nothing written |
| TC-ZONE-7 | Pincodes | Two concurrent creates with the same pincode | exactly one succeeds (advisory lock + unique index) |
| TC-ZONE-8 | Pincodes | Range 560001–560100 | 100 rows, source RANGE; edit to 560001–560050 removes 50 and reports mismatches |
| TC-ZONE-9 | Pincodes | Range > 2 000; invalid pincode `012345`, `56001`, `abcdef`, from > to | 422 with field errors |
| TC-ZONE-10 | Create | Duplicate name (different case); duplicate code incl. a soft-deleted zone's code | 409 each |
| TC-ZONE-11 | Create | Charge −1, 100 001, 1.5 | 422 |
| TC-ZONE-12 | Edit | Change `code` | 422 `CODE_IMMUTABLE` |
| TC-ZONE-13 | Edit | Stale `version` | 409 with current values |
| TC-ZONE-14 | Status | Activate with no pincode / no charge | 422 `ZONE_NOT_ACTIVATABLE{missing}` |
| TC-ZONE-15 | Status | Deactivate without reason / without re-auth / stale `impactVersion` | 422 / 403 / 409 |
| TC-ZONE-16 | Status | Deactivate ACTIVE zone with open orders | zone INACTIVE; open orders remain and can advance; new intake order → `NOT_SERVICEABLE`; vendors' stored statuses unchanged (R-ZONE-6) |
| TC-ZONE-17 | Status | Reactivate | intake works again with no other change (R-ZONE-7) |
| TC-ZONE-18 | Status | ACTIVE → UPCOMING | rejected |
| TC-ZONE-19 | Cache | Change charge then resolve immediately | new charge returned; intake order uses the zone row, not the cache |
| TC-ZONE-20 | Resolve | Pincode in ACTIVE / UPCOMING / INACTIVE / unknown / invalid | `ACTIVE serviceable`, `UPCOMING not serviceable`, `NONE`, `NONE`, `NONE` |
| TC-ZONE-21 | Resolve | lat/lng only | `NONE` (documented behaviour); client without scope → 403; rate limit 429 |
| TC-ZONE-22 | Delete | Zone with history | 409 `ZONE_HAS_HISTORY`; pristine zone soft-deletes; code stays reserved |
| TC-ZONE-23 | Impact | Seeded vendors/orders/members | counts exact; `partial:true` while ports are stubs |
| TC-ZONE-24 | Events | Each change | exactly one outbox `zone.updated` and one `admin.zones_changed` row in the same transaction; rollback leaves none |
| TC-ZONE-25 | Audit | Each operation | one audit row with correct action, diff, zone id; charge and pincode changes use their dedicated actions; coverage guard green |
| TC-ZONE-26 | Vendors | Remove a pincode used by a vendor | vendor stays in zone; appears in `mismatches` |
| TC-ZONE-27 | List | KPI counts and per-zone counts vs seeded data | exact; query count constant (no N+1) |
| TC-ZONE-28 | UI (Playwright) | Add zone with overlap error → fix → save → activate → deactivate dialog | flow passes |
| TC-ZONE-29 | UI (axe) | Overlay and dialogs | no critical violations |
| TC-ZONE-30 | Perf | Resolve p95 with 10 000 pincodes | < 50 ms warm, < 150 ms cold |
Mutation checks (once, by hand): remove the unique index; remove the advisory lock; skip the `zones:version` bump; let `code` be patched; cascade-update vendors on deactivate. Each must break at least one test.

---
## 10. Acceptance and Definition of Done
Given zone A owns pincode 560001, when the Super Admin saves zone B with 560001, then they are told A owns it and nothing is saved. Given an ACTIVE zone with open orders, when it is deactivated, then new orders are refused, open orders still complete, and every member's panel and the apps learn of the change. Given a zone is reactivated, then no record needs repair. Given a Zonal Admin, then no Zone Management screen or `/zones` data is reachable. **DoD:** TC-ZONE-5…30 pass; resolve latency measured on seeded data; audit coverage guard green; `zone.updated` verified against the simulator (IH-1 when available) and recorded; mutation checks done; docs 03/08/09/24/32/42 amended (done in this release); handoff block written.

## 11. Effort and phasing
| Task | Content | Dev-weeks | When |
|---|---|---|---|
| ZONE-1 | Schema/migration (unique indexes, checks), shared Zod/pincode helpers, audit actions | 0.3 | S2 |
| ZONE-2 | Service + API (CRUD, transitions, pincodes with locks, impact with ports, delete rules, outbox) | 1.0 | S2 |
| ZONE-3 | Resolver + cache + `zone.updated` + `admin.zones_changed` (with IH-2) | 0.6 | S3 (IH-2) |
| ZONE-4 | UI: list, KPI, overlay, detail, dialogs | 1.0 | S2–S3 (Dev 2 reviews) |
| ZONE-5 | Tests, mutation checks, perf, verification | 0.5 | with each |
| **Total** | | **≈ 3.4** | doc 34 SA-1.1 was sized M (0.5) for list+overlay only; the extra 2.9 is pincode integrity, lifecycle, resolver and impact — the parts that cost money when wrong |

## 12. Build procedure
Doc 54 Part B (M02-P1 … M02-P5). Starts after the foundation prompts and the Audit write path exist. ZONE-3 needs the intake framework (IH-1); until then the prompt builds the resolver service and its contract test and leaves the route registration for IH-2.

## 13. Verification of this guide against the pack
Cross-read: docs 03 (D3, D7, D12, D19, D35, D53, R-ORD-5, R-VEN-3, R-ACC-4), 04, 08, 09, 20, 22, 34 (SA-1.1), 36, 40, 42, 44, 45, `intake.openapi.yaml` (ZoneResolution enum includes INACTIVE and NONE), `events.catalog.json` (`zone.updated` payload), 50 (§4.0). **Found in the pack:** order prefix `GA-<zonecode>-<seq>` (R-ORD-1) vs `ZO-100245` in the intake example; `pincodeRange` as one string; `serviceable_pincodes` existed in doc 08 but the Figma form shows only a range; no geometry. **Not verified by running code.**

## 14. Open decisions for the owner (all marked Assumed until you answer)
| Id | Question | My default |
|---|---|---|
| D81 | Zone code format | 2–6 chars A–Z/0–9, immutable |
| D82 | One pincode in at most one zone | Yes (a pincode shared by two zones makes routing ambiguous) |
| D83 | Serviceability by pincode only in v1; polygon/PostGIS post-pilot | Yes. Say so to the app teams |
| D84 | Registrations in an UPCOMING zone are accepted into it and wait | Yes (lets you pre-onboard before launch) |
| D85 | Deactivation: members may still act on open orders; no cascade writes | Yes |
| D86 | Delivery charge ceiling ₹1 000 | Yes; configurable by migration only |
| D87 | Resolve returns `NONE` (not `INACTIVE`) for closed zones; add `pincodeCount` to `zone.updated` | Yes; the second needs the app teams |
| D88 | **Order number prefix**: `GA-<zonecode>-<seq>` (R-ORD-1) or `ZO-<seq>` (intake example) | Open. Pick one before the Orders module; the zone code only needs to exist |
| D89 | Zone name editable; code not | Yes |
| D90 | No scheduled activation | Yes |

## 15. Amendments applied to other documents
Doc 03 (D81–D90), 08 (zones/serviceable_pincodes columns and indexes), 09 (zone endpoints), 13 (T40–T43), 24 (TC-ZONE-5…30), 32 (change-log), 34 (SA-1.1 pointer and size), 42 (resolution note), 50 (§4 actions), 40 (M02 row), README. See each document's own note.
