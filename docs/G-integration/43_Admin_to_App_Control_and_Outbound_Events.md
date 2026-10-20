# 43 — Admin → App Control and Outbound Events

How decisions taken in the Super Admin and Zonal Admin panels reach the customer, vendor and partner apps. Machine-readable catalogue: `contracts/events.catalog.json`.

## 1. Mechanism
1. A panel action (or an inbound event) changes data inside one DB transaction that also writes an **outbox** row (doc 10).
2. The BullMQ outbox worker fans each event out to every **subscribed client**: HTTPS **webhook** (primary) and the **pull feed** (recovery).
3. Delivery is **at-least-once**. Receivers must be idempotent on `eventId`.

## 2. Webhook delivery
`POST <client webhook URL>` with:
| Header | Value |
|---|---|
| `X-Zoauro-Event-Id` | UUID, stable across retries |
| `X-Zoauro-Event-Type` | e.g. `order.status_changed` |
| `X-Zoauro-Timestamp` | Unix seconds |
| `X-Zoauro-Signature` | `t=<ts>,v1=<hex HMAC-SHA256(webhookSecret, ts + "." + rawBody)>` |
| `X-Zoauro-Attempt` | 1, 2, … |
Body envelope:
```json
{
  "eventId": "0192…", "type": "order.status_changed", "schemaVersion": 1,
  "occurredAt": "2026-10-10T07:25:03Z", "sequence": 481220,
  "aggregate": { "type": "order", "id": "0192…", "externalId": "CUST-ORD-88421", "version": 4 },
  "audience": { "customerId": "cust_1042", "vendorId": "ven_55", "partnerId": null, "zoneId": "…" },
  "actor": { "type": "ADMIN", "id": "…" },
  "data": { "from": "PLACED", "to": "ACCEPTED", "note": "" }
}
```
- Receiver verifies the signature in constant time, rejects timestamps older than 5 minutes, and answers `2xx` within 10 s. Anything else counts as failure.
- **Retries:** after 1 min, 5 min, 30 min, 2 h, 6 h, 24 h (7 attempts). Then the delivery goes to **dead letter** and an alert is raised; Super Admin can retry it from the Integration Hub.
- **Ordering:** events of one aggregate carry increasing `aggregate.version`. Receivers apply an event only if its version is newer than what they hold, and fetch the current state (`GET /orders/{id}`) when they see a gap.
- **Which client gets what:** an event goes to every client whose scopes allow it and which subscribed to that type. `audience` names the end users concerned so the app backend can route it (the Core never talks to end users).
- Webhook URL must be HTTPS; private/loopback addresses are refused (SSRF guard); redirects are not followed.

## 3. Pull feed (recovery and offline apps)
`GET /intake/v1/events?after=<sequence>&limit=100&types=a,b` returns events for that client in sequence order with `nextCursor`. Retention 14 days. An app that was down calls it from its last processed sequence, then resumes webhooks. Feed and webhooks carry identical events, so processing is the same.

## 4. Event catalogue and what the app must do
| Event | Sent to | Trigger | App must |
|---|---|---|---|
| `order.status_changed` | customer, vendor, partner | any state transition from any actor | update order screen and notify the user |
| `order.assigned` | partner, vendor, customer | admin or system assigns a partner | partner: show assignment to accept/reject; customer: show partner |
| `order.reassigned` | partner (old and new), customer | admin changes partner | old partner: clear order; new: show |
| `order.cancelled` | all three | cancel by admin/system/timeout, with `reasonCode`, `cancelledBy` | stop work on the order; show reason |
| `payment.status_changed` | customer | gateway webhook or COD | update payment state |
| `refund.updated` | customer | refund requested/approved/processed/failed | show status and amount |
| `vendor.status_changed` | vendor | verified, rejected (+note), activated, deactivated, suspended | rejected/suspended: block going online and taking orders; show the note |
| `vendor.updated` | vendor | admin-owned fields changed (commission %, zone, label) | refresh display |
| `menu_item.admin_changed` | vendor, customer | admin disabled/enabled an item or changed a vendor-owned field in an override case | hide/unhide; refresh |
| `menu_item.change_decided` | vendor | a vendor item-change request (R09) was approved or rejected; `{requestId, kind, decision, itemId, menuItemId, reason?}` (D125) | approved: show the change as live; rejected: show the reason |
| `partner.status_changed` | partner | verified, rejected, activated, suspended | suspended: sign out of duty |
| `partner.force_offline` | partner | admin forces offline until a time (at most 30 days, D131) | set offline immediately; show reason |
| `partner.updated` | partner | admin-owned fields changed (zone move, D131) | refresh display |
| `customer.status_changed` | customer | blocked / unblocked | blocked: refuse ordering with a neutral message |
| `settlement.confirmed` | partner | cash hand-over confirmed, with variance | show cleared cash-in-hand |
| `zone.updated` | all | zone created/activated/deactivated, pincode range or delivery charge changed | update serviceability; deactivated zone: no new orders |
| `config.changed` | all | settings that apps read (acceptance timeout, cancel reasons, etc.) | refetch `/config` |
| `broadcast.created` | the audience's app(s) | Super Admin notification | deliver push/SMS/in-app to the audience; `zoneIds`, `audienceType`, `title`, `body`, `schedule` |

## 5. Admin control semantics (what "control" means)
- **Admin always wins.** If an admin cancels an order while the vendor accepts at the same moment, the state machine decides by `version`; the loser gets `409` with current state.
- **Hard stops** are enforced by the Core regardless of what an app does: a suspended vendor cannot receive new orders (`VENDOR_UNAVAILABLE`), a blocked customer cannot order, an offline-forced partner cannot go online until re-enabled, an inactive zone refuses new orders. The events only tell apps to show it.
- **Zone team permissions** decide which admin may trigger which control (doc 04). Every control action is audited with the acting member.
- **Kill switch:** Super Admin can disable an app client in the Integration Hub; its requests then fail with `CLIENT_DISABLED` and webhooks pause (events keep queueing for 14 days).

## 6. Health and alerts
Alerts to Super Admin (bell + email): dead-letter count > 0; webhook failure rate > 20% for 10 min; no inbound events from an app for 15 minutes during operating hours (config); signature-failure spike; client over rate limit. Details in doc 45 and `E-quality-ops/30`.
