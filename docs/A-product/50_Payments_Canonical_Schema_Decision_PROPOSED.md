# 50 — Payments Canonical Schema Decision (PROPOSED — OWNER APPROVAL REQUIRED)

> **Status: PROPOSED — OWNER APPROVAL REQUIRED. Nothing in this document is implemented, migrated or approved.**
> Created 2026-10-21 from the Payments Phase 2C read-only audit and this Phase 2D preparation task.
> This is a planning artifact only: no code, schema, migration, database record or existing doc was changed to produce it.
> If approved, the decisions below become rows in `docs/A-product/03_Business_Rules_and_Decision_Register.md` (proposed IDs **D62–D66**, next free after D61) and drive follow-up doc PRs (docs 08, 09, 32) — each as a separate, reviewable change.

## 0. Context

Payments today is a **Super-Admin-only, read-only transaction list** over a placeholder `payments` table (migration `20261020120000_payments_foundation`), shipped as M12 Phase 2B. The Phase 2C audit verified the module is correctly integrated for what it is (real `GET /api/v1/payments`, shared Zod contract, 422 envelopes, 15 API + 13 web tests, no demo residue) but **not** a financial system of record. The structural gap versus `docs/B-architecture/08_Database_Schema_and_Data_Dictionary.md` (line 61) is the single decision that gates every later payments milestone (docs 39: M11→M12→M13→M15 sequence).

The Phase 2B doc-32 row (2026-10-21) recorded the **vocabulary** conflicts (SUCCESS/PAID, free-text method) but **not** the structural divergence. This document completes that record and prepares the owner decision. Related but separate defects are in §9.

**Scope of this document:** decisions A–E, a migration impact matrix, an expand–contract plan, a dependency/readiness matrix, defect corrections (as proposals), and proposed implementation phases. **Out of scope:** implementing any of it (explicitly prohibited this phase).

---

## 1. Decision A — Canonical Payments schema (PROPOSED — OWNER APPROVAL REQUIRED)

### 1.1 Current state (evidence)

Shipped `Payment` model (`apps/api/prisma/schema.prisma:64-82`, migration `20261020120000_payments_foundation`):

| Column (Prisma / DB) | Type / constraint |
|---|---|
| `id` / `id` | uuid PK |
| `paymentRef` / `payment_ref` | text, **unique** |
| `orderRef` / `order_ref` | text (string, not null) — **no FK** |
| `customerName` / `customer_name` | text — **denormalized, no FK** |
| `method` | **free text** |
| `amountPaise` / `amount_paise` | int (paise) |
| `refundAmountPaise` / `refund_amount_paise` | int, default 0 — **embedded refund total** |
| `currency` | text, default `INR` |
| `status` | enum `PaymentTransactionStatus` (PENDING, **SUCCESS**, FAILED, PARTIALLY_REFUNDED, REFUNDED) |
| `demo` | boolean, default false — **demo flag on a production table** |
| `createdAt`/`updatedAt` | timestamps; indexes on `status`, `createdAt` |

Missing versus doc 08 line 61 (`payments | id, order_id, provider, provider_payment_id (unique), amount, status, method, idempotency_key (unique), raw_json`): **order FK, provider, provider_payment_id, idempotency_key, raw_json, zone_id** (the last per doc 08 §100 "zone_id NOT NULL on all zone-owned tables" and §92 index convention `(zone_id, created_at DESC)` — the doc-08 payments row is abbreviated; zone ownership follows from doc 39 M12 "transactions in granted zones" and doc 36 TC-AC-3). Also missing the documented companion tables: `refunds` (line 62), `ledger_entries` (line 64), `webhook_events` (line 65), `idempotency_keys` (line 77), `refund_daily_usage` (orders-and-money section), `reconciliation_runs` (line 66), `payouts` (line 63), `cash_settlements` (line 53).

The dev DB currently has zero payment rows — **but production may not; every plan below assumes existing rows and never proposes deletion.**

### 1.2 Option 1 — Adopt doc 08 as the canonical schema (RECOMMENDED)

Target design, element by element (each row is the doc-08 requirement plus the implementation assessment):

