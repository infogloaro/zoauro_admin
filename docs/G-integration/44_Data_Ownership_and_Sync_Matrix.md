# 44 — Data Ownership and Sync Matrix

## 1. Principle
Each field has **one writer**. Where both an app and the admin panel need to influence the same thing, they get **two separate fields** and the effective value combines them. That removes edit conflicts without locking.

| Concept | App-owned field | Admin-owned field | Effective value |
|---|---|---|---|
| Vendor can take orders | `is_open` (vendor toggles) | `status` (ACTIVE/INACTIVE/SUSPENDED) + `verification_status` | open **and** ACTIVE **and** VERIFIED |
| Menu item visible | `is_available`, `in_stock` (vendor) | `admin_disabled` (admin/zone member with `menu:edit`) | available **and** in stock **and** not admin-disabled |
| Partner can receive orders | `is_online` (partner) | `status` + `verification_status` + `force_offline_until` | online **and** ACTIVE **and** VERIFIED **and** not forced offline |
| Customer can order | profile data | `status` (ACTIVE/BLOCKED) | not blocked |
| Order progress | vendor/partner/customer events | admin transitions (cancel, assign, accept-on-behalf) | state machine with `version` decides |

## 2. Entity matrix
Legend: **C** creates, **U** updates, **R** reads, — none. App rows apply through the Integration API; admin rows apply through the panels with zone and permission checks.
| Entity | Customer app | Vendor app | Partner app | Zonal Admin member | Super Admin | System of record |
|---|---|---|---|---|---|---|
| Customer profile | C U | — | — | R (rule D25), block if `customers:status`, add (D28) | R U block | Core (customer data copy); app keeps login |
| Customer address | C U | — | — | R | R | Core copy |
| Vendor profile | — | C U (own fields) | — | U if `…:edit`, verify/suspend if `…:status` | U all, commission, move zone | Core |
| Vendor documents | — | C | — | R, verify | R, verify | Core (S3) |
| Vendor hours / open flag | — | C U | — | U on behalf | U | Core |
| Menu items | R (published via app's own catalogue sync or Core read) | C U D | — | U/disable if `menu:edit` | U | Core |
| Partner profile | — | — | C U (own) | U if `delivery:edit`, verify/force offline | U all | Core |
| Partner location | — | — | C (latest only) | R | R | Redis, 15 min |
| Order | C (create, cancel while PLACED) | U (accept/ready) | U (pickup/deliver) | U per permission (assign, cancel, accept on behalf) | U all | **Core** after creation |
| Payment | start attempt | — | COD collected | R, refund within limit | R, approve refunds | Core + gateway |
| Cash settlement | — | — | C (hand-over) | confirm if `settlements:edit` | confirm | Core |
| Zone | R (resolve) | R | R | R | C U | Core |
| Settings, access, commission | — | — | — | — (not grantable) | C U | Core |
| Reviews / tickets | C (P2) | R (P2) | — | — | R (P2) | Core (P2) |

## 3. Identifiers
`external_refs(entity_type, internal_id, client_id, external_id)` with unique `(client_id, entity_type, external_id)`. The app sends its own ids; the Core answers with its UUIDs and the app may store them. Display ids shown to staff (`ZO-100245`) are separate from both. The same real person may use two apps (a vendor owner who is also a customer): they are two entities, linked only by phone number for support lookups (no automatic merge).

## 4. Time and conflicts
- Every inbound event has the app's `occurredAt`; the Core stores `received_at`. State changes use `version`, not clocks. Profile fields from apps use last-write-wins by `occurredAt` per field set, and an older `occurredAt` than the stored `source_updated_at` is ignored (returns 200 with `applied:false`).
- Admin edits to app-owned fields are allowed only for the cases listed above (profile corrections by a member with `:edit`). Such edits set `admin_override_at`; the next app update to that field returns a `warning` and still applies unless the field is in the locked set (commission, status, verification, zone, `admin_disabled`), which apps can never write.

## 5. Initial load and migration (if the apps already hold data)
1. Export vendors, partners, customers, addresses, menu items, open orders from the app side as CSV/JSON in the **import format** (`contracts/examples/import-*.json`).
2. Run the import job in staging (dry run → report → fix), then in production in this order: zones → vendors → menu → partners → customers → addresses → open orders.
3. Imported records get `source=IMPORT`, `verification_status=VERIFIED` only if the file says so.
4. Reconcile counts per zone; sign-off by Super Admin before the apps switch their writes to the Integration API.

## 6. Reconciliation (daily)
A job compares per client: orders received vs orders the app reports (`GET /intake/v1/reconcile?date=` returned by the app side, optional), webhook deliveries vs acknowledgements, and open orders older than expected per state. Differences appear in the Integration Hub as "Needs attention".

## 7. Retention
Inbound/outbound event logs 90 days (payload bodies redacted of phone/email after 30 days), order and ledger data per doc 15. Location points are not stored historically in v1.
