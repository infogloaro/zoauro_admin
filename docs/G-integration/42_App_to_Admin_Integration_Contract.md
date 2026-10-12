# 42 — App → Admin Integration Contract (inbound)

For the customer-app, vendor-app and partner-app backend teams. Machine-readable version: `contracts/intake.openapi.yaml` (authoritative if a table below disagrees). Base path `/api/v1/intake`. JSON, UTF-8. Money in integer **paise**, times ISO 8601 UTC, IDs below are the **app's own ids** (`externalId`); the Core returns its own UUIDs and keeps the mapping (doc 44 §3).

## 1. Authentication: HMAC-signed requests (D51)
Each app gets one **API client** (Integration Hub, doc 45): `keyId`, `secret` (shown once), scopes, optional IP allow-list. Sandbox and production have different clients.

Headers on every request:
| Header | Value |
|---|---|
| `X-Zoauro-Key-Id` | client key id |
| `X-Zoauro-Timestamp` | Unix seconds; rejected if more than 300 s from server time |
| `X-Zoauro-Signature` | `v1=` + hex HMAC-SHA256(secret, canonical) |
| `Idempotency-Key` | required on every POST/PUT/PATCH/DELETE; the app's own event id (UUID). Same key + same body → original response replayed with `Idempotent-Replay: true`; same key + different body → `409 IDEMPOTENCY_CONFLICT`. Kept 7 days |
| `Content-Type` | `application/json` |

Canonical string: `timestamp + "." + METHOD + "." + pathWithQuery + "." + sha256hex(rawBody)` (empty body → hash of empty string).
```js
// Node (sender)
const body = JSON.stringify(payload);
const ts = Math.floor(Date.now()/1000).toString();
const canon = `${ts}.POST./api/v1/intake/orders.${crypto.createHash('sha256').update(body).digest('hex')}`;
const sig = 'v1=' + crypto.createHmac('sha256', SECRET).update(canon).digest('hex');
```
```python
# Python (sender)
import hmac, hashlib, time, json
body = json.dumps(payload, separators=(",", ":"))
ts = str(int(time.time()))
canon = f"{ts}.POST./api/v1/intake/orders.{hashlib.sha256(body.encode()).hexdigest()}"
sig = "v1=" + hmac.new(SECRET.encode(), canon.encode(), hashlib.sha256).hexdigest()
```
The server stores the secret encrypted (AES-256-GCM, `ENCRYPTION_KEY`), not as a one-way hash, because it must recompute the HMAC. Rotation: create a new secret; both work for 24 h; then the old one is revoked. Compare signatures in constant time.

**Never put the secret in a mobile app.** Only the app's backend signs. End-user identity is passed in the body (`customerId`, `vendorId`, `partnerId`); the app backend is responsible for authenticating its users.

## 2. Scopes
| Client type | Scopes |
|---|---|
| CUSTOMER_APP | `customers:write`, `orders:create`, `orders:cancel`, `payments:attempt`, `zones:resolve`, `config:read`, `events:read` |
| VENDOR_APP | `vendors:register`, `vendors:write`, `menu:write`, `orders:vendor`, `uploads:presign`, `config:read`, `events:read` |
| PARTNER_APP | `partners:register`, `partners:write`, `partners:location`, `orders:partner`, `cash:handover`, `uploads:presign`, `config:read`, `events:read` |
A request outside its scopes → `403 SCOPE_DENIED`. A vendor client acting on an order that belongs to a different vendor → `403 ENTITY_MISMATCH`.

## 3. Conventions
- **Success:** `200/201` with `{ "data": {...} }`; `202` when accepted but not yet applied (zone unresolved registration).
- **Errors:** same envelope as doc 09: `{ "error": { "code", "message", "details", "requestId" } }`.
- **Order of events is not guaranteed by the network.** The Core validates each event against the current state. A stale or impossible event returns `409 INVALID_STATE_TRANSITION` with `currentStatus` and `version` so the app can refresh. Apps must not blindly retry a 409.
- **Retry policy for apps:** retry network errors and `429/5xx` with the **same Idempotency-Key**, exponential backoff (1 s, 2 s, 5 s, 15 s, 1 min, then every 5 min up to 24 h). Never retry `4xx` other than `408/409(IN_PROGRESS)/429`.
- **Rate limits:** 600 requests/min per client; `partners/{id}/location` 3000/min per client; `429` with `Retry-After`.
- **Versioning:** URL major version; additive fields only inside v1. Apps must ignore unknown fields in responses and webhooks.
- **PII minimisation:** send only the fields listed. Do not send passwords, OTPs, card data or full device identifiers.