| Element | Doc-08 requirement | Assessment / proposal |
|---|---|---|
| **Order linkage** | `order_id` FK → `orders` | Prerequisite: **M11 Orders** (doc 08 `orders` row: `id, order_no (unique), zone_id, … payment_method, payment_sub_method, payment_status, … version`). FK policy: RESTRICT (doc 08 §98 "FKs RESTRICT"). Column lands **nullable** in the expand phase; NOT NULL + FK enforced only after backfill validation (§7). |
| **Provider + provider transaction reference** | `provider`, `provider_payment_id` (unique) | Provider is free text until the gateway is chosen (owner decision; no provider enum is documented anywhere). `provider_payment_id` nullable during expansion. **Sub-decision A4:** global unique (doc-08 literal) vs composite unique `(provider, provider_payment_id)` — composite recommended (different gateways may issue colliding ids); either satisfies doc 16 §3 idempotency control. |
| **Idempotency key** | `idempotency_key` (unique) on payments (and refunds); separate `idempotency_keys` table with 24 h purge (doc 08 line 77; doc 09 line 11; doc 10 §5) | Two layers, both documented: (a) `payments.idempotency_key` UNIQUE — **permanent** uniqueness on the money row (duplicate-payment prevention, doc 16 §3); (b) generic `idempotency_keys` request store (`key, route, user_id, request_hash, response_json, status_code, created_at`, purge after 24 h) for POST replay safety. **Sub-decision A5:** store uniqueness on `key` alone (doc-08 literal) vs `(key, route)` — `(key, route)` recommended so the same client key on different routes cannot collide. |
| **Raw provider payload** | `raw_json` | JSONB, nullable. **Proposed access controls (for approval):** never included in list responses; detail access only via a future audited endpoint (Super Admin); redacted from logs; contents limited to gateway-safe references/tokens — no card data in this column (security posture per doc 13; webhook bodies belong in `webhook_events.payload`, doc 08 line 65 + doc 16 §1). |
| **Zone ownership** | §100 `zone_id NOT NULL` on zone-owned tables; §92 `(zone_id, created_at DESC)` | `zone_id` uuid, denormalized from the order at payment creation, FK → zones RESTRICT. Lands **nullable** during expansion; NOT NULL only when M03/SA-1.7 + M11 exist and backfill resolved every row. Blocks doc 36 TC-AC-3 and D20 zonal refund limits until present. |
| **Integer paise** | "amount (integer paise)" (doc 08 orders money columns; AGENTS money rule) | Already satisfied (`amount_paise int`). **Sub-decision A6 (non-blocking):** keep the repo's `*_paise` naming (`amount_paise`) vs doc-08's literal `amount` column name — `*_paise` recommended for self-documentation; either is paise-integer, never float. |
| **Separate refunds** | `refunds` table (line 62): `id, order_id, payment_id, amount, type, reason_code, reason_note, status (PENDING_APPROVAL, APPROVED, PROCESSED, FAILED, REJECTED), requested_by, requested_at, approved_by, decided_at, decision_note, provider_refund_id, idempotency_key (unique), target (GATEWAY, WALLET, MANUAL)` | Embedded `refund_amount_paise` is **removed only in the contract phase** (§7 step 10); until then it remains a read-only legacy column. Refund totals become `SUM(refunds.amount WHERE status = PROCESSED)`; payment status transitions to PARTIALLY_REFUNDED/REFUNDED per doc 10 §2 and D40. |
| **Demo / denormalized removal** | not in doc 08 | `demo` → quarantined from financial reporting, dropped in contract phase (never deletes rows). `customerName` → replaced by order → customer join with D26 masking; dropped in contract phase. `orderRef` string → replaced by `order_id` + `orders.order_no`; dropped in contract phase. |
| **Explicit method** | `method` + enum `PaymentMethod: ONLINE, COD, WALLET` (doc 08 line 90); orders carry `payment_method` + `payment_sub_method (UPI, CARD, null)` | See Decision C. `payments.method` becomes the enum; optional `sub_method` column is a Decision-C sub-decision. |

**Related tables required by the money pipeline (created in later phases, not in the payments expansion itself):** `orders`/`order_items`/`order_status_history` (M11), `refunds` + `refund_daily_usage` (M13/D20), `ledger_entries` (doc 16 §4), `webhook_events` (doc 16 §1, doc 10 §5), `idempotency_keys`, `payouts` (M15, doc 08 line 63 incl. D44 payee types), `cash_settlements` (doc 16 §2), `reconciliation_runs` (doc 16 §6), `outbox` (doc 10 §6 — "doc 10 required it; v1.0 never defined it", now defined at doc 08 line 76).

**Optional amendment to consider inside Option 1 (sub-decision A3):** keep `payment_ref` (unique, human-readable) as a **display/support reference alongside** `order_id`. Doc 08 does not list it; `orders.order_no` may already serve this purpose. Owner call; if kept, it survives the contract phase.

### 1.3 Option 2 — Formally amend doc 08

If the owner intentionally wants a different shape than doc 08 line 61, the amendment requires: an owner-approved rationale, a doc-32 change row, edits to doc 08 (and ripples to docs 09/10/16 as named below), and re-review of docs 04/36 where the table is referenced. **Amending doc 08 does not by itself make the current table safe for real financial processing.** Retaining the demo-shaped table (or evolving it differently) must still resolve, explicitly, each of:

1. **No order linkage** → doc 16 §3 "Amount integrity" (server computes totals, compares gateway amount to order total) and doc 16 §6 reconciliation are impossible; commissions (doc 16 §5) have no base.
2. **No provider / provider_payment_id / idempotency_key** → doc 16 §3 idempotency and duplicate-payment prevention have nothing to key on; webhook replay (doc 10 §5) cannot be tied to a payment row.
3. **No raw_json / webhook_events** → doc 16 §1 flow (verify signature, re-fetch, mark PAID) has nowhere to record provider evidence.
4. **Embedded refund total** → doc 10 §3 refund machine, doc 16 §3 reason codes / segregation / limits, and doc 16 §4 reversal entries require per-refund records with requester/approver identity.
5. **No zone_id** → doc 36 TC-AC-3 and D20 per-member-per-zone limits cannot be enforced; doc 08 §100 zone isolation is violated.
6. **`customerName` denormalized** → doc 08 orders carry customer via `customer_id`; D26 masking and doc 15 retention policies attach to the customer record, not a payment-row copy.
7. **`demo` flag** → has no place in a production financial table; must at minimum be quarantined and removed.

A legitimate Option-2 amendment is narrower: e.g. keeping `payment_ref` (A3) or adopting `*_paise` column names (A6) while otherwise converging on doc 08. A "keep the demo table as-is" amendment is **not recommended** and should be recorded as accepted financial risk with owner signature if chosen.

### 1.4 Recommendation

**Option 1**, with sub-decisions A3–A6 explicitly approved alongside it. Proposed decision row (for doc 03, after approval):

> **D62 (PROPOSED):** The canonical payments data model is doc 08's `payments` + `refunds` + `ledger_entries` + `webhook_events` (+ `idempotency_keys`, `refund_daily_usage`), reached by expand–contract migration; the shipped demo-shaped table is a placeholder that is retired through that plan, never by deletion of rows.

---

## 2. Decision B — Status vocabulary (PROPOSED — OWNER APPROVAL REQUIRED)

