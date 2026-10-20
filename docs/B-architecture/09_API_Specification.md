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
Codes: UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, ZONE_NOT_FOUND 404, VALIDATION_ERROR 422, CONFLICT 409, RATE_LIMITED 429, INVALID_STATE_TRANSITION 409, REFUND_LIMIT_EXCEEDED 403, REAUTH_REQUIRED 401, INTERNAL 500. Also STALE_VERSION 409 (optimistic locking), OFFER_EXPIRED 409 (an auto-assign offer that is no longer open, D154) and the zone codes of doc 53 §5 (ZONE_NAME_TAKEN, ZONE_CODE_TAKEN, PINCODE_OVERLAP, IMPACT_CHANGED, ZONE_HAS_HISTORY 409; RANGE_TOO_LARGE, CODE_IMMUTABLE, ZONE_NOT_ACTIVATABLE, REASON_REQUIRED 422); the full list is `ERROR_STATUS` in `packages/shared/src/errors.ts`.
- **Error data (v1.2, additive, P11):** a few codes carry structured data in an optional `error.meta` object: `PINCODE_OVERLAP {conflicts:[{pincode, zoneId, zoneName}]}`, `ZONE_NOT_ACTIVATABLE {missing:[…]}`, `ZONE_HAS_HISTORY {counts}`, `STALE_VERSION {current}` (the newer record), `IMPACT_CHANGED {impact}`. `details[]` still carries the field-level hints for forms.

