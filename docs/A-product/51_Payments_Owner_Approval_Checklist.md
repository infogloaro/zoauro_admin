# 51 — Payments Owner Approval Checklist (PROPOSED — OWNER SIGN-OFF REQUIRED)

> Companion to `docs/A-product/50_Payments_Canonical_Schema_Decision_PROPOSED.md`. Created 2026-10-21 (Phase 2E) after re-verifying every citation in doc 50 against the live repository and docs.
> **No decision below is approved.** Nothing is implemented, migrated or staged. Sign-off fields stay empty until the owner writes them.
> Evidence basis: branch `feature/m06-m07-restaurants-homemakers` @ `85c1211` + working tree, re-checked 2026-10-21 (git log, migrations list, full Prisma model/enum inventory, module directories, app.ts mounts, tests/e2e listing).

## How to read the categories

| Tag | Meaning |
|---|---|
| **[M] Mandated** | Already required by approved documentation (docs 08/09/10/16/04/36). Sign-off means "proceed as documented" — the audit recommends no deviation. |
| **[R] Recommended** | Technical-audit recommendation with real alternatives; owner chooses. |
| **[O] Owner-only** | No approved document answers this; only the owner can decide. |
| **[B] Blocked** | May be pre-decided now, but implementation is blocked by the named dependency. |

---

## 1. Approval checklist

### Decision A — Canonical payments schema (doc 50 §1)

| ID | Decision | Cat. | Recommendation | Alternatives | Consequence if deferred / rejected | Blocked by | Sign-off |
|---|---|---|---|---|---|---|---|
| **A** | Canonical schema direction | [R] | **Option 1**: adopt doc 08 `payments` (line 61) + companions, via expand–contract | Option 2: formally amend doc 08 (requires rationale + doc 08/09/16 edits; does **not** make the demo table financially safe — doc 50 §1.3 lists the 7 things any alternative must still resolve) | No payments milestone (F2–F7) can start; TC-AC-3, D20 limits, reconciliation all stay blocked | — | ☐ Approve Option 1 ☐ Choose Option 2 ☐ Amend — attach rationale — initials/date: ______ |
| **A3** | Keep `payment_ref` as unique display reference? | [O] | Retire in contract phase — `orders.order_no` (doc 08) already serves as the human reference | Keep `payment_ref` as an additional unique column (doc-08 amendment) | UI/q-search keeps working either way; decide before F7 drops | A (Option 1) | ☐ Keep ☐ Retire ☐ Decide later — initials/date: ______ |
| **A4** | `provider_payment_id` uniqueness scope | [R] | **Composite `(provider, provider_payment_id)`** (different gateways may issue colliding ids; still satisfies doc 16 §3 idempotency) | Global unique (doc 08 literal) | Unique-index type chosen at F2 step 9; wrong choice = painful rebuild | A | ☐ Composite ☐ Global ☐ Decide later — initials/date: ______ |
| **A5** | Generic idempotency-store key scope | [R] | **`(key, route)`** | `key` alone (doc 08 line 77 literal) | Affects the future `idempotency_keys` table only (F4); payments-row key is separately unique either way | A | ☐ (key, route) ☐ key ☐ Decide later — initials/date: ______ |
| **A6** | Amount column naming | [R] | `amount_paise` (repo convention: all money columns carry the paise suffix) | `amount` (doc 08 literal; value is paise either way) | Cosmetic; decide before F2 migration file is drafted | A | ☐ amount_paise ☐ amount — initials/date: ______ |

### Decision B — Status vocabulary (doc 50 §2)

| ID | Decision | Cat. | Recommendation | Alternatives | Consequence | Blocked by | Sign-off |
|---|---|---|---|---|---|---|---|
| **B / D63** | Canonical statuses `PENDING, PAID, FAILED, PARTIALLY_REFUNDED, REFUNDED`; `SUCCESS` = deprecated alias | **[M]+[R]** | **PAID** — mandated by docs 08 (enums), 10 (§2), 16 (§1), 24 (TC-PAY-1); `SUCCESS` exists only in migration `20261020120000_payments_foundation` + shared contract + UI. Alias window + doc-32 deprecation row required (doc 09 line 12 "additive within v1"); coordinated deploy of API+web (in-repo consumers only — payments is not on the external integration API) | Keep `SUCCESS` (would amend 4 approved docs) | Vocabulary drift persists; F3 cannot run; docs and code stay split | — | ☐ PAID + alias window ☐ Keep SUCCESS (attach doc-amendment plan) — initials/date: ______ |