| Source | Vocabulary |
|---|---|
| Doc 08 enums (line 90) | `PaymentStatus: PENDING, PAID, FAILED, REFUNDED, PARTIALLY_REFUNDED` |
| Doc 10 §2 (payment machine) | `PENDING → PAID (verified webhook or COD) | FAILED; PAID → PARTIALLY_REFUNDED → REFUNDED` |
| Doc 16 §1 | "marks **PAID** in a transaction with ledger entries" |
| Doc 24 TC-PAY-1 | "Payment **PAID**…" |
| Shipped schema (`PaymentTransactionStatus`) + `packages/shared/src/payments.ts` + UI pills | `PENDING, **SUCCESS**, FAILED, PARTIALLY_REFUNDED, REFUNDED` |

**Recommendation: `PAID` is canonical** (four independent financial docs agree; `SUCCESS` appears only in the implementation). The hotels `PaymentStatus` enum (doc 08 line 41 section; schema line ~357) is a **separate booking table** and is not conflated.

**Implications (no rename happens in this phase):**

- **Migration:** Postgres enum values cannot be renamed in place. Expand–contract: introduce `PAID` (extend the enum or create the new doc-08-named type alongside), dual-read, backfill `UPDATE … SET status='PAID' WHERE status='SUCCESS'` in batches, drop `SUCCESS` only in the contract phase.
- **API compatibility:** doc 09 line 12 — "additive changes only within v1; deprecations in doc 32". Proposal: accept `status=SUCCESS` as an alias during a deprecation window; responses emit `PAID`; one doc-32 deprecation row. (Renaming a response *value* is a behavioral change; the alias window is the compatibility path.)
- **Shared contract / tests / UI:** `PAYMENT_TRANSACTION_STATUSES`, the integration-test status loop, web `STATUS_TEXT`/`STATUS_PILLS` ("Paid"), and the web status-select labels all move together in one task.

> **D63 (PROPOSED):** Canonical payment status vocabulary is `PENDING, PAID, FAILED, PARTIALLY_REFUNDED, REFUNDED`; `SUCCESS` is a deprecated alias removed in the contract phase.

---

## 3. Decision C — Payment method vocabulary (PROPOSED — OWNER APPROVAL REQUIRED)

| Source | Representation |
|---|---|
| Doc 08 enums (line 90) | `PaymentMethod: ONLINE, COD, WALLET` (high level) |
| Doc 08 orders row | `payment_method (ONLINE, COD, WALLET …)` **and** `payment_sub_method … (UPI, CARD, null)` — a documented **two-level** model |
| Doc 39 M12 (line 50) | "methods UPI/Card/Wallet/COD/Bank Transfer" — listed **flat**, conflating levels |
| Doc 42 intake contract | `payment_method` sent by apps as a **plain string** (app-integration rule: change the contract first) |
| Shipped implementation | free-text `method`; web dropdown offers only values present in loaded data |

**Documented distinction (doc 08 orders row):** the **payment method** is the settlement channel — ONLINE (gateway), COD (cash to partner), WALLET (platform wallet); the **payment sub-method** is the instrument within a channel — UPI or CARD under ONLINE (null otherwise). Doc 39's flat list is consistent with this reading once Wallet stays top-level and "Bank Transfer" is understood as another ONLINE instrument.

**Proposed representation (consistent with doc 08, flagged for approval):**

- `payments.method` → enum `PaymentMethod (ONLINE, COD, WALLET)` — doc 08 literal.
- `payments.sub_method` → nullable enum `(UPI, CARD, BANK_TRANSFER?, null)` — **`BANK_TRANSFER` is an extension beyond doc 08's `(UPI, CARD, null)` and needs owner sign-off**; if declined, bank-transfer rows use `method=ONLINE, sub_method=null` and are distinguishable only via provider data (not recommended).
- Order-level truth stays on `orders.payment_method` / `orders.payment_sub_method` (M11); the payment row records what the provider actually captured and must be reconcilable to the order (doc 16 §3 amount integrity).
- Intake (doc 42) alignment happens via a **contract-first** change in a later phase, not ad hoc mapping.

**Legacy free-text mapping (for the backfill, §7 step 4):** case-insensitive exact matches only — `COD`→COD; `WALLET`→WALLET; `UPI`→(ONLINE, UPI); `CARD`→(ONLINE, CARD). **Anything else goes to a quarantine list for owner/data review; no invented mappings.**

> **D64 (PROPOSED):** Payments use the doc-08 two-level model: `method` ∈ {ONLINE, COD, WALLET} plus nullable `sub_method` ∈ {UPI, CARD, BANK_TRANSFER?, null}; doc 39's flat list is reinterpreted accordingly (doc 39 wording to be clarified in a doc PR).

---

## 4. Decision D — Refunds and financial integrity (PROPOSED — OWNER APPROVAL REQUIRED)

Target relationship: **payments 1—N refunds** (`refunds.payment_id` FK); refunds also carry `order_id`; `ledger_entries` keyed by `order_id` with `ref_type/ref_id` pointing at the payment or refund that produced them; payment `status` becomes PARTIALLY_REFUNDED/REFUNDED only through processed refunds (doc 10 §2, D40: full refund ⇒ order REFUNDED; partial ⇒ order status unchanged, `payment_status = PARTIALLY_REFUNDED`).

Documented requirements (quoted from the docs — **no thresholds invented here**):

