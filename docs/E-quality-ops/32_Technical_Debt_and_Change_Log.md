# 32 — Technical Debt and Change Log (v2.0)

## 1. Known limitations and deferred decisions
| ID | Item | Type | Owner | Revisit |
|---|---|---|---|---|
| TD-1 | ~~Auth provider assumption (Auth.js)~~ closed: in-house session auth (D5 changed) | Closed | Tech lead | — |
| TD-2 | Payment gateway undecided (D6) | Decision | Product owner | Before SA-6 (week 15) |
| TD-3 | ~~One zone per admin enforced in app only~~ closed: multi-zone (D3 changed) | Closed | — | — |
| TD-4 | Zonal Admin Payments sidebar entry / refund screens not in Figma (D36) | Design gap | Designer | Before ZA-6 |
| TD-5 | Homemaker fields inferred; Figma shows only the list, confirm detail/add form | Spec gap | Product owner | SA-2.3 |
| TD-6 | Refund limits (INR 1,000 / 5,000) are assumptions (D13/D20) | Business | Super Admin | Before SA-6.4 |
| TD-7 | Real-time via Socket.IO with polling fallback | Architecture | Backend | If load requires |
| TD-8 | No impersonation, no vendor-facing panel | Scope | Product owner | Post launch |
| TD-9 | RLS optional second barrier not enabled by default | Security | Backend | After MVP |
| TD-10 | Retention periods need legal and accountant confirmation | Compliance | Legal | Before launch |
| TD-11 | Analytics, Offers, Reviews, Support deferred to P2 (SA-8) | Scope | Product | After pilot |
| TD-12 | Naming: ZOAURO (logo) vs GloAro (PDF/company) vs "GloAro Mart" (Figma zone page) (D21) | Naming | Product owner | F0.1 |
| TD-13 | Existing backend/apps unknown (D18); pack provides Integration API (Mode A) and an adapter option (Mode B); app teams must review contract | **Blocker** | Product owner | Before F1.1 (end of S0) |
| TD-14 | 16 of 29 Figma screens not received (doc 37 §1); builds are provisional | Design gap | Designer | Per phase |
| TD-15 | Hosting starts single-host; ECS/Terraform/Multi-AZ/WAF deferred (D31) | Architecture | DevOps | After pilot |
| TD-16 | Partner sharing across zones not supported (R-DEL-2) | Limitation | Product owner | If operations need it |
| TD-17 | Theme toggle, Hotels tab not in v1 (D23, D33). **SMS OTP is no longer deferred: built in v1 behind a provider interface, off until a provider and DLT template exist (D67, doc 52). The real provider adapter is deferred (D68)** | Scope | Product owner | Post launch |

## 2. Architecture decision records
| ADR | Date | Decision | Status |
|---|---|---|---|
| ADR-001 | 2026-10-09 | Modular monolith: Next.js web + Express API | Accepted (v1.1 revised) |
| ADR-002 | 2026-10-09 | REST + OpenAPI generated from shared Zod | Accepted |
| ADR-003 | 2026-10-09 | Zone scope enforced in repository layer, N-zone aware (+ optional RLS) | Accepted (v1.1 revised) |
| ADR-004 | 2026-10-09 | ~~AWS ECS Fargate + Terraform~~ superseded by single-host Docker + RDS + S3 first | Superseded |
| ADR-005 | 2026-10-09 | ~~Auth.js~~ superseded by in-house session auth in the API | Superseded |
| ADR-006 | 2026-10-09 | Money as integer paise; soft deletes; outbox for events | Accepted |
| ADR-007 | 2026-10-09 | Socket.IO zone rooms joined server-side | Accepted |
| ADR-009 | 2026-10-10 | Access = profile + overrides + limits per member per zone; resolved per request, never stored in session (D41) | Accepted |
| ADR-010 | 2026-10-10 | Three-developer ownership by module, schema gatekeeper (doc 40) | Accepted |
| ADR-011 | 2026-10-10 | Apps push to an HMAC-signed Integration API; Core sends signed webhooks + pull feed (D50, D51, D56) | Accepted |
| ADR-012 | 2026-10-10 | One writer per field, locked admin fields (D55) | Accepted |
| ADR-008 | 2026-10-09 | Separate repo/DB from GloAro CRM/ERP | Proposed (D17) |

