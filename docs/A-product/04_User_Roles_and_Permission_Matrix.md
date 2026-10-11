# 04 — User Roles, Access Control and Permission Matrix (v1.2)

v1.2 change: Super Admin is the superior authority. **Several Zonal Admin members can work in the same zone, and Super Admin grants each member specific access, per zone, from an Access Control panel.** This replaces v1.1's "one role matrix for all Zonal Admins" (D41).

## 1. Hierarchy
```
Super Admin (superior, all zones, all modules, only actor who grants access)
   └─ Zone  ── team of 0..N members (Zonal Admins)
                 └─ Member × Zone assignment = Access Profile + overrides + limits
```
| Actor | Scope | Can |
|---|---|---|
| Super Admin | Everything | Create zones and members, grant/revoke/adjust access, see any member's effective access, approve refunds above limits, edit settings and commission |
| Zonal Admin member | Only zones they are assigned to, and within each zone only what their assignment grants | Operate granted modules in granted zones. Cannot see or change anyone's access, including their own (R-ACC-1) |

Principle: **identity role says who you are, the assignment says what you can do in which zone.** Checked server-side on every request.

## 2. The four layers of access
1. **Identity role** (`users.role`): `SUPER_ADMIN` or `ZONAL_ADMIN`. Fixed; not editable.
2. **Access Profile** (template): a named matrix of module × View/Add/Edit/Delete/Status, plus default limits and flags. Super Admin creates and edits profiles in the Access Profiles screen. Seed examples (editable, deletable): *Zone Manager* (D2 full operations, refunds within limit), *Operations* (orders, vendors, partners, customers; no payments), *Support* (view all, edit customers, cancel orders), *Finance View* (payments, refunds view, COD settlement), *Read Only*.
3. **Assignment** (member × zone): which profile applies in that zone, plus optional **overrides** (grant or deny a single module action) and **limits** (per-refund amount, daily refund amount, `can_reveal_contacts`, `can_export`). Effective permission set = profile + grants − denies; **deny wins**.
4. **Super Admin supremacy**: no override or profile can exceed what the code allows a Zonal Admin (zone, admin, role, access, settings, commission-edit modules are never grantable to a Zonal Admin).

Example: Karthik is *Zone Manager* in Chennai, *Read Only* in Madurai, and has `payments:view` denied everywhere. Priya is *Operations* in Chennai. Chennai's team is Karthik + Priya.

## 3. Matrix (module defaults for the seed profiles and for Super Admin)
Key: V view, A add, E edit, D soft delete, S status change (approve, verify, suspend, activate). "Grantable" = Super Admin can include it in a profile or override for a Zonal Admin.

| Module | Super Admin | Grantable to Zonal Admin | Seed *Zone Manager* |
|---|---|---|---|
| Dashboard | V (global) | V | V |
| Orders (incl. cancel, assign) | V A E D S | V A E D S | V A E D S |
| Restaurants | V A E D S | V A E D S (commission field never editable) | V A E D S |
| Homemakers | V A E D S | V A E D S | V A E D S |
| Menu / Food Items | V A E D S | V A E D S | V A E D S |
| Delivery Partners | V A E D S | V A E D S | V A E D S |
| Customers | V A E D S | V A E D S (+ flag reveal) | V A E D S |
| Payments (transactions) | V | V | V |
| Refunds | unlimited, approves queue | V, create within limits | create within limits |
| COD cash settlement | V A E | V A E | V A E |
| Payouts (vendors, delivery partners) | V A E | V | V |
| Commission rates | V A E | not grantable | — |
| Zone Management | V A E D | not grantable | — |
| Zonal Admins, Zone Teams, Access Profiles, Access control | V A E D | not grantable | — |
| Offers, Notifications (compose), Analytics, Reviews, Support | V A E D | not grantable in v1 (D15) | — |
| Settings (all sections) | V E | not grantable | — |
| Integrations (clients, webhooks, event monitor, retry/replay) | V E | not grantable (D57) | — |
| Pending registrations inbox | derived from restaurants/homemakers/delivery view and status | per module permission | — |
| Audit / system logs | V E(export) all | entity Activity only, derived from the entity module's view permission; `audit:view` and `audit:export` not grantable | V (entity Activity) |

PDF note: the designer PDF marks Delete "Restricted" for most modules and Customers Add "—". D2 gives Zonal Admins full control and v1.2 lets Super Admin tighten any of it per member, so the seed profile follows D2 and the restrictions are one click away.

## 4. Data boundaries
1. Every Zonal query carries `zone_id IN (zones where this permission is granted ∩ requested zones)`. The zone set is computed **per module and action**, not once per user (doc 14 §4, doc 36).
2. Direct object access verifies zone **and** permission in that zone. Zone not assigned → 404. Zone assigned but permission missing → 403 for writes, 404 for reads of modules the member cannot view in that zone.
3. Lists, exports, search, global search, counts, dashboard widgets, Socket.IO rooms and notifications are filtered by the same rule. A dashboard tile appears only if the member can view its source module in at least one scoped zone, and counts only zones where they can.
4. A customer is visible if they have an address or order in a zone where the member has `customers:view`; order counts and spend are filtered by zones where they have `orders:view`.
5. Zone id in a query that is not assigned → 404 `ZONE_NOT_FOUND`.
6. Access changes apply on the next request; no stale permission is trusted from the session.
7. No impersonation in v1. Super Admin gets an **Access Preview** ("what can this member see?") that computes effective access without logging in as them.

## 5. Permission keys
`module:action`, e.g. `orders:view`, `orders:edit`, `orders:status`, `refunds:create`, `refunds:approve`, `customers:reveal`, `orders:export`. Stored per profile (`profile_permissions`) and per assignment override. Resolved per request into `AuthContext.permissionsByZone`.