| Requirement | Rule | Source |
|---|---|---|
| Ceiling | "Sum refunds ≤ captured" | doc 16 §3 |
| Refund machine | `REQUESTED → (within limit) APPROVED → PROCESSED | FAILED; REQUESTED → PENDING_APPROVAL → APPROVED | REJECTED; FAILED → retry with same idempotency key → PROCESSED` | doc 10 §3 |
| Reason codes | Mandatory: DELAY, QUALITY, WRONG_ITEM, VENDOR_CANCEL, CUSTOMER_REQUEST, OTHER (+ note) | doc 16 §3 |
| Form fields | type full/partial/goodwill; amount ≤ refundable; reasonCode enum; note required if OTHER | doc 22 |
| Segregation | Requester ≠ approver; approvals Super Admin (`refunds:approve`) | doc 16 §3; doc 09 line 95 |
| Re-authentication | Required for refund approval and payment settings; `requireRecentReauth` middleware already exists in `apps/api/src/middleware/authenticate.ts` but is unused by payments | doc 16 §3; doc 14 §4; code evidence |
| Zonal refund limits | "limits set **per member per zone** on the assignment (defaults INR 1,000/refund and INR 5,000/day from the Access Profile, D13/D20; `refund_daily_usage` per assignment); above or none granted → Super Admin approval" | doc 16 §3; D20 (changed v1.2); D13 (**still Assumed** — confirm before relying on the default values) |
| Idempotency | Refunds: unique `idempotency_key`; gateway call includes it | doc 10 §5 |
| Ledger | Append-only; corrections via reversing entries; balanced debit/credit sets at capture; refunds create reversal entries; accounts: Customer receivable/cash, Platform revenue, Vendor payable, Delivery payable, Tax payable (GST), Refund expense | doc 16 §3–§4 |
| Audit | "Every payment, refund, approval, payout and setting change is audited with before/after values" | doc 16 §8 |
| Events | `refund.requested / approved / processed / failed` → ledger, notifications (via outbox) | doc 10 §6 |

> **D65 (PROPOSED, composite):** Refunds follow doc 08's `refunds` table + doc 10 §3 machine + doc 16 §3 controls verbatim; D13's INR 1,000/5,000 defaults are confirmed-or-replaced by the owner at that time; ledger entries are written in the same transaction as capture/refund state changes.

---

## 5. Decision E — Zone scoping (PROPOSED — OWNER APPROVAL REQUIRED)

**Prerequisite chain:** M03/SA-1.7 `admin_zone_assignments` (Access Profile + GRANT/DENY + limits per member per zone) → `orders.zone_id` (M11) → `payments.zone_id` denormalized from the order → `payments:view` permission wiring (`can(ctx, 'payments:view', zoneId)`, `zonesFor`) replacing today's `requireSuperAdmin` stand-in.

**Documented targets:**

- Permission key `payments:view` on `GET /payments, /payments/{id}` (doc 09 line 93); matrix "Payments (transactions) | V | V | V" and Karthik example "has `payments:view` denied everywhere" (doc 04 lines 24, 39); Finance View profile includes payments (doc 04 line 20).
- **TC-AC-3** (doc 36 line 72): "`payments:view` denied by override in A and B → Payments endpoints return **empty/404**; sidebar item and **revenue tiles hidden**."
- Zone-scope conventions (doc 09 lines 8–9): effective scope = requested ∩ assigned; unknown zone → 404 `ZONE_NOT_FOUND`; missing action on write → 403. Read of an unviewable module → 404 (AGENTS).

**Current state:** `requireSuperAdmin` (403 for any Zonal Admin) on all payments routes; no `zone_id` column; no repository scope filter (`_ctx` placeholder); sidebar always visible for Super Admins only via layout gate. This is the same documented stand-in as customers/vendors (doc 32 TD-18/TD-32 seam).

**Must be resolved before enabling Zonal Admin access (each is a gate):**

