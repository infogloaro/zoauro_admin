# 24 — Test Strategy and Test Cases

## 1. Pyramid
| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest | Services, utils, Zod schemas, state machine | 80% on `modules/*/service.ts` and `lib` |
| Integration | Vitest + real PostgreSQL (Testcontainers) | Repositories, API routes, transactions, migrations | Every endpoint |
| Authorization | Vitest matrix | Actor (SuperAdmin, Admin(A), Admin(A+B), Admin(none)) × zone relationship × endpoint | 100% of endpoints |
| E2E | Playwright | Critical user journeys, both roles | ~25 flows |
| Component | Testing Library | Forms, tables | Key components |
| Accessibility | axe in Playwright | Core pages | No critical violations |
| Performance | k6 | Dashboard, orders list | Meets doc 02 targets |
| Security | `pnpm audit`, OWASP ZAP baseline, Semgrep | Whole app | No high issues |

## 2. Authorization test matrix (auto-generated from the OpenAPI spec)
For each endpoint test: unauthenticated (401); Admin(A) own zone (allowed per matrix); Admin(A) zone B (404); Admin(A+B) zones A and B (allowed), zone C (404), forged `zoneId` filters (404); Admin(none) (empty/404); capability missing (403); Super Admin (allowed). List endpoints must return only own-zone rows; counts and exports too; search must not leak.

