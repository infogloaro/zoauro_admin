# 10 — State Machines and Event Contracts

## 1. Order state machine
| From | To | Actor | Guard |
|---|---|---|---|
| PLACED | ACCEPTED | vendor, admin | vendor Active |
| PLACED | CANCELLED | customer, vendor, admin, system (timeout) | reason |
| ACCEPTED | PREPARING | vendor, admin | |
| ACCEPTED | CANCELLED | vendor, admin | reason |
| PREPARING | READY | vendor, admin | |
| PREPARING | CANCELLED | vendor, admin | reason |
| READY | ASSIGNED | admin, system | partner verified, online, under cap |
| READY | CANCELLED | admin | reason |
| ASSIGNED | OUT_FOR_DELIVERY | partner, admin | |
| ASSIGNED | READY | admin | unassign/reassign |
| OUT_FOR_DELIVERY | DELIVERED | partner, admin | COD: collection confirmed |
| OUT_FOR_DELIVERY | CANCELLED | admin | reason + refund decision |
| DELIVERED | REFUNDED | admin | **full** captured amount refunded (D40); partial refunds keep status and set payment_status PARTIALLY_REFUNDED |
| CANCELLED | REFUNDED | admin, system | payment captured and fully refunded |

All other transitions are rejected. Each transition: lock row (`SELECT … FOR UPDATE` or version check), validate, update, append `order_status_history`, write audit, emit event, in one transaction.

## 2. Payment state machine
PENDING → PAID (verified webhook or COD collection) | FAILED. PAID → PARTIALLY_REFUNDED → REFUNDED. FAILED can retry creating a new attempt, never mutate the old one.

## 3. Refund state machine
REQUESTED → (within limit) APPROVED → PROCESSED | FAILED. REQUESTED → PENDING_APPROVAL → APPROVED | REJECTED. FAILED → retry with same idempotency key → PROCESSED.

## 4. Vendor approval (restaurants, homemakers) — v1.1, D22
Two fields. `verification_status`: PENDING → VERIFIED | REJECTED (note required); REJECTED → PENDING on resubmission. `status`: PENDING → ACTIVE only if VERIFIED; ACTIVE ↔ INACTIVE; ACTIVE → SUSPENDED → ACTIVE. Rejected vendors stay status PENDING and show as Rejected in the verification column (matches Figma).

## 5. Delivery partner
PENDING_VERIFICATION → VERIFIED → ACTIVE ↔ INACTIVE; SUSPENDED. Online flag separate from status.

## 6. Domain events
Internal domain events below are published through the outbox. The subset delivered to the customer, vendor and partner apps, with payloads and receiver duties, is in `G-integration/43` and `contracts/events.catalog.json`.

| Event | Payload (key fields) | Consumers |
|---|---|---|
| order.placed | orderId, zoneId, vendor | notify vendor, dashboard cache |
| order.status_changed | orderId, from, to, actor | notifications, Socket.IO zone rooms, audit |
| order.cancelled | orderId, reason | refund suggestion |
| payment.captured | orderId, paymentId, amount | order payment_status, ledger |
| payment.failed | orderId | notify customer |
| refund.requested / approved / processed / failed | refundId, amount | ledger, notifications |
| vendor.status_changed | vendorId, to | menu visibility |
| admin.zones_changed | userId, added[], removed[] | scope cache invalidation, socket rooms, audit |
| admin.created / role.changed | userId | audit, session revocation |

Events are written to an `outbox` table in the same transaction and published by a worker (at-least-once); consumers must be idempotent.

## 5. Idempotency
- Client requests: `Idempotency-Key` stored with response for 24 h.
- Webhooks: `webhook_events.event_id` unique; duplicate delivery returns 200 and does nothing.
- Refunds: unique `idempotency_key`; gateway call includes it.

## 6. Concurrency
Optimistic `version` on orders; two admins acting simultaneously: second receives 409 and refreshes. Assignment uses transaction with partner row lock to enforce cap.