## Endpoint catalogue
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /auth/login | public | rate limited, lockout |
| POST | /auth/logout | session | |
| POST | /auth/forgot-password, /auth/reset-password | public | generic responses |
| GET | /auth/csrf | public | sets the CSRF cookie, returns token |
| POST | /auth/mfa/challenge, /auth/mfa/verify, /auth/mfa/enrol/complete | pending cookie `zo_mfa` | second step of login (doc 52 §2.1, §8). `/auth/login` returns `OK`, `MFA_REQUIRED` or `ENROLMENT_REQUIRED` |
| POST | /auth/change-password | session | also the forced first-login change |
| GET/POST/PUT/DELETE | /me/mfa, /me/mfa/{email\|authenticator\|sms}/{start\|confirm}, /me/mfa/primary, /me/mfa/{type}, /me/mfa/backup-codes/regenerate | session or pending (enrol) | enrol, manage, remove (STRONG re-auth) |
| GET/DELETE/POST | /me/sessions, /me/sessions/{id}, /me/sessions/revoke-others | session | |
| GET/PUT | /settings/security, GET /settings/security/status, POST /settings/security/sms/resume | Super Admin; PUT needs STRONG re-auth | 2-step policy (doc 52 §5) |
| POST | /members/{id}/mfa/reset | Super Admin + STRONG | `{reason}`; audited |
| POST | /auth/reauth | session | recent re-auth for high-risk actions |
| GET | **/me** | session | role, **zones[] each with granted permissions and limits for that zone** (Zonal Admin) or global flag (Super Admin), preferences |
| PUT | **/me/zone-scope** | session | `{ zoneIds: [] }` saves preference; validated against assignment |
| GET | /dashboard/summary | dashboard:view | scoped aggregates; `?zoneId` |
| GET | /dashboard/order-status, /order-overview, /zone-orders | dashboard:view | `zone-orders` = bar by zone (scope>1) or by area (scope=1) |
| GET | /dashboard/revenue-overview, /top-restaurants, /top-categories, /new-registrations | dashboard:view | Super Admin dashboard widgets (Figma) |
| GET | /search?q= | session | global search (P1, D32); per-entity permission + scope |
| GET/POST | /zones | zones:view/add | Super Admin |
| GET/PATCH/DELETE | /zones/{id} | zones:* | PATCH carries `version` (409 STALE_VERSION), `code` is 422 CODE_IMMUTABLE; DELETE (+ PASSWORD re-auth) soft-deletes a pristine zone that is not ACTIVE and releases its pincodes, else 409 ZONE_HAS_HISTORY / INVALID_STATE_TRANSITION (doc 53 §2.2) |
| GET | /zones/{id}/impact | zones:view | counts of open orders, vendors, partners, admins before deactivate |
| GET | /zones/summary, /zones/lookup?pincode= | zones:view | KPI counts; owning zone of a pincode (live overlap hint) |
| PUT | /zones/{id}/pincodes (`?preview=true` dry run) | zones:edit | range / add / remove; overlap check under advisory lock; returns vendor mismatches |
| POST | /zones/{id}/activate, /zones/{id}/deactivate | zones:status + re-auth | deactivate needs `reason`, `version`, `impactVersion`; no cascade writes (doc 53 §2.1) |
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
| GET/POST | /restaurants | restaurants:* | scoped; POST needs `zoneId`; refused with ZONE_SERVICE_DISABLED when the service is off (D92); list meta carries tab counts; phone/email masked (D26) |
| GET/PATCH/DELETE | /restaurants/{id} | view / edit / delete | detail has documents and the D97 checklist; commission edit Super Admin only; DELETE is soft, PASSWORD re-auth, an active vendor is deactivated first |
| POST | /restaurants/{id}/status | restaurants:status | activate (only once verified), deactivate, suspend; emits `vendor.status_changed` |
| POST | /restaurants/{id}/verification | restaurants:status | verify / reject (note required); emits `vendor.status_changed` |
| POST | /restaurants/{id}/move-zone | zones:edit | Super Admin only, R-VEN-3, PASSWORD re-auth; also assigns an app sign-up without a zone; emits `vendor.updated` (doc 32: `zones:assign` is not an action) |
| POST | /restaurants/{id}/reveal | restaurants:view + reveal flag | audited unmask of phone/email, 30 per member per hour (D123) |
| POST | /restaurants/{id}/documents | restaurants:edit | attach a confirmed upload `{docType, fileKey}`; the key must name this vendor |
| GET | /restaurants/{id}/documents/{docId}/url | restaurants:view | 300 s signed view link; every link is audited (D120) |
| POST | /restaurants/{id}/documents/{docId}/verify | restaurants:status | verify / reject a pending document (note required) (D120) |
| (same set) | /homemakers … | homemakers:* | Home Food checklist not configured (D113) |
| GET/POST | /menu-items | menu:view / menu:add | list filters vendorKind, vendorId, categoryId, availability (live / out_of_stock / vendor_off / admin_disabled), featured, dietary, q; tab counts. POST names one vendor; the item's zone is the vendor's (409 while the vendor has no zone); category global or of that zone (D119) |
| GET/PATCH/DELETE | /menu-items/{id} | view / edit / delete | PATCH applies at once; a vendor-owned field sets `admin_override_at` (doc 44); `adminDisabled` (+ `reason` to disable) is the admin toggle, emits `menu_item.admin_changed` (D126); DELETE is soft |
| POST | /menu-items/bulk/preview, /menu-items/bulk | menu:edit | `{action: availability \| category \| price, ids ≤ 500}`; price by signed percent (half-up) or amount in paise, ≥ 1 paise; all-or-nothing: any id outside the caller's zones → 404, nothing changes (D124); preview writes nothing. Import via `/menu-items/import` (P1) |
| GET | /menu-items/change-requests, /menu-items/change-requests/{id} | menu:view | vendor item-change requests (R09, D119), default status PENDING; detail has base / live / proposed per field |
| POST | /menu-items/change-requests/{id}/approve, /reject | menu:status | `{version}` (+ `reason` to reject); approve applies only name, description, price, category, dietary, image (D127); 409 STALE_VERSION / INVALID_STATE_TRANSITION; emits `menu_item.change_decided` (D125) |
| GET/POST | /categories | menu:view / menu:add | global (`zoneId: null`, Super Admin only) plus zone categories in scope; names unique per zone ignoring case (409) |
| PATCH/DELETE | /categories/{id} | menu:edit / menu:delete | DELETE soft; 409 CATEGORY_IN_USE while live items use it |
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
| GET | /audit-logs | audit:view (Super Admin) or entity mode | Cursor list; filters actor, actorType, module, action, entityType, entityId, zoneId, outcome, sensitivity, q, from, to. Zonal Admin: entity mode only (entityType+entityId), else 403; ip/userAgent/requestId hidden (doc 50 §8) |
| GET | /audit-logs/{id} | as above | detail with changes[] |
| GET | /audit-logs/catalogue | audit:view | modules and action keys for filters |
| POST | /audit-logs/exports | audit:export | Super Admin, re-auth, 3/hour, 100k rows cap, async CSV |
| GET | /exports/{id} | requester | status and 24 h signed URL |
| GET | /login-history | audit:view | Super Admin, cursor |
| GET | /me/login-history | session | own last 50 |
| GET/DELETE | /sessions, /sessions/{id} | self or Super Admin | |
| POST | /webhooks/payments/{provider} | signature | public endpoint |
| POST | /uploads/presign, /uploads/confirm | authenticated + entity scope | presign body `{purpose, contentType, sizeBytes, zoneId, entityId}` (D120): JPEG/PNG/WebP 5 MB, PDF 10 MB, private key `zone/{zoneId}/{entityId}/{uuid}.{ext}`, 300 s PUT; the caller must be able to edit the entity in that zone (vendor module, `menu:edit` for MENU_IMAGE, `delivery:edit` for PARTNER_DOC, D131). Confirm checks existence, stored type/size and content sniffing (doc 13 T9) |

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