## 3. Key test cases
| ID | Area | Case | Expected |
|---|---|---|---|
| TC-AUTH-1 | Login | Valid credentials | Role-based redirect |
| TC-AUTH-2 | Login | 5 wrong passwords | Locked 30 min (D37), audit entry |
| TC-AUTH-3 | 2FA | Wrong code | Rejected, attempts limited (detail: TC-AUTH-10…14) |
| TC-AUTH-4 | Session | Idle past timeout | Redirect to login |
| TC-AUTH-5 | Reset | Reused token | Rejected |
| TC-AUTH-6 | Login | Correct password, user has a method | `MFA_REQUIRED`, `zo_mfa` set, **no `zo_sid`**, `/me` returns 401 |
| TC-AUTH-7 | Login | Correct password, no method, policy off | session created directly |
| TC-AUTH-8 | Login | Wrong tab with correct credentials | same generic error as wrong password; no pending cookie |
| TC-AUTH-9 | Pending | Pending cookie expired / reused after success / from another IP+UA | rejected, must restart |
| TC-AUTH-10 | TOTP | Wrong code ×5 | pending ended, account locked 30 min, `user.locked` audit |
| TC-AUTH-11 | TOTP | Same valid code used twice | second rejected (replay); code from step −1 accepted, step −2 rejected |
| TC-AUTH-12 | Email OTP | Valid code | session created; challenge consumed; reuse rejected |
| TC-AUTH-13 | Email OTP | 5 wrong guesses on one code | challenge dead; new code needed; counts toward lockout |
| TC-AUTH-14 | Email OTP | Expired code (clock +5 min) | rejected with the generic message |
| TC-AUTH-15 | Email OTP | Resend before 30 s | 429 with `retryAfter`; after 30 s new code, old code invalid |
| TC-AUTH-16 | Email OTP | Code stored hashed | DB contains no plaintext code; logs contain none |
| TC-AUTH-17 | Caps | 6th send in an hour | 429; 11th in a day 429 |
| TC-AUTH-18 | SMS | `smsEnabled=false` | `SMS_OTP` not listed, challenge → 409/403, verify rejects |
| TC-AUTH-19 | SMS | Enabled with console provider | message to the E.164 on record only; body matches the template; request body cannot change destination |
| TC-AUTH-20 | SMS | Global hourly cap reached | SMS paused, email/TOTP unaffected, Super Admin notified, `sms.paused` audit |
| TC-AUTH-21 | Policy | Verify with a method not allowed for the role / not enrolled | rejected as invalid; no hint |
| TC-AUTH-22 | Enrol | Authenticator start without mailbox proof (pending, zero methods) | 403 |
| TC-AUTH-23 | Enrol | Half-finished authenticator enrolment | login does not offer it; no lockout |
| TC-AUTH-24 | Enrol | Confirm with valid code | active, primary, 10 backup codes returned once; second call returns none |
| TC-AUTH-25 | Enrol | Complete without acknowledging backup codes | 409 |
| TC-AUTH-26 | Backup | Use a backup code | works once; reuse rejected; email sent; `user.backup_code_used` |
| TC-AUTH-27 | Backup | Regenerate | old codes invalid; needs `STRONG` |
| TC-AUTH-28 | Policy | Super Admin policy tries `required=false` or removes AUTHENTICATOR | 422 |
| TC-AUTH-29 | Policy | Zonal Admin enrolled only with SMS, SMS later disabled | next login → `ENROLMENT_REQUIRED`; sessions revoked at switch time |
| TC-AUTH-30 | Crypto | Stored authenticator secret | not plaintext; opens with current and previous key; audit rows contain no secret |
| TC-AUTH-31 | Recovery | Admin resets a member's 2-step | methods+codes gone, sessions revoked, email sent, audit HIGH with reason; Zonal Admin cannot call it (403) |
| TC-AUTH-32 | Recovery | Reset without `STRONG` | 403 `REAUTH_REQUIRED` |
| TC-AUTH-33 | Recovery | CLI reset | audit row actor SYSTEM, note has operator; fails without the production env |
| TC-AUTH-34 | Recovery | Last active Super Admin | Security Status shows warning |
| TC-AUTH-35 | Enumeration | Unknown email vs known email, wrong password | identical body; response-time difference below noise threshold |
| TC-AUTH-36 | Step-up | `PASSWORD` action with a 11-minute-old re-auth | 403; with 9 minutes OK; `STRONG` valid once |
| TC-AUTH-37 | Sessions | 4th login | oldest session revoked and audited |
| TC-AUTH-38 | Sessions | Password reset | all sessions revoked; next login still needs the second step (D76) |
| TC-AUTH-39 | Sessions | Remember me | cookie lifetime 7 d; idle 8 h; second step not skipped on a new login |
| TC-AUTH-40 | Password | First login with temp password | order: second step before change-password; restricted session can call only allowed routes |
| TC-AUTH-41 | CSRF | POST `/auth/mfa/verify` without token | 403 |
| TC-AUTH-42 | Cookies | Flags on `zo_sid`, `zo_mfa`, `zo_csrf` | HttpOnly/Secure/SameSite as specified |
| TC-AUTH-43 | Audit | Each audited action in §4 | one row, correct actor/zone-less rule, redaction applied; coverage guard (doc 50) green |
| TC-AUTH-44 | Authorization | `/settings/security` as Zonal Admin | 403; `/members/{id}/mfa/reset` as Zonal Admin 403 |
| TC-AUTH-45 | UI (Playwright) | Login → email OTP → dashboard, both roles | passes with Mailpit |
| TC-AUTH-46 | UI (Playwright) | Enrol authenticator end to end using a test TOTP generator | passes |
| TC-AUTH-47 | UI (axe) | `/2fa`, `/2fa/setup`, `/account/security` | no critical violations; keyboard-only run |
| TC-ZONE-1 | Isolation | Zone A admin GET order of zone B | 404 |
| TC-ZONE-2 | Isolation | Zone A admin PATCH vendor of zone B | 404, no change |
| TC-ZONE-3 | Isolation | Dashboard counts | Only zone A |
| TC-ZONE-4 | Isolation | Guess IDs in bulk endpoint | Zone B IDs ignored/rejected |
| TC-ZONE-5 | Auth | Zonal Admin calls every `/zones*` admin route; unauthenticated call | 403 / 401; no data |
| TC-ZONE-6 | Pincodes | Create zone B with a pincode owned by zone A | 409 `PINCODE_OVERLAP` naming A; nothing written |
| TC-ZONE-7 | Pincodes | Two concurrent creates with the same pincode | exactly one succeeds (advisory lock + unique index) |
| TC-ZONE-8 | Pincodes | Range 560001–560100 | 100 rows, source RANGE; edit to 560001–560050 removes 50 and reports mismatches |
| TC-ZONE-9 | Pincodes | Range > 2 000; invalid pincode `012345`, `56001`, `abcdef`, from > to | 422 with field errors |
| TC-ZONE-10 | Create | Duplicate name (different case); duplicate code incl. a soft-deleted zone's code | 409 each |
| TC-ZONE-11 | Create | Charge −1, 100 001, 1.5 | 422 |
| TC-ZONE-12 | Edit | Change `code` | 422 `CODE_IMMUTABLE` |
| TC-ZONE-13 | Edit | Stale `version` | 409 with current values |
| TC-ZONE-14 | Status | Activate with no pincode / no charge | 422 `ZONE_NOT_ACTIVATABLE{missing}` |
| TC-ZONE-15 | Status | Deactivate without reason / without re-auth / stale `impactVersion` | 422 / 403 / 409 |
| TC-ZONE-16 | Status | Deactivate ACTIVE zone with open orders | zone INACTIVE; open orders remain and can advance; new intake order → `NOT_SERVICEABLE`; vendors' stored statuses unchanged (R-ZONE-6) |
| TC-ZONE-17 | Status | Reactivate | intake works again with no other change (R-ZONE-7) |
| TC-ZONE-18 | Status | ACTIVE → UPCOMING | rejected |
| TC-ZONE-19 | Cache | Change charge then resolve immediately | new charge returned; intake order uses the zone row, not the cache |
| TC-ZONE-20 | Resolve | Pincode in ACTIVE / UPCOMING / INACTIVE / unknown / invalid | `ACTIVE serviceable`, `UPCOMING not serviceable`, `NONE`, `NONE`, `NONE` |
| TC-ZONE-21 | Resolve | lat/lng only | `NONE` (documented behaviour); client without scope → 403; rate limit 429 |
| TC-ZONE-22 | Delete | Zone with history | 409 `ZONE_HAS_HISTORY`; pristine zone soft-deletes; code stays reserved |
| TC-ZONE-23 | Impact | Seeded vendors/orders/members | counts exact; `partial:true` while ports are stubs |
| TC-ZONE-24 | Events | Each change | exactly one outbox `zone.updated` and one `admin.zones_changed` row in the same transaction; rollback leaves none |
| TC-ZONE-25 | Audit | Each operation | one audit row with correct action, diff, zone id; charge and pincode changes use their dedicated actions; coverage guard green |
| TC-ZONE-26 | Vendors | Remove a pincode used by a vendor | vendor stays in zone; appears in `mismatches` |
| TC-ZONE-27 | List | KPI counts and per-zone counts vs seeded data | exact; query count constant (no N+1) |
| TC-ZONE-28 | UI (Playwright) | Add zone with overlap error → fix → save → activate → deactivate dialog | flow passes |
| TC-ZONE-29 | UI (axe) | Overlay and dialogs | no critical violations |
| TC-ZONE-30 | Perf | Resolve p95 with 10 000 pincodes | < 50 ms warm, < 150 ms cold |
| TC-ROLE-1 | RBAC | Zonal Admin calls zone create | 403/404 |
| TC-ROLE-2 | RBAC | Zonal Admin edits commission | Rejected |
| TC-ORD-1 | Orders | Valid transition chain to DELIVERED | History rows created |
| TC-ORD-2 | Orders | Skip PREPARING→DELIVERED | 409 INVALID_STATE_TRANSITION |
| TC-ORD-3 | Concurrency | Two admins transition same order | One 200, one 409 |
| TC-ORD-4 | Concurrency | Two admins assign same partner beyond cap | Cap respected |
| TC-VEN-1 | Vendors | Suspended vendor | Hidden, open orders continue |
| TC-VEN-2 | Menu | Item with both restaurant and homemaker | DB CHECK rejects |
| TC-PAY-1 | Payments | Valid signed webhook | Payment PAID, ledger balanced |
| TC-PAY-2 | Payments | Invalid signature | 400, nothing changed |
| TC-PAY-3 | Payments | Webhook replay | 200, no duplicate effect |
| TC-PAY-4 | Payments | Amount mismatch with gateway | Flagged, not PAID |
| TC-REF-1 | Refunds | Zonal refund within limit | Processed |
| TC-REF-2 | Refunds | Above limit | PENDING_APPROVAL |
| TC-REF-3 | Refunds | Same idempotency key twice | One refund |
| TC-REF-4 | Refunds | Refund > captured − refunded | 422 |
| TC-REF-5 | Refunds | Requester approves own | Rejected |
| TC-UPL-1 | Uploads | .exe renamed .jpg | Rejected |
| TC-AUD-1…24 | Audit and logs | Full list in doc 50 §12 | All pass; part of the per-PR regression (TC-AUD-8 and 24 nightly) |
| TC-SEC-1 | Security | XSS payload in vendor name | Escaped everywhere |
| TC-SEC-2 | Security | CSRF without token | 403 |
| TC-SEC-3 | Security | CSV export with `=cmd` cell | Escaped |
| TC-UI-1 | UI | Keyboard-only create zone | Possible |
| TC-INT-1…26 | Integration with apps | Full list in `H-delivery/48` §3 | All pass against simulators in CI and against sandbox before go-live |
| TC-AC-1…14 | Access control | Full list in doc 36 §6b | All pass; per-PR regression |
| TC-MZ-1…15 | Multi-zone | Full list in doc 36 §6 | All pass; part of the per-PR regression suite |

## 5. Regression suite
All TC-ZONE, TC-MZ, TC-AC, TC-INT, TC-PAY, TC-REF run on every PR; E2E smoke on merge; full E2E nightly on staging.

## 6. Test data
Factories (zones A, B and C; Super Admin; Admin(A); Admin(A+B); Admin(none); vendors, orders in all states). Deterministic seeds. No production data.

## 7. Exit criteria
No open P0/P1 bugs; authorization matrix 100% pass; coverage targets met; accessibility and security scans clean.
