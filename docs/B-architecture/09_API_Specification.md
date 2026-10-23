# 09 — API Specification (OpenAPI contract guide, v1.2)

Base path `/api/v1`, served by the Express API. JSON only. OpenAPI 3.1 generated from shared Zod schemas (`zod-to-openapi`), published at `/api/v1/openapi.json`; CI fails if generated and committed specs differ. The Next.js client is generated from it.

## Conventions
- **Auth:** session cookie (HTTP-only). State-changing requests require `X-CSRF-Token`. Integration clients (below) use HMAC-signed requests instead (D51, doc 42 §1).
- **Authorization:** every route declares `permission: "module:action"`; zone scope is applied automatically by the repository.
- **Zone scope (v1.2):** list/aggregate endpoints accept `?zoneId=<uuid>` (repeatable) or omit it. Super Admin: any zone or none (= all). Zonal Admin: effective scope = requested ∩ zones where the endpoint's `module:view` is granted to this member; omitted = all such zones. A requested zone outside assignment returns 404 `ZONE_NOT_FOUND`. A write in an assigned zone where the member lacks the action returns 403. Write endpoints that create zone-owned records require `zoneId` in the body and it must be assigned.
- **Pagination:** `?page=1&pageSize=25` (max 100); response `{ data: [], meta: { page, pageSize, total } }`. Cursor pagination for audit logs and order history.
- **Sorting/filtering:** `?sort=-createdAt&status=ACTIVE&q=search&from=2026-01-01&to=2026-01-31&zoneId=`.
- **Idempotency:** `Idempotency-Key` header required on refund, payment, intake order-create, cash-settlement POSTs; stored 24 h.
- **Versioning:** URL major version; additive changes only within v1; deprecations in doc 32.
- **Optimistic locking:** PATCH/transition on orders requires `If-Match: <version>`.
- **Errors:**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": [{"field":"email","issue":"invalid"}], "requestId": "…" } }
```
Codes: UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, ZONE_NOT_FOUND 404, VALIDATION_ERROR 422, CONFLICT 409, RATE_LIMITED 429, INVALID_STATE_TRANSITION 409, REFUND_LIMIT_EXCEEDED 403, REAUTH_REQUIRED 401, INTERNAL 500.

## Endpoint catalogue
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /auth/login | public | rate limited, lockout |
| POST | /auth/logout | session | |
| POST | /auth/forgot-password, /auth/reset-password | public | generic responses |
| POST | /auth/2fa/setup, /auth/2fa/verify | session | |
| POST | /auth/reauth | session | recent re-auth for high-risk actions |
| GET | **/me** | session | role, **zones[] each with granted permissions and limits for that zone** (Zonal Admin) or global flag (Super Admin), preferences |
| PUT | **/me/zone-scope** | session | `{ zoneIds: [] }` saves preference; validated against assignment |
| GET | /dashboard/summary | dashboard:view | scoped aggregates; `?zoneId` |
| GET | /dashboard/order-status, /order-overview, /zone-orders | dashboard:view | `zone-orders` = bar by zone (scope>1) or by area (scope=1) |
| GET | /dashboard/revenue-overview, /top-restaurants, /top-categories, /new-registrations | dashboard:view | Super Admin dashboard widgets (Figma) |
| GET | /search?q= | session | global search (P1, D32); per-entity permission + scope |
| GET/POST | /zones | zones:view/add | Super Admin |
| GET/PATCH/DELETE | /zones/{id} | zones:* | delete = deactivate with impact check |
| GET | /zones/{id}/impact | zones:view | counts of open orders, vendors, partners, admins before deactivate |
| GET/POST | /zonal-admins | admins:* | Super Admin; create member account (name, email, phone, password, status); zones/access are set via `/access` below |
| GET/PATCH/DELETE | /zonal-admins/{id} | admins:* | |
| GET | **/zonal-admins/{id}/access** | access:view | member's assignments: `[{ zoneId, profileId, overrides[], limits }]` |
| PUT | **/zonal-admins/{id}/access** | access:edit | replace the member's assignments; diff → `access_changes` + audit; invalidates cache; emits `scope.changed`; email to member; re-auth |
| GET | **/zonal-admins/{id}/access/preview?zoneId=** | access:view | effective permissions and limits (computed), plus what each sidebar/dashboard tile would show |
| GET | **/zones/{id}/team** | access:view | members of a zone with profile, overrides count, limits |
| POST/DELETE | **/zones/{id}/team/{userId}** | access:edit | add member to zone with a profile / remove; same audit and re-auth |
| GET | **/access-changes** | access:view | history, filter by member, zone, actor, date |
| POST | /zonal-admins/{id}/reset-password, /revoke-sessions | admins:edit | |
| GET/POST | **/access-profiles** | access:* | Super Admin; list/create templates |
| GET/PATCH/DELETE | **/access-profiles/{id}** | access:* | delete blocked if in use |
| GET/PUT | **/access-profiles/{id}/permissions** | access:edit | matrix VAEDS per module + default limits/flags; saving notifies affected members and invalidates their caches |
| GET/POST | /restaurants | restaurants:* | scoped; POST needs `zoneId` |
| GET/PATCH/DELETE | /restaurants/{id} | | |
| POST | /restaurants/{id}/status | restaurants:status | activate, deactivate, suspend |
| POST | /restaurants/bulk | restaurants:status | `{ ids[1..100], status }`; per-vendor skip on illegal transition; one audit row `*.bulk.status` |
| GET | /restaurants/export | restaurants:view | synchronous CSV (D26-masked contact, formula-safe, doc 13 T15/T16, max 5000 rows); audited `*.export` |
| POST | /restaurants/{id}/verification | restaurants:status | verify / reject (note required) |
| POST | /restaurants/{id}/move-zone | zones:assign | Super Admin only, R-VEN-3 |
| POST | /restaurants/{id}/documents | restaurants:edit | attach a confirmed presigned upload `{ docType, fileKey }` |
| GET | /restaurants/{id}/documents/{documentId}/url | restaurants:view | short-lived signed read `{ url, expiresInSec }`; the download itself is audited (doc 15), the URL is not |
| POST | /restaurants/{id}/documents/{documentId}/verify | restaurants:status | `{ decision, note? }`; note required to reject |
| GET | /restaurants/onboarding/checklist | restaurants:view | advisory requirement matrix (doc 45); never gates verification/activation |
| PUT | /restaurants/onboarding/checklist | (Super Admin only) | replace the matrix `{ requirements[{ docType, label, weight, active }] }`; unique docType per kind |
| GET | /restaurants/onboarding/review-queue | restaurants:view | pending-verification vendors oldest-first with `reviewDueAt` + derived review state (ON_TIME/DUE_SOON/OVERDUE/ESCALATED, 48 h SLA) |
| POST | /restaurants/onboarding/reminders | restaurants:status | notifies OVERDUE/ESCALATED vendors; idempotency key `onboarding.overdue.{kind}.{vendorId}.{yyyy-mm-dd}`; returns `{ notified, deduped, overdue }` |
| GET | /restaurants/{id}/onboarding | restaurants:view | active checklist + readiness score + per-item reasons + review state + `reviewDueAt` |
| PUT | /restaurants/{id}/review-deadline | restaurants:status | set/clear the manual review deadline; audit `*.review-deadline` |
| (same set) | /homemakers … | homemakers:* | |
| GET/POST | /hotels | hotels:view/add | zone-scoped; POST needs `zoneId`; list meta carries counts + metrics (owner-authorized build, doc 32 TD-33) |
| GET/PATCH/DELETE | /hotels/{id} | | |
| POST | /hotels/{id}/status | hotels:status | activate, deactivate, suspend |
| POST | /hotels/{id}/verification | hotels:status | verify / reject (note required) |
| GET | /hotels/bookings | bookings:view | cross-hotel list; filters status/paymentStatus/hotelId/zone; customer phone masked (D26) |
| GET/POST | /hotels/{id}/bookings | bookings:view/add | POST row-locks the hotel; overlapping PENDING/CONFIRMED/CHECKED_IN stay → 409 CONFLICT |
| GET | /hotels/bookings/{bookingId} | bookings:view | |
| POST | /hotels/bookings/{bookingId}/status | bookings:status | doc 10 machine (PENDING→CONFIRMED/CANCELLED, CONFIRMED→CHECKED_IN/CANCELLED, CHECKED_IN→CHECKED_OUT); cancelling a PAID booking flips the payment to REFUNDED |
| GET/POST | /hotels/dining | dining:view/add | venue (hotel or restaurant) must be in the same zone; unknown venue → 404 |
| GET | /hotels/dining/{diningId} | dining:view | |
| POST | /hotels/dining/{diningId}/status | dining:status | PENDING→CONFIRMED/CANCELLED; CONFIRMED→COMPLETED/CANCELLED/NO_SHOW |
| GET/POST | /menu-items | menu:* | filter by vendor / vendorId / category / status |
| GET | /menu-items/menus | menu:view | aggregate (owner kind × approval status) for the All Menus tab |
| PATCH/DELETE | /menu-items/{id} | | edits keep the stored approval status |
| POST | /menu-items/{id}/approval | menu:status | `{ decision, reason? }`; reason required to REJECT |
| POST | /menu-items/bulk | menu:status | `{ ids, action: APPROVE\|ARCHIVE }`; per-item skip on illegal transition |
| POST | /menu-items/import | menu:add | `{ csv, dryRun }`; header `zone,provider,type,name,description,category,price,dietary` (first six required, extra columns ignored; rows ≤ 1000, CSV ≤ 400 000 chars, price = whole rupees 1–999999 → paise ×100). Dry-run returns the report only (no writes, no audit); a real run creates the valid rows PENDING + one `menu.import` audit row. Response `{ dryRun, total, valid, invalid, duplicates, created, errors: [{ row, field?, issue }] }`. Rows whose owner name is missing/ambiguous are errors; a (vendor, name) already on the menu counts as a duplicate (a re-run creates nothing, doc 44 §5); a category already live for that provider is a row error (D119 partial unique index — never a 500); cells starting `= + - @` are `'`-escaped on the way in (doc 13 T16). The permission cell carried the `(P1)` marker until this shipment — resolved to `menu:add` because the call creates items |
| GET | /orders | orders:view | filters, search, scope |
| GET | /orders/{id} | orders:view | items, timeline, payment panel |
| POST | /orders/{id}/transition | orders:status | `{ to, note }` |
| POST | /orders/{id}/assign | orders:edit | `{ deliveryPartnerId }`; partner must be in the order's zone |
| POST | /orders/{id}/cancel | orders:status | `{ reasonCode, note }` |
| GET | /orders/export | orders:view | async export job (24 h link) |
| GET | /customers, /customers/{id} | customers:view | scope rule D25 |
| POST | /customers | customers:add | `source=ADMIN` (D28) |
| PATCH | /customers/{id}, POST /customers/{id}/block, /unblock | customers:edit/status | |
| GET | /customers/{id}/reveal | customers:view | audited unmask of phone/email (D26) |
| GET/POST | /delivery-partners | delivery:* | |
| PATCH | /delivery-partners/{id} | delivery:edit | |
| POST | /delivery-partners/{id}/verification | delivery:status | |
| POST | /delivery-partners/{id}/force-offline | delivery:status | |
| GET/POST | /third-party-providers | providers:* | separate provider companies — never mixed with own `delivery-partners` |
| PATCH | /third-party-providers/{id} | providers:edit | zone coverage is many-to-many (doc 36) |
| POST | /third-party-providers/{id}/status | providers:status | `{ status }`; integration status is a flag, never credentials |
| GET/POST | /cash-settlements | settlements:* | COD settlement per partner |
| GET | /payments, /payments/{id} | payments:view | |
| POST | /orders/{id}/refunds | refunds:create | idempotent; limits read from the member's assignment for the order's zone (per refund, per day) |
| GET | /refunds?status=PENDING_APPROVAL | refunds:view | |
| POST | /refunds/{id}/approve, /reject | refunds:approve | Super Admin; requester ≠ approver |
| POST | /refunds/{id}/retry | refunds:create | same idempotency key |
| GET | /payouts | payouts:view | `?payeeType=RESTAURANT|HOMEMAKER|DELIVERY_PARTNER` (Figma tabs) |
| POST | /payouts/{id}/mark-paid | payouts:edit | Super Admin, re-auth |
| GET | /reconciliation/runs, /reconciliation/runs/{id} | payments:view | |
| GET/PUT | /settings/{group} | settings:view/edit | Super Admin |
| GET/POST | /notifications | notifications:* | compose (Super Admin); GET also lists operational alerts for the caller |
| GET | /audit-logs | audit:view | cursor paginated; entity filter for Activity tabs |
| GET/DELETE | /sessions, /sessions/{id} | self or Super Admin | |
| POST | /webhooks/payments/{provider} | signature | public endpoint |
| POST | /uploads/presign, /uploads/confirm | authenticated | content-type and size allow-list; presign body carries `purpose, zoneId, entityId`; Super Admin only until SA-1.7 (keys embed a zone) |

