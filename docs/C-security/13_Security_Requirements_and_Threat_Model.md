# 13 — Security Requirements and Threat Model

Target: OWASP ASVS Level 2 for the admin panel; OWASP Top 10 coverage.

## 1. Assets
Admin credentials and sessions; customer PII (name, phone, address); vendor and partner documents; payment and refund records; commission and payout data; settings; audit logs.

## 2. Trust boundaries
Internet ↔ Nginx (CloudFront/WAF/ALB added after pilot, doc 06 §5) ↔ web + API containers ↔ RDS/Redis/S3; app ↔ payment gateway (outbound + inbound webhook); admin browser ↔ app (authenticated). Webhook endpoint is the only public unauthenticated write path.

## 3. Threats and mitigations (STRIDE-oriented)
| ID | Threat | Impact | Mitigation | Owner |
|---|---|---|---|---|
| T1 | Zonal Admin reads or edits another zone (IDOR) | Data breach | Zone filter in repository, 404 on mismatch, authz tests on every endpoint, optional RLS | Backend lead |
| T2 | Privilege escalation (Zonal Admin gains Super Admin power) | Platform takeover | Server-side RBAC, no role in client-trusted fields, role changes audited, sessions revoked on change | Backend lead |
| T3 | Credential stuffing / brute force | Account takeover | Rate limit, lockout, Argon2id, 2FA, breached-password check, generic errors | Backend lead |
| T4 | Session theft (XSS, cookie) | Account takeover | HTTP-only Secure SameSite cookies, strict CSP, output encoding, no `dangerouslySetInnerHTML` | Frontend lead |
| T5 | CSRF on state changes | Unauthorised actions | CSRF token + SameSite, Origin check | Backend lead |
| T6 | SQL injection | Data breach | Prisma parameterised queries; raw SQL only via tagged templates and reviewed | Backend lead |
| T7 | Fake payment webhook | Free orders, fraud | Signature verification, raw body, event dedupe, re-fetch payment from gateway | Payments owner |
| T8 | Duplicate refund / double click | Financial loss | Idempotency keys, row locks, refund ≤ captured, limits, approval queue | Payments owner |
| T9 | Malicious file upload | Malware, XSS | Type/size allow-list, content sniffing, private bucket, randomised keys, optional AV scan, never serve inline from app domain | Backend lead |
| T10 | Insider misuse by admin | Fraud | Audit log, refund limits, daily refund alerts, least privilege | Super Admin |
| T11 | Secrets leak | Full compromise | Secrets Manager, no secrets in repo (secret scanning), rotation | DevOps |
| T12 | Dependency vulnerability / supply chain | Compromise | Dependabot, `pnpm audit` in CI, lockfile, pinned actions | DevOps |
| T13 | DoS / scraping | Outage | WAF rate rules, autoscaling, pagination caps, export as async job | DevOps |
| T14 | Sensitive data exposure in logs/errors | Privacy breach | Log redaction, generic error bodies, Sentry scrubbing | Backend lead |
| T15 | Insecure direct export (CSV) | Data leak | Same authz and zone filter, audit on export, formula-injection escaping | Backend lead |
| T16 | CSV/Excel formula injection in imports/exports | Client compromise | Prefix `'` for cells starting `= + - @` | Backend lead |
| T17 | SSRF via integrations/URL fields | Internal access | No server fetch of user URLs; allow-list outbound | Backend lead |
| T19 | Multi-zone scope confusion: admin of A+B reads C through forged zone id, shared cache key, socket room, bulk ids or global search | Cross-zone breach | Scope = requested ∩ assigned on every path; scope hash in cache keys; rooms joined server-side; bulk ids filtered; tests TC-MZ-1…15 (doc 36) | Backend lead |
| T20 | Stale zone access after assignment revoked | Unauthorised access | Scope resolved per request, not stored in session; cache invalidated on change; socket leaves rooms | Backend lead |
| T21 | Over-grant: access profile or override gives a Zonal Admin an ungrantable module (zones, access, settings, commission) | Privilege escalation | Server-side allow-list of grantable modules; Access editor cannot save them; test TC-AC-6 | Backend lead |
| T22 | Member reads or changes their own or colleagues' access | Escalation | Access endpoints Super Admin only; zonal 403/404; TC-AC-7 | Backend lead |
| T23 | App client secret extracted from a mobile app or leaked in a repo | Forged orders/events | Only app **backends** hold secrets; per-client scopes and IP allow-list; rotation with 24 h overlap; kill switch; anomaly alerts | Integration |
| T24 | Forged, tampered or replayed app events | Fake orders, state corruption | HMAC over method+path+body hash, 5-minute timestamp window, idempotency keys, state machine and `version` checks, inbound log | Integration |
| T25 | Webhook URL used for SSRF (internal addresses) | Internal network access | HTTPS only, block private/loopback/link-local, no redirects, DNS re-check at send time, outbound allow-list option | Integration |
| T26 | Compromised or buggy app client manipulates prices, other vendors' orders or floods | Fraud, data corruption | Server re-validates prices from menu; entity checks (`ENTITY_MISMATCH`); scopes; rate limits; locked fields never writable by apps | Integration |
| T27 | Tampering with or deleting audit rows | Hidden misuse | App DB role INSERT/SELECT only, trigger, no API verbs, purge only by retention job after 3 years (doc 50) | M04 |
| T28 | Secrets or personal data leaking into audit JSON | Data exposure | Redaction before insert, registry test against the schema, masked phone/email | M04 |
| T29 | Audit flooding / storage abuse | Cost, noise | Denied rows rate limited, bulk actions one row, export caps, app event streams excluded (D59) | M04 |
| T30 | OTP / TOTP guessing | Account takeover | Per-code attempt cap, 5 failures lock 30 min (D77), rate limits, 5-min expiry, timing-safe compare (doc 52; TC-AUTH-10…14) | M01 |
| T31 | SMS pumping / OTP flooding | Cost, harassment | Destination never user-supplied, cooldown, hourly/daily caps, global SMS cap and circuit breaker, SMS off by default (TC-AUTH-17…20) | M01 |
| T32 | SIM swap / mailbox takeover defeats OTP | Account takeover | Super Admin authenticator-only by default (D66), new-method emails, STRONG re-auth (TC-AUTH-26, 29) | M01 |
| T33 | 2-step downgrade (attacker picks weakest method) | Bypass | Allowed methods per role evaluated server-side; unenrolled/disallowed method rejected (TC-AUTH-21) | M01 |
| T34 | Enrolment hijack with a temporary password | Attacker owns factor | Mailbox proof before enrolment; gate order password → second step → change password (TC-AUTH-22) | M01 |
| T35 | TOTP secret theft from DB or backup | Permanent compromise | AES-256-GCM, key id and rotation, never returned after enrolment, redacted from audit (TC-AUTH-30) | M01 |
| T36 | TOTP code replay | Session theft | Last-used step guard, short window (TC-AUTH-11); real-time phishing relay is residual until passkeys | M01 |
| T37 | Recovery abuse (social engineering) | Bypass | STRONG re-auth, reason, member email, HIGH audit, ≥ 2 Super Admins, audited CLI (TC-AUTH-31…34) | M01 |
| T38 | Pending-login cookie theft / fixation | Skip step 1 | Opaque, Strict, 5 min, single use, new session id on success (TC-AUTH-9) | M01 |
| T39 | Enumeration through the second step | Valid emails learned | Methods shown only after correct password; identical errors and timing (TC-AUTH-35) | M01 |
| T40 | Pincode overlap / hijack between zones | Wrong team, misrouted orders | DB unique index, advisory-locked check, HIGH audit, mismatch report, Super Admin only (TC-ZONE-6…9) | M02 |
| T41 | Accidental or malicious zone deactivation | Outage | Impact check, reason, acknowledgement, re-auth, HIGH audit, reversible without cascade (TC-ZONE-14…17) | M02 |
| T42 | Zone resolver abuse / scraping | Info leak, load | Client scope, rate limit, closed zones shown as NONE, cache (TC-ZONE-20, 21) | M02 |
| T43 | Stale zone cache accepts orders for a closed zone | Wrong serviceability | Version bump in commit path; intake re-checks the zone row (TC-ZONE-19) | M02 |
| T18 | Admin account created by attacker | Takeover | Only Super Admin creates admins; email verification; audit | Super Admin |

## 4. Security requirements
- SEC-1 HTTPS only, HSTS, TLS 1.2+.
- SEC-2 Headers: CSP (no inline scripts, nonces), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- SEC-3 All inputs validated by Zod on server; output encoded.
- SEC-4 Authorization on every API route and data access.
- SEC-5 Encrypt at rest (RDS, S3, Redis in-transit/at-rest) and sensitive columns (MFA secret) at application level.
- SEC-6 Audit log is append-only and not editable from the app: enforced by database privileges (app role INSERT/SELECT only) and a trigger that blocks UPDATE, DELETE and TRUNCATE (doc 50 §3.2).
- SEC-7 Least-privilege IAM; app task role limited to its bucket and secrets.
- SEC-8 No real data in staging.
- SEC-9 Security regression tests run in CI (doc 24).
- SEC-10 Pen test before launch.

## 5. Residual risks
Compromised Super Admin with valid 2FA; mitigated by 2FA enforcement, alerts on high-risk actions (zone delete, role change, bulk refunds), and limited Super Admin accounts.