### Decision C — Payment method vocabulary (doc 50 §3)

| ID | Decision | Cat. | Recommendation | Alternatives | Consequence | Blocked by | Sign-off |
|---|---|---|---|---|---|---|---|
| **C / D64a** | Two-level model: `method` ∈ {ONLINE, COD, WALLET} + nullable `sub_method` ∈ {UPI, CARD, null} | **[M]** | As documented — doc 08 orders row + enums line 90; doc 39 M12's flat list is reinterpreted, not invented | Flat single enum (would amend doc 08's orders design) | Order/payment method truth cannot reconcile (doc 16 §3 amount integrity) | — | ☐ As documented ☐ Amend — initials/date: ______ |
| **C / D64b** | Add `BANK_TRANSFER` as a `sub_method` value? | **[O]** | **Excluded by default** (beyond doc 08's `(UPI, CARD, null)`); bank-transfer captures use ONLINE + null unless approved | Include `BANK_TRANSFER` | One-line enum extension now vs migration later; decide before F2 step 9 | D64a | ☐ Include ☐ Exclude ☐ Decide later — initials/date: ______ |

### Decision D — Refunds and ledger (doc 50 §4)

| ID | Decision | Cat. | Recommendation | Alternatives | Consequence | Blocked by | Sign-off |
|---|---|---|---|---|---|---|---|
| **D / D65a** | Refund/ledger controls verbatim: doc 08 `refunds` table; doc 10 §3 machine; doc 16 §3 ceiling ≤ captured, reason codes, requester ≠ approver, re-auth, append-only ledger with reversal entries; unique refund `idempotency_key` passed to gateway | **[M]** | As documented — nothing invented | Any deviation requires amending docs 08/10/16 | F6 cannot be specified | A, A5 | ☐ As documented ☐ Amend — initials/date: ______ |
| **D / D65b** | **D13 refund limit defaults** (INR 1,000/refund, INR 5,000/day per member per zone) | **[O]** | **Confirm or replace** — D13 is still marked *Assumed* in doc 03 line 23; D20 made limits per-member-per-zone but kept the assumed numbers | Any owner-set numbers; or "no default — Super Admin sets every assignment" | F6 cannot hard-code limits until confirmed; doc 03 row must be updated when decided | D65a | ☐ Confirm 1,000 / 5,000 ☐ Replace with: ______ ☐ No defaults — initials/date: ______ |

### Decision E — Zone scoping (doc 50 §5)

| ID | Decision | Cat. | Recommendation | Alternatives | Consequence | Blocked by | Sign-off |
|---|---|---|---|---|---|---|---|
| **E / D66** | Zonal access only after `payments.zone_id` NOT NULL + `payments:view` wiring + TC-AC-3 matrix (denied read → empty/404, tiles hidden); `requireSuperAdmin` stand-in until then | **[M]** | As documented — doc 09 line 93 (`payments:view`), doc 04 lines 20/24/39, doc 36 line 72 (TC-AC-3) | (none safe — weakening auth is prohibited) | Zonal Admin access stays blocked; revenue tiles stay Super-Admin-only | **M03/SA-1.7** (`admin_zone_assignments` unmigrated) | ☐ As documented — initials/date: ______ |

### Process approvals

| ID | Decision | Cat. | Recommendation | Sign-off |
|---|---|---|---|---|
| **G1** | Gateway / payment-provider selection (name + sandbox credentials) — **owner-only**; blocks F4 entirely | [O] | Choose before F4; until then `payments.provider` stays a nullable text column (no provider enum is documented anywhere) | Provider: ______ ☐ Decided ☐ Later — initials/date: ______ |
| **G2** | Defect-1 corrections approved for a future task: reword `payments-screen.tsx` JSDoc (~lines 111–117) and add one doc-32 correction row ("doc 09 line 93 **does** document `GET /payments/{id}`; the endpoint is simply unimplemented") | [R] | Approve both one-line corrections; no doc-09 change needed | ☐ Approve ☐ Reject — initials/date: ______ |
| **G3** | Safeguard adoption: production-data **inventory gate** made an explicit numbered step before any backfill (doc 50 §7 implies it via dry-run/quarantine but does not number it; see §5 of this checklist) | [R] | Adopt as written in §5–§6 below | ☐ Adopt — initials/date: ______ |
| **G4** | M16/M17 naming alignment: notifications shipped as **M17** (migration `20261020053441_m17_notifications`); doc 39 M16 = Dashboards. Any future doc row must use M17 for the notifications inbox | [R] | Note only; no doc edit in this phase | ☐ Noted — initials/date: ______ |

---

## 2. Confirmed dependency status (evidence, 2026-10-21 re-verification)

| Dependency | Status | Evidence |
|---|---|---|
| **M11 Orders + canonical order identifier** | **NOT STARTED** | No `Order`/`OrderItem`/`OrderStatusHistory` models in `schema.prisma` (full model/enum inventory re-taken); no orders migration among the 7 migrations; `modules/orders/` = `.gitkeep` only; not mounted in `app.ts` (mounts: auth, zones, restaurants, homemakers, uploads, hotels, menu-items, notifications, payments, customers, delivery-partners, third-party-providers). `order_no` therefore **not yet established** — F2/F3 `order_id` work waits on it |
| **M03/SA-1.7 zone assignments + permissions** | **NOT STARTED** | No `AdminZoneAssignment`/`AccessProfile` models; no migration; payments router = `requireAuth` + `requireSuperAdmin` |
| **Payment provider selection** | **NOT STARTED — owner-only** | No gateway env keys; no adapter code; `third_party_providers.integrationStatus` is a CONFIGURED/NOT_CONFIGURED flag with no credential field |
| **Audit-log infrastructure** | **READY for reuse** (not payments-specific) | `AuditLog` model (schema.prisma:206) + proven write pattern in customers module (integration tests assert audit rows per write; doc 32 M09/M10 row). Payments writes none today (read-only — correct) |
| **Notifications / event infrastructure** | **PARTIAL** | Shipped: `Notification` model (schema:677) = **recipient-based user inbox** (recipientId, eventType, idempotencyKey unique per recipient — a *notification-dedupe* precedent only, **not** the documented API `Idempotency-Key` middleware) + `modules/notifications` (list/unread-count/stream/markRead/markAllRead) mounted at `/api/v1/notifications` (migration M17). Absent: `outbox` table (doc 08 line 76), any payments/refunds event producer, Socket.IO payment rooms. Note: shipped table shape differs from doc 08 line 71's audience/zone broadcast table — pre-existing divergence, out of payments scope, flagged only |
| **Refunds (M13)** | **NOT STARTED** | No `Refund`/`RefundDailyUsage` models; `modules/refunds/` = `.gitkeep`; not mounted |
| **Ledger** | **NOT STARTED** | No `LedgerEntry` model |
| **Idempotency (API-level)** | **NOT STARTED** | Zero `Idempotency-Key` middleware/store in `apps/api/src` (the notifications `idempotency_key` column dedupes notification rows only); doc 09 line 11 + doc 08 line 77 remain unimplemented |
| **Payouts (M15)** | **NOT STARTED** | No `Payout` model; no routes |
| **COD settlements** | **PARTIAL** | `DeliveryPartner.cashInHand` column exists (schema ~605; comment: maintained by orders pipeline once M11 lands); `modules/cash-settlement/` = `.gitkeep`; no `cash_settlements` table |
| **Reconciliation** | **NOT STARTED** | No `ReconciliationRun` model; no jobs |
| **`GET /payments/{id}`** | **DOCUMENTED, UNIMPLEMENTED** | doc 09 line 93 vs router mounting only `GET /` |
| **Payments e2e** | **NOT STARTED** | `tests/e2e/` = customers-partners, hotels-menu, vendors, zone-management + `.gitkeep` — no payments spec |

---

## 3. Documentation conflicts and unresolved decisions (Step 1 findings)

1. **SUCCESS vs PAID** — code/contract/UI vs docs 08/10/16/24. Resolved by D63 upon sign-off. *Tension noted:* emitting `PAID` is a response-value change, not strictly "additive" (doc 09 line 12); mitigated by the alias window + doc-32 deprecation row + coordinated in-repo deploy (no external API exposure).
2. **Method vocabulary** — doc 08 two-level vs doc 39 M12 flat list vs intake plain string (doc 42). Resolved by D64a [M]; BANK_TRANSFER (D64b) open.
3. **D13 limits still Assumed** (doc 03 line 23) — D65b open; F6 blocked from hard-coding.
4. **Defect 1 (two locations)** — `payments-screen.tsx` JSDoc and the Phase 2B doc-32 row both claim doc 09 lacks `GET /payments/{id}`; doc 09 line 93 documents it. Correction approved via G2.
5. **M16 vs M17** — the task/plan label "M16 Notifications" conflicts with doc 39 (M16 = Dashboards) and migration evidence (notifications = M17). Noted via G4; no doc edit this phase.
6. **COD payment-row lifecycle (new, implementer-level)** — for COD, `provider`/`provider_payment_id` remain **null permanently** (no gateway); the row is server-created at placement (PENDING) and flips PAID on partner cash confirmation (doc 10 §2, doc 16 §2). Doc 50 lands these columns nullable but does not state the final-state COD nullability explicitly — must be written into the F2 migration task spec (partial unique indexes already assume nullable).
7. **Doc-50 safeguard refinement (new)** — production-data **inventory** (row count, distinct `status`/`method`/`demo` distributions, duplicate `order_ref`, NULL scans) is implied by doc 50 §7 steps 4/8 but not numbered as a hard gate; adopted explicitly via G3/§6.
8. **No contradictions found inside doc 50** — D62–D66, the impact matrix and the 10-step plan are internally consistent and match the cited doc lines (re-verified this phase: doc 08 lines 53/57/61-66/76-77/90/92-104; doc 09 lines 7-12/93/95/~105; doc 10 §2/§3/§5/§6; doc 16 §1-§8; doc 03 D13/D20/D40/D61; doc 04 lines 20/24/39; doc 36 line 72; doc 39 lines 33/49-53/58/138-142).
9. **Owner-only decisions remaining** — gateway (G1), Option 1 vs 2 (A), A3, D64b, D65b; plus the data question "does production contain payment rows?" answered by the §6 inventory, not by opinion.

---

## 4. Recommended implementation sequence (post-approval; acceptance criteria + dependencies)

| # | Work | Depends on | Acceptance criteria | Pre-approval-safe? |
|---|---|---|---|---|
| 1 | **Orders foundation (M11)** — canonical `orders` model with `order_no` (unique), `zone_id`, amounts, `payment_method`/`payment_sub_method`/`payment_status`, `version` | A (Option 1); own lane per doc 38 | Orders module per docs 09/10; `order_no` unique + pg_trgm index (doc 08 §96); state machine tests; **payments untouched** | Design/spec work only (see §7) |
| 2 | **Additive payments schema migration** — nullable `order_id, provider, provider_payment_id, idempotency_key, raw_json, zone_id, sub_method`; new status enum alongside; no NOT NULL/drops/rewrites | A, A4, A6, B; step 1 for any FK *enforcement* (column itself may land earlier as nullable uuid) | Applies cleanly on staging-shaped clone; old code ignores new columns; migration is new-file-only (AGENTS) | **No** — needs A + B signed |
| 3 | **Legacy-data mapping + quarantine** — inventory → dry-run → exact-match backfill (`order_ref`→`order_no`; method map COD/WALLET/UPI/CARD; SUCCESS dual-read); unmatched → quarantine report | Step 2; step 1 for order links; **G3 inventory gate** | Idempotent batched script; zero guessed links; `SUM(amount_paise)` invariant per batch; quarantine report delivered to owner | **No** (read-only inventory may run earlier — §7) |
| 4 | **Status + method compatibility** — API accepts SUCCESS/PAID + legacy method strings; responses emit PAID; UI labels; doc-32 deprecation row | B, C | Alias window verified in integration tests; web pills/filters updated; lint/typecheck/suites green | **No** |
| 5 | **Provider integration + signed webhooks + idempotency** — adapter; `POST /webhooks/payments/{provider}` raw-body verify; `webhook_events.event_id` unique; generic `Idempotency-Key` middleware + `idempotency_keys` store; `payment.captured/failed` outbox events | **G1 gateway**; A5; F2/F3 landed | Doc 24 TC-PAY-1..4 pass (happy/bad-signature/replay/amount-mismatch); duplicate POST → 200 replay of stored response; doc 16 §1 flow in sandbox | **No** |
| 6 | **Zone authorization (F5)** — M03/SA-1.7; `payments.zone_id` NOT NULL; `payments:view` replaces stand-in; scoped repository/export/tiles | **M03 module** (cross-lane); step 3 backfill of zone_id | TC-AC-3 matrix green (SuperAdmin, Admin(A), Admin(A+B), Admin(none)); unknown zone → 404; sidebar/tiles hidden server-driven | **No** (M03 is its own approved track) |
| 7 | **Refunds + approval controls + ledger (F6)** — `refunds` + `refund_daily_usage`; doc 10 §3 machine; D20 limits from assignment; re-auth (`requireRecentReauth` already exists, unused); ledger writes in capture/refund transactions | Steps 5-6; D65b numbers | Ceiling sum(refunds) ≤ captured enforced; requester ≠ approver test; audit before/after (doc 16 §8); balanced ledger sets | **No** |
| 8 | **Payouts, COD settlement, reconciliation, e2e** — `payouts` (D44 payees), `cash_settlements` (cod flow), daily reconciliation job + 48 h alerts, Playwright payments journey | Steps 5-7; M11 pipelines filling partner metrics | Doc 16 §5-§7 behaviors; variance flags; e2e spec green in CI; full `pnpm lint && pnpm -r typecheck && pnpm -r test` | **No** |

**Independent of D62–D66 (can run on its own approved task):** M11 Orders design/build (step 1); the generic Idempotency-Key middleware is *technically* independent (documented at doc 09 line 11 for all POSTs) but still needs its own task approval; M03/SA-1.7 (step 6 prerequisite) is an approved cross-module track.

---

## 5. Migration safeguards — confirmed requirements (Step 5)

Every item below is **mandatory** in the eventual implementation task; doc 50 §6/§7 references given. None are executed in this phase.

- [ ] **Production-data inventory before backfill** — read-only queries: row count, min/max `created_at`, distinct `status`, distinct `method`, `demo=true` count, duplicate `order_ref`/`payment_ref`, NULL/blank scans. (G3 — explicit gate; implied in doc 50 §7 steps 4/8.)
- [ ] **Dry-run report before any data migration** — backfill script runs against inventory output first; report lists every would-link, would-map and quarantined row for owner review (doc 50 §7 step 4).
- [ ] **Exact-match mapping only; never guess** — `order_ref` = `orders.order_no` exact; method map limited to COD/WALLET/UPI/CARD case-insensitive exact; everything else quarantined (doc 50 §3, §6, §7 step 4).
- [ ] **Quarantine + reconciliation of unmatched records** — quarantine report is a deliverable, not a log line; unmatched rows never auto-linked, never deleted (doc 50 §7 steps 4, 8).
- [ ] **Monetary totals unchanged** — `SUM(amount_paise)` and row-count conservation asserted per batch; any break halts the run (doc 50 §6/§7 step 8).
- [ ] **Backward-compatible deployment + recovery** — expand-first order (additive DB → API → web); old API build safe to redeploy because it ignores additive columns; applied migrations are never edited (doc 50 §7 steps 3, 5, 7; AGENTS).
- [ ] **Separate approval before destructive contract-phase changes** — step 10 drops (`demo`, `customerName`, `refund_amount_paise`, `order_ref`, `SUCCESS`, legacy method strings, API aliases) require their own owner sign-off (doc 50 §7 step 10).

---

## 6. Work safe to begin BEFORE owner approval

1. **Read-only production-data inventory** (the §5 first checkbox) — SELECT-only; no writes; output is a report.
2. **M11 Orders design/spec work in its own lane** (doc 38/39 already rank it P0 and sequence it before M12) — independent of A/B/C decisions except Option 1 confirmation (which is the audit's recommendation and doc 08's existing mandate).
3. **Drafting artifacts for review** — draft migration SQL, backfill script and test fixtures may be written as review documents; they are not applied, migrated or committed to schema paths until A + B are signed.
4. **Defect-1 one-line corrections** — only after G2 sign-off (code comment + doc-32 row); not in this phase.

**Everything else waits for the §1 sign-offs.** Specifically forbidden before approval: any schema/migration change, any `prisma generate`, any DB write, any payments/refunds/ledger/payouts/gateway implementation, any weakening of the `requireSuperAdmin` stand-in.

---

## 7. Git and safety statement (Phase 2E)

- Created by this phase: **this file only** (`docs/A-product/51_Payments_Owner_Approval_Checklist.md`, new; doc 50 untouched).
- Not done: no reset/stash/commit/push/stage; no Prisma schema/migration/generated-file edits; no `prisma generate` or migration commands; no database reads-or-writes beyond the read-only inspections listed in the evidence tables; no existing file overwritten.
- Prior work preserved: all 18 pre-existing working-tree entries (Phase 2B payments work, docs 32/handoff rows, `next-env.d.ts` diff, doc 50) remain byte-for-byte; staged count remains 0.
