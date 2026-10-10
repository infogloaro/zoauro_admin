# 48 — Integration Test and UAT Plan (with the three apps)

## 1. Why this exists
The admin panel is only useful if real data from the customer, vendor and partner apps arrives correctly. This plan proves it before pilot, without waiting for app teams to finish.

## 2. Three app simulators (built in IH-7, kept in `tools/simulators/`)
| Simulator | Behaves like | Capabilities |
|---|---|---|
| `sim-customer` | Customer app backend | Create customers/addresses; place orders (valid, wrong price, out-of-zone, blocked customer, duplicate); cancel; start payment attempt |
| `sim-vendor` | Vendor app backend | Register vendor/homemaker with documents; menu CRUD; open/close; accept/reject/preparing/ready; auto-accept mode with random delays; silent mode (to test the 5-minute timeout) |
| `sim-partner` | Partner app backend | Register partner; online/offline; location stream; accept/reject; pickup; deliver; COD collected; cash hand-over |
All three sign requests exactly as doc 42 §1, run a local webhook receiver that verifies signatures, and can inject faults: drop webhooks (500), slow responses, duplicate events, out-of-order events, clock skew, bad signatures. A `scenario` runner plays scripted days ("100 orders across 3 zones in 30 minutes") and also seeds 100k historical orders for dashboards.

## 3. Contract tests (run by app teams against sandbox, and by CI against the simulators)
| ID | Case | Expected |
|---|---|---|
| TC-INT-1 | Valid signed request | 2xx |
| TC-INT-2 | Altered body after signing / wrong secret / missing header | 401 `SIGNATURE_INVALID`, logged |
| TC-INT-3 | Timestamp 10 minutes old | 401 `TIMESTAMP_SKEW` |
| TC-INT-4 | Same Idempotency-Key and body twice | same response, `Idempotent-Replay: true`, one row |
| TC-INT-5 | Same key, different body | 409 `IDEMPOTENCY_CONFLICT` |
| TC-INT-6 | Vendor client calls a customer endpoint | 403 `SCOPE_DENIED` |
| TC-INT-7 | Vendor B responds to vendor A's order | 403 `ENTITY_MISMATCH` |
| TC-INT-8 | Order with wrong item price / wrong total | 422 `PRICE_MISMATCH` listing items |
| TC-INT-9 | Order from a blocked customer / to a suspended vendor / into an inactive zone / outside the vendor's zone | 403 `CUSTOMER_BLOCKED` / 422 `VENDOR_UNAVAILABLE` / 422 `NOT_SERVICEABLE` |
| TC-INT-10 | Duplicate `orderId` with new key | 409 `DUPLICATE_ORDER` with existing id |
| TC-INT-11 | Vendor registers with pincode in zone A | Appears in zone A pending list; not in zone B; Socket.IO event to A members with view permission only |
| TC-INT-12 | Vendor registers with unknown pincode | 202, `zoneStatus=UNASSIGNED`; only Super Admin sees it; assigning makes it visible to the zone team |
| TC-INT-13 | Partner events out of order (DELIVERED before PICKED_UP) | 409 with `currentStatus`; no state change |
| TC-INT-14 | Vendor accepts at the same moment admin cancels | exactly one wins, the other gets 409 with current state |
| TC-INT-15 | Suspended vendor toggles open | 409 `VENDOR_UNAVAILABLE`; `is_open` unchanged |
| TC-INT-16 | Webhook receiver returns 500 for 3 attempts then 200 | Retried on schedule, delivered once effectively (receiver dedupes) |
| TC-INT-17 | Receiver down for 30 minutes | Pull feed from last sequence returns every missed event in order, no gaps |
| TC-INT-18 | 8 failed attempts | Delivery in dead letter, alert raised, Retry from Hub delivers it |
| TC-INT-19 | Webhook URL pointing to a private IP/localhost | Rejected at save (SSRF guard) |
| TC-INT-20 | Client disabled in Hub | Requests `CLIENT_DISABLED`; webhooks pause; re-enable resumes; both audited |
| TC-INT-21 | Secret rotation | Old and new both valid 24 h; old rejected after |
| TC-INT-22 | Admin suspends vendor / blocks customer / forces partner offline | Matching event delivered; Core refuses further actions even if the app ignores the event |
| TC-INT-23 | Rate limit exceeded | 429 with `Retry-After`; no data loss when the app retries |
| TC-INT-24 | Location batch of 50 points | 202; only latest stored; detail page shows last seen |
| TC-INT-25 | Online order unpaid after 15 min | Auto-cancelled `PAYMENT_TIMEOUT`, never shown to vendor/ops lists; paid order shown immediately |
| TC-INT-26 | Import dry run then real run on the sample file | Counts match report; re-running creates no duplicates |

## 4. End-to-end scenarios (staging, simulators first, then real apps)
| ID | Scenario | Pass when |
|---|---|---|
| E2E-1 | New restaurant registers → zone member verifies → Super Admin sets commission → vendor adds menu → customer orders → vendor accepts → member assigns partner → partner delivers → payout line appears | Every admin screen shows the right state, every app received the right events |
| E2E-2 | COD order incl. cash hand-over and variance | Settlement flagged and confirmed; partner app receives `settlement.confirmed` |
| E2E-3 | Cancel + refund above the member's limit → Super Admin approves | Customer app receives `refund.updated` through PROCESSED |
| E2E-4 | Two members with different access in one zone work the same order | Allowed actions succeed, forbidden ones 403, race gives 409 |
| E2E-5 | Member loses a zone mid-session | Pending registrations and orders of that zone disappear from their lists; Socket.IO stops |
| E2E-6 | Vendor suspended with open orders | New orders refused; open orders can finish; vendor app shows reason |
| E2E-7 | App backend outage and recovery | No lost or duplicate orders after replay |
| E2E-8 | Broadcast to vendors of zone A only | Only vendor app receives `broadcast.created` with zone A |

## 5. UAT script for pilot sign-off
Participants: product owner, one Super Admin, two Zonal Admin members (one with two zones), one person from each app team. Duration: 2 days in staging with real apps in test mode.
1. Walk W1 to W12 of doc 39 using real apps for the app-side steps.
2. Run E2E-1 to E2E-8.
3. Review dashboards against direct counts; review audit log and Access Change History.
4. Check Needs-attention panel is clean and the alerts fire when a webhook is broken on purpose.
5. Sign-off sheet: each scenario passed/failed, defects with severity; no open Sev-1/2 to proceed (doc 31).

## 6. Performance and resilience targets
Intake order create p95 < 400 ms at 20 orders/min (10× pilot expectation); 300 location points/min per partner-app client sustained; webhook worker drains 1,000 queued events in under 2 minutes; Integration Hub monitor query p95 < 1.5 s over 1 million log rows (indexes on `(client_id, received_at)` and `(entity_id)`).