## 4. Error codes (integration additions to doc 09)
`SIGNATURE_INVALID 401`, `TIMESTAMP_SKEW 401`, `CLIENT_DISABLED 403`, `SCOPE_DENIED 403`, `ENTITY_MISMATCH 403`, `IDEMPOTENCY_CONFLICT 409`, `IDEMPOTENCY_IN_PROGRESS 409`, `INVALID_STATE_TRANSITION 409`, `NOT_SERVICEABLE 422` (address outside the vendor's zone or zone inactive), `VENDOR_UNAVAILABLE 422` (inactive, suspended, closed), `PRICE_MISMATCH 422`, `ITEM_UNAVAILABLE 422`, `CUSTOMER_BLOCKED 403`, `PARTNER_NOT_ELIGIBLE 422`, `UNKNOWN_ENTITY 404`, `VALIDATION_ERROR 422`, `RATE_LIMITED 429`.

## 5. Endpoints
### 5.1 Common (all apps)
| Method | Path | Purpose |
|---|---|---|
| GET | `/ping` | connectivity + clock check; returns server time and client name |
| GET | `/config` | rules the app should honour: cancel reasons, acceptance timeout, max cart value, supported payment methods, support number, app min-version flags |
| GET | `/zones/resolve?lat=&lng=&pincode=` | which zone covers a location; `serviceable`, `deliveryChargePaise`, `status` (ACTIVE / UPCOMING / NONE) |
| | | **Note (v2.4, D83/D87):** v1 decides serviceability by **pincode only**. `lat`/`lng` are accepted but not used for matching; send the customer's pincode. Closed (INACTIVE) zones are returned as `NONE`. `status=UPCOMING` means the area is planned: show "coming soon". Polygon matching is planned after the pilot. |
| POST | `/uploads/presign`, `/uploads/confirm` | pre-signed upload for documents (type and size allow-list, doc 13) |
| GET | `/events?after=&limit=&types=` | pull feed of outbound events (doc 43 §3) |

### 5.2 Customer app (`CUSTOMER_APP`)
| Method | Path | Purpose |
|---|---|---|
| PUT | `/customers/{customerId}` | upsert profile: `name`, `phone`, `email?`, `registeredAt`, `source` (APP/REFERRAL/OTHER). First call creates the customer in the Core with `source=APP` |
| PUT | `/customers/{customerId}/addresses/{addressId}` | upsert address: `label`, `line1`, `line2?`, `area`, `city`, `pincode`, `lat`, `lng`, `isDefault` |
| DELETE | `/customers/{customerId}/addresses/{addressId}` | soft-delete |
| POST | `/orders` | **create order** (§6.1) |
| GET | `/orders/{orderId}` | current status, version, timeline summary, payment status (so the app can resync) |
| POST | `/orders/{orderId}/cancel` | customer cancellation: allowed while `PLACED`; later states return `409` and the app should offer "contact support" |
| POST | `/payments/{orderId}/attempts` | start a payment attempt; response carries the gateway order/session data (provider adapter, doc 16). Gateway result arrives via the gateway webhook, not from the app |
| POST | `/orders/{orderId}/reviews` | P2, accepted and stored, no admin UI in v1 |
| POST | `/support/tickets` | P2, same |

### 5.3 Vendor app (`VENDOR_APP`: restaurants, homemakers, shops)
| Method | Path | Purpose |
|---|---|---|
| POST | `/vendors` | **self-registration** (§6.2). Returns `vendorId`, `verificationStatus=PENDING`, `zoneStatus` (ASSIGNED/UNASSIGNED) |
| PATCH | `/vendors/{vendorId}` | profile fields the vendor owns (doc 44): `name`, `phone`, `address`, `lat`, `lng`, `cuisineTags`, `foodCategory` (homemaker), `experienceYears` (homemaker), `description` |
| POST | `/vendors/{vendorId}/documents` | after upload confirm: `type` (FSSAI, GST, PAN, BANK, ID, OTHER), `fileKey`, `expiresOn?` |
| PUT | `/vendors/{vendorId}/hours` | weekly opening hours |
| POST | `/vendors/{vendorId}/availability` | `{ "isOpen": true/false }`; ignored (409 VENDOR_UNAVAILABLE) if admin status is not ACTIVE |
| PUT | `/vendors/{vendorId}/menu-items/{itemId}` | upsert item: `name`, `category`, `description`, `pricePaise`, `isVeg`, `imageKey?`, `prepTimeMin`, `inStock`, `isAvailable`, `options[]` |
| POST | `/vendors/{vendorId}/menu-items/{itemId}/stock` | `{ "inStock": false }` quick toggle |
| DELETE | `/vendors/{vendorId}/menu-items/{itemId}` | soft-delete (never breaks old orders: orders keep an item snapshot) |
| POST | `/orders/{orderId}/vendor-response` | `{ "vendorId", "action": "ACCEPT\|REJECT\|PREPARING\|READY", "reasonCode?", "prepTimeMin?" }` |

### 5.4 Partner app (`PARTNER_APP`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/partners` | **self-registration**: `name`, `phone`, `vehicleType`, `vehicleNo`, `area`, `lat`, `lng`, documents |
| PATCH | `/partners/{partnerId}` | profile fields the partner owns |
| POST | `/partners/{partnerId}/documents` | as vendors (DRIVING_LICENSE, RC, AADHAAR_MASKED, BANK, OTHER) |
| POST | `/partners/{partnerId}/availability` | `{ "isOnline": true/false }`; refused with `PARTNER_NOT_ELIGIBLE` unless status ACTIVE and verified |
| POST | `/partners/{partnerId}/location` | batch of `{lat,lng,at}`; the Core keeps only the latest per partner (Redis, 15 min TTL) |
| POST | `/orders/{orderId}/partner-events` | `{ "partnerId", "event": "ACCEPT\|REJECT\|PICKED_UP\|DELIVERED\|COD_COLLECTED", "at", "collectedPaise?", "reasonCode?" }` |
| POST | `/partners/{partnerId}/cash-handover` | `{ "amountPaise", "at", "reference?" }` creates a **pending** settlement record |

## 6. Key payloads
### 6.1 `POST /orders` (customer app)
```json
{
  "orderId": "CUST-ORD-88421",
  "customerId": "cust_1042",
  "vendorId": "ven_55",
  "address": { "addressId": "addr_9", "line1": "12 Gandhi Nagar", "area": "RS Puram", "city": "Coimbatore", "pincode": "641002", "lat": 11.0071, "lng": 76.9506 },
  "items": [
    { "itemId": "itm_301", "name": "Chicken Biryani", "qty": 2, "unitPricePaise": 18000, "options": [] },
    { "itemId": "itm_322", "name": "Raita", "qty": 1, "unitPricePaise": 4000, "options": [] }
  ],
  "charges": { "subtotalPaise": 40000, "deliveryFeePaise": 3000, "taxPaise": 2000, "discountPaise": 0, "totalPaise": 45000 },
  "payment": { "method": "UPI" },
  "notes": "Less spicy",
  "placedAt": "2026-10-10T07:20:11Z"
}
```
Server checks, in order: client scope → customer exists and not blocked → vendor exists, `ACTIVE`, `VERIFIED`, open → every item exists, `isAvailable`, **price equals the Core's menu price** (else `PRICE_MISMATCH` listing the items) → delivery address pincode/lat-lng inside the vendor's zone and the zone is ACTIVE (`NOT_SERVICEABLE`) → totals recomputed and equal (`PRICE_MISMATCH`). Response `201`:
```json
{ "data": { "id": "0192…", "orderNumber": "ZO-100245", "externalOrderId": "CUST-ORD-88421", "status": "PLACED", "paymentStatus": "PENDING", "zoneId": "…", "version": 1 } }
```
Taxes and delivery fee rules are the app's concern in v1; the Core validates internal consistency and zone delivery charge (`deliveryFeePaise` must equal the zone's configured charge unless a promo flag is sent; promo logic is P2).