## Integration API (D18, D50)
Base `/api/v1/intake`, used by the **customer, vendor and partner app backends**, authenticated by HMAC (doc 42 §1), scoped per client. Full contract: `G-integration/42_App_to_Admin_Integration_Contract.md` and `G-integration/contracts/intake.openapi.yaml` (authoritative). Outbound webhooks, event catalogue and the pull feed: doc 43.
| Group | Paths (see doc 42 §5 for all) |
|---|---|
| Common | `GET /ping`, `/config`, `/zones/resolve`, `/events`, `POST /uploads/presign`, `/uploads/confirm` |
| Customer app | `PUT /customers/{id}`, `PUT/DELETE /customers/{id}/addresses/{id}`, `POST /orders`, `GET /orders/{id}`, `POST /orders/{id}/cancel`, `POST /payments/{orderId}/attempts` |
| Vendor app | `POST /vendors`, `PATCH /vendors/{id}`, `/documents`, `PUT /hours`, `POST /availability`, `PUT/DELETE /menu-items/{id}`, `POST /menu-items/{id}/stock`, `POST /orders/{id}/vendor-response` |
| Partner app | `POST /partners`, `PATCH /partners/{id}`, `/documents`, `POST /availability`, `POST /location`, `POST /orders/{id}/partner-events`, `POST /partners/{id}/cash-handover` |
Admin-side endpoints added for the Integration Hub (Super Admin, `integrations:*`): `GET/POST /integrations/clients`, `PATCH /integrations/clients/{id}` (scopes, IP list, disable), `POST /integrations/clients/{id}/rotate-secret`, `GET/POST/PATCH /integrations/webhooks`, `POST /integrations/webhooks/{id}/test`, `GET /integrations/events?direction=in|out`, `POST /integrations/deliveries/{id}/retry`, `POST /integrations/deliveries/retry-dead`, `GET /integrations/alerts`, `POST /integrations/alerts/{id}/ack`, and the inbox `GET /registrations?type=&zoneStatus=` (scope-filtered; `zoneStatus=UNASSIGNED` Super Admin only), `POST /registrations/{type}/{id}/assign-zone` (Super Admin).

## Sample: transition order
Request `POST /orders/{id}/transition` `If-Match: 4` `{ "to": "ACCEPTED", "note": "" }`
Response 200 `{ "data": { "id": "…", "status": "ACCEPTED", "version": 5 } }`. Invalid: 409 `INVALID_STATE_TRANSITION`. Order outside scope: 404.

## Rate limits
Login 5/min/IP and per account; general 300/min/user; intake per client; webhooks exempt from user limits but signature-verified.

## Standards
Zod schema is the single source for request validation and OpenAPI; responses use `data` envelope; dates ISO 8601 UTC; money integer paise with `currency: "INR"`; IDs UUID.