1. `admin_zone_assignments` migrated and populated (M03/SA-1.7 — currently unmigrated, cross-module blocker).
2. `payments.zone_id` added, backfilled, then NOT NULL; index `(zone_id, created_at DESC)` (doc 08 §92).
3. Router: `requireAuth` + `requirePermission('payments:view')` replacing `requireSuperAdmin`; controller keeps defense-in-depth check.
4. Repository: always filter by `effectiveZoneIds`; aggregates, CSV export and any future KPI counts use the same scope (AGENTS scope rule).
5. TC-AC-3 test matrix: SuperAdmin, Admin(A), Admin(A+B), Admin(none) — denied zones return empty/404, not 403 (read), per doc 36.
6. UI: sidebar entry and revenue tiles driven by `zonesFor('payments:view')` (UX only; server enforces).
7. Refund limits read from the assignment row (D20) — only relevant once M13 exists.
8. Future detail/reveal endpoints inherit the same scope (doc 09 line 93's `GET /payments/{id}` included).

> **D66 (PROPOSED):** Zonal access to payments is enabled only after the D62 schema carries `zone_id` and M03/SA-1.7 lands; enforcement is `payments:view` per doc 09/04/36 with TC-AC-3 semantics (denied read → empty/404), never UI hiding alone.

---

## 6. Migration impact matrix

Assumes production rows may exist. **No step deletes records.** Columns: current → target, with risk and sequencing.

| Current field/model | Approved target (Option 1) | Required data transformation | FK / uniqueness | Back-compat risk | Dependency | Sequencing | Rollback / recovery |
|---|---|---|---|---|---|---|---|
| `id` (uuid PK) | `id` uuid PK | none | PK | none | — | keep | n/a |
| `payment_ref` (unique) | keep (A3) **or** drop in contract phase; display ref may become `orders.order_no` | none if kept | unique retained | Low (UI/tests reference it; q-search uses it) | owner A3 | decide at step 1; drop only at step 10 | re-add column from backup export if wrongly dropped |
| `order_ref` (text) | `order_id` uuid FK → `orders` (+ `orders.order_no` for display) | lookup `order_ref = order_no` where an order exists; unmatched → quarantine list (no auto-link, no delete); column kept (read-only) until step 10 | FK RESTRICT; not null only at step 9 | **High** — no orders table exists yet; wrong links corrupt amount integrity | **M11 Orders** (model + stable `order_no`) | additive nullable `order_id` (step 3) → backfill (4, 8) → FK/NOT NULL (9) → drop `order_ref` (10) | keep `order_ref` untouched; new column additive; old code ignores it |
| `customer_name` (text) | removed; customer via order → customers (D26 masking on reads) | none at migration time; UI switches to order-join when M11+M09 data available | FK via orders | Medium (list loses a display column until join lands) | M11 + M09 | drop only at step 10; API keeps field until then | column persisted in backups; contract-phase only |
| `method` (free text) | `method` enum (ONLINE/COD/WALLET) + `sub_method` enum (D64) | exact-match mapping table (§3); unmapped values → quarantine for review; never guess | CHECK/enum constraint at step 9 | Medium (API filter accepts legacy strings during window; unknown values must not 500) | D64 approval | additive nullable columns (3) → backfill (4, 8) → enum enforcement (9) | keep raw string in a legacy column until step 10 if any unmapped rows remain |
| `amount_paise` (int) | `amount_paise` int NOT NULL, CHECK ≥ 0 (A6 naming) | none — **invariant: sum unchanged**; verified in every backfill batch | CHECK at step 9 | Low | — | validate (6, 8) then CHECK (9) | any batch that breaks the sum invariant halts the run (stop condition §7) |
| `refund_amount_paise` (int) | removed; derived from `SUM(refunds.amount WHERE PROCESSED)` | keep column read-only until M13 refunds exist; do not backfill a refunds table from it blindly (no reason codes/approver data exists) | — | Medium (UI sub-line reads it today) | M13 | drop only at step 10 after UI reads derived value | restore from backup if needed |
| `currency` (text, default INR) | keep, NOT NULL; optional CHECK (length 3, uppercase) at step 9 | none | CHECK | Low | — | step 9 | drop constraint only |
| `status` (`SUCCESS` enum) | `PAID` vocabulary (D63) | dual-read → batched `UPDATE … 'SUCCESS'→'PAID'` → drop `SUCCESS` (step 10) | enum type | Medium (`status=SUCCESS` queries; UI pills; tests) | D63 approval | new enum alongside (3) → backfill (4, 8) → drop old value (10) | dual-read window means old code keeps working |
| `demo` (boolean) | removed (contract phase) | rows with `demo=true` quarantined from financial reports until removed; **rows never deleted** | — | Low | — | report-quarantine immediately after approval; drop column step 10 | restore column from backup if quarantined wrongly |
| `created_at`/`updated_at` | keep; secondary index `(zone_id, created_at DESC)` added with zone_id | none | index | none | zone_id (M03/M11) | index with step 9 (or with zone backfill) | drop index only |
| — (new) `order_id` | uuid, nullable → FK RESTRICT → NOT NULL | backfill from `order_ref` | FK | — | M11 | step 3 → 4/8 → 9 | additive; safe to leave nullable |
| — (new) `provider` | text (no documented enum; gateway unknown) | backfilled once provider chosen; nullable until then | — | — | provider selection (owner) | step 3 (column), 8 (values) | additive |
| — (new) `provider_payment_id` | text, nullable | from gateway data as it arrives | unique (A4: global or composite) | — | gateway + webhooks | column step 3; unique at step 9 (partial index) | additive |
| — (new) `idempotency_key` | text, nullable for legacy rows | new payments only | unique | — | idempotency middleware | column step 3; unique step 9 | additive |
| — (new) `raw_json` | JSONB nullable | new captures/webhooks only | — | — | webhooks | step 3+ | additive |
| — (new) `zone_id` | uuid nullable → NOT NULL; FK zones RESTRICT | backfill via order → `orders.zone_id` | FK + NOT NULL at step 9 | — | M03 + M11 | step 3 → 4/8 → 9 | additive until step 9 |
| — (new) `sub_method` | nullable enum | from method mapping (D64) | CHECK at 9 | — | D64 | step 3 → 4/8 → 9 | additive |
| `payments` table (whole) | stays the money table (renaming **not** proposed — no benefit, high churn) | — | — | — | — | — | — |
| — (missing models) `refunds`, `ledger_entries`, `webhook_events`, `idempotency_keys`, `refund_daily_usage`, `outbox`, `payouts`, `cash_settlements`, `reconciliation_runs` | new tables per doc 08 (lines 53, 62–66, 76–77) | created empty in their own module phases (M13, M15, integration, COD) | per doc 08 | none (additive) | own milestones §8 | their own tasks | standard backup/restore |

---

## 7. Safe expand–contract migration plan (STAGED — DO NOT EXECUTE YET)

Doc 08 §103 already mandates "Prisma Migrate; expand-then-contract". Ten steps, each with stop conditions and recovery. **No step is executed in Phase 2D.**

1. **Approve target schema + vocabulary.** Owner signs D62–D66 (incl. A3–A6). → *Stop if any sub-decision is open; recovery: iterate this doc, no code.*
2. **Confirm canonical Orders model + stable identifier.** M11 spec fixes `orders.id` (uuid PK) and `orders.order_no` (unique, searchable). → *Stop if orders design is in flux; recovery: hold payments expansion — never backfill against an unstable identifier.*
3. **Additive schema migration (expand).** New nullable columns (`order_id, provider, provider_payment_id, idempotency_key, raw_json, zone_id, sub_method`), new enum types created **alongside** the old (`PaymentStatus` with PAID etc.), partial unique indexes prepared but **uniqueness enforced only at step 9** where legacy duplicates could exist, new empty tables for `webhook_events`/`idempotency_keys` only when their consumer code lands. **No NOT NULL, no FK enforcement, no column drops, no value rewrites.** → *Stop: any failure on a staging clone of production-shaped data; any lock that would block writes beyond the deploy window; recovery: abandon the migration file (unapplied), fix, re-plan — never edit an applied migration (AGENTS).*
4. **Reconciliation / backfill design (dry-run first).** Idempotent, batched (e.g. 500 rows), logged script: `order_ref → orders.order_no` exact match; method mapping table (§3); `SUCCESS` dual-read. Unmatched rows → quarantine report (never auto-linked, never amount-touched, never deleted). → *Stop: any unmatched row or amount-sum variance; recovery: expand the quarantine list; owner/data review; rerun is safe because the script is idempotent.*
5. **Compatible API + shared-contract changes.** Requests accept legacy and new vocabularies (status alias `SUCCESS`/`PAID`; method filter accepts legacy strings); responses keep every existing field (`customerName`, `refundAmountPaise`, `status` values per alias window) until the contract phase; new fields appear additively. Deprecations noted in doc 32 (doc 09 line 12). Deploy order: **additive DB → API → web** (web changes minimal/none in this step). → *Stop: any 4xx/5xx regression in the integration suite; recovery: redeploy previous API build (old code ignores additive columns — safe).*
6. **Validate on an isolated test database.** Run the migration + backfill against `TEST_DATABASE_URL` fixtures that include every legacy shape: `status=SUCCESS`, free-text methods incl. unmapped values, `demo=true`, `refund_amount_paise>0`, `order_ref` with and without a matching order, attempted duplicate `provider_payment_id`. Full suites: payments integration (15+), web unit (13+), lint, typecheck. → *Stop: any red test; recovery: fix forward before any prod touch.*
7. **Deploy compatible code and schema in documented order.** Expand migration applied; API with dual-read deployed; monitor error rates, `X-Request-Id`-tagged reports, and payments list p95 for a soak window. → *Stop: error-budget breach; recovery: roll back the API build only; schema remains (additive, harmless).*
8. **Backfill + validate production records (if any).** Batched, resumable, audited run; after each batch assert `SUM(amount_paise)` invariant and row-count conservation; publish the quarantine report to the owner. → *Stop: invariant break or quarantined-count above owner-set tolerance (default: any quarantined row blocks step 9); recovery: halt, investigate, rerun remaining batches idempotently.*
9. **Introduce stricter constraints only after validation + sign-off.** `NOT NULL order_id/zone_id/method/amount`, FK enforcement, enum checks, CHECK ≥ 0, partial uniques on `provider_payment_id`/`idempotency_key`, index `(zone_id, created_at DESC)`. → *Stop: any NULL/unmapped row still exists; recovery: complete quarantine remediation first — constraints are never added "to catch" bad data in prod.*
10. **Contract phase (separate approval, separate task).** Drop `demo`, `customerName`, `refund_amount_paise`, `order_ref`, legacy status value `SUCCESS`, legacy method strings; remove API aliases; update docs 09/22 + shared contract + UI; add the `GET /payments/{id}` detail endpoint per doc 09 line 93 (fixing §9 defect 1). → *Stop: owner has not approved the contract change; recovery: aliases simply remain (no harm).*

**Global stop conditions:** any unapproved decision in D62–D66; any need to edit an applied migration; any destructive SQL; any plan that deletes rows; discovery of production rows that the quarantine process cannot classify. **Global recovery:** expand–contract means every earlier step is forward-compatible with the *previous* release; the only irreversible moment is step 10 (drops) — which is also the only step that requires its own approval gate.

---

## 8. Dependency and readiness matrix

Status assessed from **actual code and docs** on branch `feature/m06-m07-restaurants-homemakers` @ `85c1211` + working tree (2026-10-21). "Documented" ≠ implemented.

| Dependency | Required prerequisite | Evidence (code) | Evidence (docs) | Owner / module | Readiness |
|---|---|---|---|---|---|
| **M11 Orders** | `orders` model with `id` + `order_no` (unique) + `zone_id` + amounts + `payment_method/sub_method/payment_status` + `version` | **No `Order` model** in `schema.prisma` (grep); `apps/api/src/modules/orders/` contains only `.gitkeep`; not mounted in `app.ts` | doc 08 line 57 orders row; doc 39 line 49 (M11 P0, "details gap"); sequence line 140 `M09 → M11 → M12 → M13 → M15` | Owner + Orders lane (doc 38/40) | **NOT STARTED — hard blocker** for `order_id` FK and amount integrity |
| **Payment provider selection + credentials** | Gateway choice, sandbox creds, provider naming for `payments.provider` | No gateway env keys in `.env` names (NODE_ENV…S3/AWS only); no provider-adapter code; `third_party_providers.integrationStatus` is a **flag only**, no credentials field | doc 08 line 61 `provider`; doc 16 §1 flow; doc 39 M12 "Signed webhooks" | **Owner** | **NOT STARTED — owner decision required** |
| **Signed webhook endpoint + raw-body signature verification** | `POST /webhooks/payments/{provider}` verifying against **raw body** before JSON parse; store payload in `webhook_events` | No webhook route/module anywhere in `apps/api/src` (grep); not mounted | doc 09 line ~105 "POST /webhooks/payments/{provider} | signature | public"; doc 16 §3 "verify against raw body" | Payments + infra | **NOT STARTED** |
| **Webhook replay protection** | `webhook_events.event_id` unique; duplicate → 200, no-op | No `WebhookEvent` model | doc 08 line 65; doc 10 §5 | Payments | **NOT STARTED** |
| **Idempotency** | `Idempotency-Key` middleware; `idempotency_keys` table (24 h purge); payments/refunds keys unique | **Zero** idempotency code in `apps/api/src` (grep, Phase 2C) | doc 09 line 11; doc 08 line 77; doc 10 §5 | Shared/API foundation | **NOT STARTED** |
| **M03 / SA-1.7 zone permissions** | `admin_zone_assignments`; access profiles; `can`/`zonesFor` | **No `AdminZoneAssignment` model**; payments router `requireSuperAdmin`; `_ctx` placeholder in repository | doc 39 line 33 (M03 P0 "gap"); doc 08 §104 seed mentions the assignment fixtures; handoffs flag SA-1.7 blocker | Owner + Access lane | **NOT STARTED — cross-module blocker** for zone_id NOT NULL and TC-AC-3 |
| **M13 Refunds** | `refunds` + `refund_daily_usage`; machine; approvals; re-auth | No `Refund` model; `modules/refunds/` only `.gitkeep`; not mounted | doc 08 line 62; doc 10 §3; doc 16 §3; doc 39 line 51 (M13, "partly (Recent Refunds widget)") | Owner + Refunds lane | **NOT STARTED (scaffold dir only)** |
| **Ledger + audit events** | `ledger_entries` append-only; capture/refund write balanced sets; outbox events | No `LedgerEntry`/`Outbox` models; `AuditLog` model **exists and is used** by other modules — payments (read-only today) writes none, correctly | doc 08 lines 64, 76; doc 16 §4; doc 10 §6 (`payment.captured/failed`, `refund.*`) | Payments + finance | **PARTIAL — audit infra exists; ledger/outbox absent** |
| **M16 (Dashboards) / notifications** | Revenue tiles from scoped aggregates; payment events → notifications | `Notification` model (schema ~677) + `modules/notifications` **shipped** (list/unread-count/stream/markRead/markAllRead, `requireAuth`); **no producer** wires payments/refunds into notifications; no Socket.IO payment rooms | doc 39 line 58: **M16 = Dashboards** (P0, "after M11 and M12 revenue tiles"); doc 08 line 71 notifications table; doc 10 §6 consumers "notifications" | Dashboard/notification lanes | **PARTIAL — inbox exists; payment producers/tiles absent.** Note: the task's "M16 Notifications" label drifts from doc 39 (M16 = Dashboards; notifications are a separate concern) — flag for doc-alignment, no action taken |
| **M15 Payouts** | `payouts` (D44 payee types), weekly generation, mark-paid (Super Admin) | No `Payout` model; no payouts routes | doc 08 line 63; doc 16 §5–§7; doc 39 line 53 (M15 P1) | Owner + Payouts lane | **NOT STARTED** |
| **COD settlements** | `cash_settlements`; partner `cash_in_hand` maintenance | `DeliveryPartner.cashInHand` column **exists** (schema ~605, comment: "maintained by the orders pipeline once M11 lands"); `modules/cash-settlement/` only `.gitkeep`; no settlement routes | doc 08 line 53; doc 16 §2; doc 09 "GET/POST /cash-settlements | settlements:*" | COD lane | **PARTIAL — one column exists; table/flows absent** |
| **Reconciliation** | Daily provider-vs-payments job; 48 h alerts | No `ReconciliationRun` model; no jobs | doc 08 line 66 (marked "?"); doc 16 §6 | Payments + ops | **NOT STARTED** |
| **Payments detail endpoint** | `GET /payments/{id}` | Router mounts **only** `GET /` | **Documented** at doc 09 line 93 (`payments:view`) — but claimed absent by the UI comment (§9 defect 1) | Payments | **DOCUMENTED, UNIMPLEMENTED** |
| **Payments e2e tests** | Playwright journey for the list (login → filter → view → export) | `tests/e2e/` contains customers-partners, hotels-menu, vendors, zone-management — **no payments spec** | AGENTS testing rule ("Playwright flow for new journeys"); doc 24 | Payments | **NOT STARTED** |

---

## 9. Audit defects and minimal corrections (PROPOSED — do not edit now)

**Defect 1 — inaccurate doc-09 claim (two locations).**
`apps/web/features/payments/payments-screen.tsx` (JSDoc, lines ~111–117) states: *"doc 09 defines no `GET /payments/{id}` in v1, so no detail fetch is invented."* Doc 09 **line 93** documents `GET | /payments, /payments/{id} | payments:view`. The same claim appears in the Phase 2B row of `docs/E-quality-ops/32_Technical_Debt_and_Change_Log.md` (2026-10-21: "View dialog from the list row since doc 09 defines no `GET /payments/{id}`"). The endpoint is **documented but unimplemented** — the dialog behavior (render the list row, no invented fetch) remains correct; only the citation is wrong.
*Minimal correction (future task, not now):* (a) reword the comment to "doc 09 documents `GET /payments/{id}`, but it is not implemented yet; the dialog renders the list row until then"; (b) one doc-32 correction row noting the citation fix. Doc 09 itself needs **no** change for this defect.

**Defect 2 — structural schema divergence.** The shipped `Payment` table (§1.1) vs doc 08 line 61 (+ §92/§100 conventions and companion tables). *Minimal correction:* resolve via Decision A — Option 1 migration plan (§7) or an owner-signed Option 2 amendment (§1.3). Until then, the divergence remains recorded here (this doc) because existing docs must not be overwritten in this phase.

---

## 10. Proposed implementation phases and acceptance criteria (post-approval only)

| Phase | Content | Acceptance criteria |
|---|---|---|
| **2E — Docs & decisions** | Owner signs D62–D66; add rows to doc 03; doc-08 alignment PR (or amendment); doc-32 rows; fix §9 defect 1 | Owner approval recorded; docs lint/review; no code yet |
| **F1 — Orders (M11)** | Canonical orders model + module (separate lane per doc 38) | Orders CRUD + state machine per docs 09/10; `order_no` unique; integration tests; payments untouched |
| **F2 — Payments expansion** | §7 steps 3–6: additive columns/enums, backfill tooling, test-DB validation | Migration applies cleanly on staging-shaped clone; backfill idempotent; suites green; no NOT NULL yet |
| **F3 — Vocabulary migration** | §7 steps 4/8 portions for status→PAID and method enums; API alias window; UI labels | Dual-read verified; alias window documented in doc 32; TC-PAY list tests updated |
| **F4 — Gateway + webhooks + idempotency** | Provider adapter; `POST /webhooks/payments/{provider}` raw-body verify; `webhook_events`; `idempotency_keys` middleware; `payment.captured/failed` outbox events | Doc 24 TC-PAY-1..4 pass (happy, bad signature, replay, amount mismatch); doc 16 §1 flow end-to-end in sandbox |
| **F5 — Zone scoping** | M03/SA-1.7 + `payments.zone_id` NOT NULL + `payments:view` + scoped repository/export | TC-AC-3 matrix green (SuperAdmin, Admin(A), Admin(A+B), Admin(none)); sidebar/tiles hidden for denied |
| **F6 — Refunds + ledger (M13)** | `refunds`, `refund_daily_usage`, machine, approvals, re-auth, `ledger_entries` at capture/refund | Doc 10 §3 machine tests; D20 limits enforced; requester≠approver; ledger balanced sets; audit before/after |
| **F7 — Contract phase** | §7 step 10 drops + `GET /payments/{id}` + scoped KPI aggregates replacing the five placeholder cards | Owner-approved contract change; doc 09/22 updated; e2e spec added; full gates: `pnpm lint && pnpm -r typecheck && pnpm -r test` (payments suites) |

Every phase follows AGENTS: ≤ ~5 files per task (except schema waves), Zod in `packages/shared`, authorization tests per endpoint, doc-32 row per change, handoff block appended.

---

## 11. Risks, unknowns, and stop conditions

**Risks.** (1) Postgres enum transitions are the fiddliest step — mitigated by dual-type expand, never in-place rename. (2) Backfill mis-links (`order_ref` → wrong order) would corrupt amount integrity — mitigated by exact-match-only + quarantine + owner review. (3) Production row shape unknown (the dev DB is empty but prod may not be) — every step assumes rows exist. (4) M03 slip delays `zone_id NOT NULL` and TC-AC-3 indefinitely — column lands nullable, enforcement deferred, no blocking of F2. (5) Doc 39 vs doc 08 method conflation could confuse implementers — D64 wording must land in both docs. (6) D13 refund defaults (1,000/5,000) are still **Assumed** — must not be hard-coded as confirmed. (7) Two-lane drift: another lane could touch `schema.prisma` — migrations stay additive and reviewable per doc 38.

**Unknowns (owner).** Gateway/provider choice; A3 paymentRef retention; A4 unique scope; A5 idempotency key scope; A6 column naming; BANK_TRANSFER sub-method; whether any `demo=true` or unmapped-method rows exist in production; confirmation/replacement of D13 defaults; M16 naming drift (Dashboards vs "Notifications").

**Stop conditions (consolidated).** Any unapproved D62–D66 item; any applied-migration edit; any destructive SQL or row deletion; any invariant break during backfill; any red suite at step 6; any quarantine row blocking step 9 without owner tolerance; any need to weaken auth/validation/zone rules to make the plan fit.

---

## 12. Approval checklist (owner)

- [ ] **Decision A:** Option 1 (doc 08 canonical) ☐ / Option 2 (amendment — attach rationale) ☐
- [ ] **A3** paymentRef retention: keep ☐ / retire ☐
- [ ] **A4** provider ref uniqueness: global ☐ / composite (provider, id) ☐ (recommend composite)
- [ ] **A5** idempotency store uniqueness: key ☐ / (key, route) ☐ (recommend (key, route))
- [ ] **A6** amount column naming: `amount_paise` ☐ / `amount` ☐ (recommend `amount_paise`)
- [ ] **Decision B (D63):** PAID canonical with SUCCESS alias window ☐
- [ ] **Decision C (D64):** two-level method + sub_method; BANK_TRANSFER included ☐ / excluded ☐
- [ ] **Decision D (D65):** refunds/ledger per docs 08/10/16 verbatim; **D13 defaults confirmed** ☐ / replaced: ______
- [ ] **Decision E (D66):** zone scoping gates as listed ☐
- [ ] **Defect 1 corrections** (comment + doc 32 row) approved for a future task ☐

---

## Appendix — evidence index

Schema/code: `apps/api/prisma/schema.prisma:40-82` (enum + Payment), `~605` (cashInHand), `~677` (Notification); migration `20261020120000_payments_foundation`; `apps/api/src/app.ts:39-52` (mounts — no orders/refunds/cash-settlement); `apps/api/src/modules/{orders,refunds,cash-settlement}/.gitkeep`; `apps/api/src/modules/notifications/*` (shipped, read-only); `apps/web/features/payments/payments-screen.tsx:111-117` (defect 1); `packages/shared/src/payments.ts`; `tests/e2e/` (no payments spec).
Docs: 08 lines 53, 57, 61-66, 76-77, 90, 92-98, 100-104; 09 lines 7-12, 93, 95, ~105; 10 §2, §3, §5, §6; 16 §1-§8; 03 lines 23 (D13), 34 (D20), 54 (D40), 84 (D61 latest); 04 lines 20, 24, 39; 36 line 72 (TC-AC-3); 39 lines 33, 49-53, 58, 138-142; 32 (Phase 2B row, 2026-10-21); 24 (TC-PAY-1..4); 42 (intake payment_method string).