## 3. Decision and requirement changes (append only)
| Date | Change | By | Docs affected |
|---|---|---|---|
| 2026-10-09 | Homemaker confirmed as separate entity (D1) | Product owner | 03, 08, 18, 20, 21 |
| 2026-10-09 | Zonal Admin full control within zone (D2) | Product owner | 03, 04, 14 |
| 2026-10-09 | ~~One zone per Zonal Admin now (D3)~~ | Product owner | superseded below |
| 2026-10-09 | Zonal Admin controls payments and refunds (D4) | Product owner | 03, 04, 16, 18 |
| 2026-10-09 | Auth.js proposed as default (D5) | Assistant | superseded below |
| 2026-10-09 | Pack version 1.0 generated | — | All |
| 2026-10-09 | **D3 reversed**: a Zonal Admin may hold many zones; D7 decided (several admins per zone) | Product owner (request), Assistant (spec) | 02, 03, 04, 05, 08, 09, 14, 16, 18, 20–25, 36 |
| 2026-10-09 | **D5 changed**: in-house session auth replaces Auth.js | Assistant | 06, 12, 14 |
| 2026-10-09 | **Stack aligned to GloAro CRM stack (D16)**; hosting right-sized (D31) | Assistant — **needs owner confirmation** | 06, 07, 09, 12, 23, 29, 30, 31 |
| 2026-10-09 | Schema gaps filled (outbox, idempotency_keys, cash_settlements, exports, api_clients, reconciliation_runs, refund_daily_usage, homemaker daily_capacity, vendor verification, zone state/UPCOMING) | Assistant | 08, 10 |
| 2026-10-09 | Figma reconciliation applied (D22–D40) | Assistant — **needs owner confirmation** | 03, 18, 20, 21, 22, 37 |
| 2026-10-09 | Pack v1.1 "dev-ready" generated; backlog replaced by phase plans 33–35 | Assistant | 27, F-execution |
| 2026-10-10 | **v1.2:** access model D41–D49; D20 changed to per member per zone; D30 changed (custom profiles P0); Super Admin superior, several members per zone | Product owner request | 03, 04, 08, 09, 14, 18, 20, 22, 36 |
| 2026-10-10 | Estimate corrected: about 62 dev-weeks, about 24 weeks with 3 developers (earlier 2-developer 26 weeks was optimistic, about 31 weeks) | Assistant | 35, 40 |
| 2026-10-10 | **v2.0:** data fed by customer, vendor and partner apps; docs 41–48 and `contracts/` added; D50–D58; D51 changes bearer token to HMAC; R-VEN-3 refined | Product owner request | 03, 06, 08, 09, 12–14, 24, 25, 30, 31, 34, 39, 40 |
| 2026-10-10 | Estimate: integration adds about 7.5 dev-weeks; about 26 weeks with 3 developers (was 24, doc 40 v1.2) | Assistant | 40 |
| 2026-10-10 | M04 Audit and Logs module guide (doc 50); D59–D62; `audit_logs` redefined; M04 effort ≈ 3.3 dev-weeks (was 1.4); TC-AUTH-2 corrected to 30 min | Product owner request | 03, 04, 07, 08, 09, 13, 15, 24, 25, 34, 39, 40, 50 |
| 2026-10-10 | M04 module guide v1.1 after building a verified bundle: third DB role `zoauro_purge` (D64), sixth index + two expression indexes, date filters via id bounds, diff-before-redact, zone rule for customers (D63), 70 tests + 13 performance tests | Assistant — **D63 needs owner confirmation** | 03, 08, 12, 50 |
| 2026-10-12 | Auth module guide (doc 52) and Zones module guide (doc 53) with prompts (doc 54): 2-step verification by authenticator, email OTP, SMS OTP (off by default), backup codes. **Changes** doc 14 §2 "SMS kept off" and TD-17 (D67); doc 08 `mfa_secret_encrypted`/`backup_codes_hash` replaced by tables; doc 09 `/auth/2fa/*` replaced; 2-step enforcement moves from Gate 3 to Gate 1; new D65–D90, T30–T43, TC-AUTH-6…47, TC-ZONE-5…30; effort +≈3.9 dev-weeks on auth, zones sized ≈3.4 | Product owner request | 02, 03, 05, 06, 08, 09, 11, 12, 13, 14, 17, 20, 24, 25, 31, 34, 37, 39, 40, 42, 50, AGENTS, README |
| 2026-10-12 | Idempotency (doc 56 P2): the key is now settled **before** the response is sent (was: after `finish`), so an immediate retry gets the replay or a released key instead of a 409; each idempotent response waits for one key write, capped at 5 s (`SETTLE_TIMEOUT_MS`, new; after it the response is sent and the key ages out as in progress). `errorHandler`: an error raised after an idempotent response was committed is logged (class name only) and no longer passed to Express's final handler, which would destroy the socket. Unchanged: only 2xx stored, same key + different body 422, in progress 409. Supersedes F1.4 decision 4 in `docs/handoff.md` | Assistant (owner reviewed the diff) | 56, handoff |
| 2026-10-12 | Audit hardening (doc 56 P3): (1) `reauth.failed` is a DENIED row via `recordDenied()` (Redis limiter, 1 per actor and action a minute, D62), and `user.locked` is written only on the transition into the locked state; (2) env `TRUST_PROXY_HOPS` (default 0) sets Express `trust proxy`; (3) audit labels of user actions are the user's name (`session.revoked`: "name (user id)"), never the email; `login_history.email_attempted` stores the account address in lower case only when it matches a user, otherwise `<first character>***@***` (domain masked too, so a password typed as an address is never kept); (4) boot guard: `select current_user` must equal the DATABASE_URL role and be in env `DATABASE_ALLOWED_ROLES` (default `zoauro_app`), else the API exits; the worker has no database connection yet, so it gets the guard when it does; an unreachable database at boot now also stops the API; (5) `GET /audit-logs/{id}` already applied the entity-mode restriction: tests only | Assistant — owner approved the proposed defaults | 12, 50, 56 |
| 2026-10-12 | Auth schema (doc 56 P4, doc 52 §3): migration `20261012100000_auth_two_step`. Type choices doc 52 leaves open: `sessions.mfa_method`, `login_history.mfa_method`, `sessions.reauth_level`, `sessions.restricted` are **text** checked by Zod enums in `@zoauro/shared` (`auth-mfa.ts`), not database enums (mfa_method also takes `BACKUP_CODE`, which is not an MfaType); `mfa_challenges.ip` is `inet` as doc 52 says (other `ip` columns stay text); `sessions.remember` NOT NULL default false. `login_history.reason` keeps the four values the service already writes (`LOGIN` for success, `LOGOUT`, `UNKNOWN_USER`, `MFA_UNSUPPORTED`) next to the doc 52 list until M01 switches success to `OK` and builds the second step. Shared validation additions not stated in doc 52: each role's allowed-method list is non-empty and without repeats; member 2-step reset reason ≤ 500 characters; lockout and session values are positive integers (doc 52 gives no bounds). Separate action `user.mfa_locked` (doc 52 §4 option) | Assistant — owner approved the proposed defaults | 08, 52, 56 |
| 2026-10-12 | Zones schema (doc 56 P5, doc 53 §3): migration `20261012110000_zones_schema`. **Replaced, not duplicated:** the partial `zones_code_active_key` by a full UNIQUE(code) (code reserved incl. soft-deleted, R-ZONE-3, owner's decision in the P5 prompt); the case-sensitive `zones_name_key` by unique `lower(name)` where not deleted (R-ZONE-4); the plain pincode index by UNIQUE(pincode). Status default ACTIVE → UPCOMING (test fixtures that relied on ACTIVE now set it). The range CHECK is "both ends or neither, from ≤ to" (doc 53 allowed a half range through SQL NULL semantics). Removing a pincode must delete the row: `serviceable_pincodes.deleted_at` stays but a soft-deleted row would keep the pincode reserved. **Assumed (no design source):** the 12 palette hex values are the Tailwind 600 shades (`packages/shared/src/zones/palette.ts`; designer may replace values, not the count); city/state ≤ 100 characters; a pasted pincode list ≤ 2000 per request like a range. Zone error codes live in `@zoauro/shared/zones` and join `ERROR_STATUS` with the P11 routes. `zone.deactivated` is now HIGH as doc 50 §4 marks it | Assistant — P5 prompt | 08, 50, 53, 56 |
| 2026-10-12 | Libraries for M01 (owner approved): `otplib` 13.5.0 (named in doc 06) and `nodemailer` 10.0.11 (not named in doc 06; the SMTP client for Mailpit locally and an SMTP provider later; ships its own types). Pinned exactly | Owner | 06 |
| 2026-10-12 | Auth CSRF and cookies (doc 56 P6, owner decisions): session cookie renamed `zoauro_session` → `zo_sid` (doc 52 §2.6). **Hybrid CSRF** instead of doc 52's double submit everywhere: routes with a session keep the session-bound token (HMAC of the session hash, returned by login and /me); POSTs made before a session exists (`/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, and the 2-step routes of P8–P10) need `GET /auth/csrf`: cookie `zo_csrf` (HttpOnly, Secure, SameSite=Strict, 2 h) equal to `X-CSRF-Token`; the token is signed (`<nonce>.<HMAC(SESSION_SECRET)>`) so a cookie planted from a sibling subdomain is refused. The Origin check stays | Owner (decision), Assistant | 09, 14, 52 |
| 2026-10-12 | Password change (doc 56 P6): `POST /auth/change-password {current, new}` also ends the first-login restriction (`sessions.restricted = 'PASSWORD_CHANGE'` while pending). Choices doc 52 leaves open: a wrong current password is a 422 on `current` **and counts toward the lockout** (5 → 30 min, like a wrong login); a locked account cannot change it (403); success revokes every **other** session (audited `session.revoked`) and keeps the current one. New-password rule for reset and change: ≥ 12 characters, not on the local denylist `packages/shared/src/password-policy.ts` (≈ 90 common 12+ character passwords incl. product names; case and spaces ignored; one repeated character refused), different from the current one. The authorization-matrix test gets its own 180 s budget: one test covers every route × actor and grows with the API | Assistant — P6 | 14, 52 |

## 4. Process
Any change to a decision, contract or convention adds a row here and updates the affected documents in the same PR. Post-mortem actions and deferred refactors are added as TD items with owner and revisit date. Review this file at the end of each phase.