### 6.2 `POST /vendors` (vendor app)
```json
{
  "vendorId": "ven_55",
  "type": "RESTAURANT",
  "name": "Annapoorna Mess",
  "ownerName": "R. Kumar",
  "phone": "+919876543210",
  "email": "owner@example.com",
  "address": { "line1": "5 Cross Cut Rd", "area": "Gandhipuram", "city": "Coimbatore", "pincode": "641012", "lat": 11.0183, "lng": 76.9725 },
  "cuisineTags": ["South Indian"],
  "documents": [ { "type": "FSSAI", "fileKey": "uploads/…/fssai.pdf" } ]
}
```
`type` is RESTAURANT, HOMEMAKER or SHOP (SHOP maps to restaurant records with `kind=SHOP` until a shop-specific design exists; open question D54).

## 7. Idempotency and duplicate handling
- Every mutating call carries an `Idempotency-Key`. The Core stores `(client, key) → request hash, response, status` for 7 days.
- Business duplicates are also caught: `orderId` (the app's order id) is unique per client; sending it again with a new key returns `409 DUPLICATE_ORDER` with the existing order id.

## 8. Sandbox and testing
Sandbox base URL and a sandbox client per app. The **three app simulators** (doc 48) exercise every endpoint; app teams run the contract test suite against sandbox before go-live. Production credentials are created only after the suite passes.

## 9. Security notes (see doc 13 T23–T26)
Signature + timestamp window blocks tampering and replay; scopes and entity checks block a compromised vendor client from touching customer endpoints; every request is logged (without bodies' PII beyond ids) in the inbound log; client kill switch in the Integration Hub; secrets rotate without downtime.
