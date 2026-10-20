# 52 — Module Guide M01: Auth, Sessions and 2-Step Verification (v1.0)

Everything needed to build, verify and operate sign-in for both panels: password login, sessions, lockout, reset, and **2-step verification by authenticator app, email OTP and phone (SMS) OTP, plus backup codes**. Owner Dev 1, reviewer Dev 3 (doc 40). UI screens are built by Dev 2 (F2.6) and Dev 1 (account security). Related: doc 03 (decisions D65–D80), 08 (schema), 09 (API), 12 (env), 13 (threats T30–T39), 14 (auth spec), 20 (screens), 24 (tests), 50 (audit actions), 54 (prompts to build it).

> **Status.** Specification written against pack v2.3. **Nothing in this guide is built or tested yet** (unlike doc 50, there is no reference bundle). The build prompts are in doc 54. Every number below (TTLs, limits, caps) is a starting value stored in `settings` and can be changed without a release, inside the hard floors/ceilings given in §5.

> **Decisions this guide changes (read first).**
> 1. **SMS OTP is now in scope** (D65, D67). Before: doc 14 §2 "SMS OTP shown disabled in Figma and kept off until a DLT-registered provider exists", TD-17 "SMS OTP not in v1", Figma note "SMS OTP (disabled)". Now it is **built in v1 behind a provider interface and switched off by default**. It cannot be turned on in production until a provider with a registered DLT template is configured (D67). So the code exists; the capability stays off until compliance is done.
> 2. **SMS is the weakest method and I recommend it stays off for Super Admin** (D66). SMS can be taken over by SIM swap or SS7 interception, and an email OTP is only as strong as the mailbox. If either is accepted as an alternative to the authenticator, the account is exactly as strong as the weakest accepted method. Defaults: Super Admin = authenticator (+ backup codes) only; Zonal Admin = authenticator or email OTP; SMS off. All three are policy settings you can change in Settings > Security.
> 3. Doc 08 columns `users.mfa_secret_encrypted` and `users.backup_codes_hash` are replaced by tables (§3). Nothing was built on them.
> 4. Doc 14 re-auth ("password or TOTP within 10 min") is kept for ordinary high-risk actions and **tightened for 2-step changes** (D74): removing a method, resetting someone's 2-step, or editing the security policy needs password **and** a current code.

---
## 1. What the module does
**One sentence:** it proves that the person at the keyboard is the admin they claim to be (something they know plus something they have), keeps that proof alive safely for the length of a working session, and lets them recover without opening a back door.

| Need | How the module serves it |
|---|---|
| Only the right role enters the right panel | Login tabs (Super Admin / Zonal Admin) validated on the server; wrong tab gives the same generic error as a wrong password |
| Stolen or guessed password is not enough | 2-step verification at every login (D69), enforceable per role (D73) |
| Different admins prefer different second factors | Authenticator app (TOTP), email OTP, SMS OTP, backup codes; policy decides which are allowed per role |
| Admin loses phone | Backup codes; else Super Admin resets their 2-step (audited, emailed); last resort an ops CLI |
| Shared PCs, forgotten tabs | Idle 30 min, absolute 12 h, remember-me, max 3 sessions, revoke from the account page |
| Brute force, OTP guessing, SMS cost abuse | Lockout (D37), per-challenge attempt caps, resend cooldown, hourly and daily send caps, circuit breaker on SMS |
| Compliance and forensics | Every security-relevant event in `audit_logs` and `login_history` (§8) |

### 1.1 In scope
Password login with role tabs; first-login forced password change; forgot/reset password; opaque server sessions; CSRF; lockout; login history; new-login email; **2-step verification** (enrol, verify at login, manage, recover); step-up re-auth for high-risk actions; security policy (Settings > Security); account security page for every admin; active sessions list and revoke.

### 1.2 Out of scope (and why)
| Item | Why |
|---|---|
| Login with Google / social (Figma shows it) | D42: admin accounts are created by Super Admin; social login would bypass the password and 2-step policy |
| **"Trust this device for 30 days" (skip the second step)** | Not in docs 14/20 and it would weaken exactly the control being added. Remember-me extends the *session*, never skips the second step. Revisit post-pilot with device binding if admins complain |
| Passkeys / WebAuthn, hardware keys | Natural next step (phishing-resistant, unlike all three methods here). Not requested; the method enum is designed to accept `WEBAUTHN` later |
| Push-approve (number matching) apps | Needs a mobile backend we do not have |
| Customer, vendor and partner app logins | Those apps have their own auth; this system only receives HMAC-signed server calls (doc 14 §8) |
| Single sign-on, Cognito | Rejected in doc 14 unless SSO becomes a requirement |
| HaveIBeenPwned online breach check | Adds an external dependency; v1 uses a local denylist of common passwords (D78) |

### 1.3 The three factor families (how to explain it to the owner)
| Method | Strength | Weakness | Cost |
|---|---|---|---|
| **Authenticator app** (TOTP, RFC 6238) | Strong against remote attackers; works offline; no cost | Phishable in real time; device loss needs recovery | Free |
| **Email OTP** | Easy; no app | Only as strong as the mailbox (usually same person, often no 2-step on the mailbox) | SES cost, negligible |
| **SMS OTP (phone number)** | Familiar | SIM swap, SS7, SMS-pumping fraud; India needs DLT registration; per-message cost | Paid provider |
| **Backup codes** | Offline recovery | Must be stored safely; single use | Free |

---
## 2. How it works

### 2.1 Login, end to end (the two-step state machine)
```
 /login (email, password, tab, remember me)
   │  POST /auth/login
   ▼
 [1] rate limit → find user (dummy hash if unknown) → tab matches role? → locked? → status ACTIVE? → verify Argon2id
        any failure → generic "Invalid credentials" + login_history row (reason recorded server-side only)
   ▼
 [2] Decide by policy for the user's role and the user's verified methods:
        • has ≥1 usable method     → status MFA_REQUIRED       ─┐  cookie zo_mfa set (pending, 5 min), NO session yet
        • none, policy requires    → status ENROLMENT_REQUIRED ─┤
        • none, policy not require → create session now          │
   ▼                                                              │
 /2fa  ◄───────────────────────────────────────────────────────────┘
   │  authenticator: POST /auth/mfa/verify {method:AUTHENTICATOR, code}
   │  email/SMS    : POST /auth/mfa/challenge {method}  → code sent → POST /auth/mfa/verify {method, code}
   │  backup code  : POST /auth/mfa/verify {method:BACKUP_CODE, code}
   ▼
 [3] success → new session id (never reuse), login_history success + method, new-login email, clear failed_attempts
        • users.must_change_password → session is "restricted": only change-password, /me, logout work
        • redirect by role: SUPER_ADMIN → /super-admin/dashboard, ZONAL_ADMIN → /zone/dashboard
```
Rules that are easy to get wrong:
1. **No session cookie exists until the second step is passed.** The pending state is a separate opaque cookie `zo_mfa` (HttpOnly, Secure, SameSite=Strict, Path=/api/auth, 5 minutes) pointing to a Redis record `{userId, tab, remember, ip, ua, attempts, stage, mailboxProved}`. It authorises only `/auth/mfa/*`, the enrolment endpoints and `/auth/logout`. It is not a session and `/me` rejects it.
2. **A wrong code counts like a wrong password** (D77): it increments `users.failed_attempts`; the 5th failure locks the account for 30 minutes (D37) and ends the pending login. A successful complete login resets the counter.
3. **Same generic message** for a wrong, expired, reused or already-consumed code: "That code didn't work. Check it and try again." No hint which.
4. **The response to `POST /auth/login` never reveals** whether the email exists, whether it is locked, or which methods an unknown email "has". Methods are returned only after the password is correct.
5. **Password reset does not bypass 2-step** (D76). Resetting a password revokes all sessions and sets `must_change_password=false`, but the next login still needs the second step. Reset does not remove or reset 2-step methods.
6. **Order of gates:** password → second step → forced password change. A person holding only a temporary password cannot reach the change-password screen without the second step. If they have no method yet, see 2.3.

### 2.2 The challenge-and-verify mechanics

**Authenticator app (TOTP):** SHA-1, 6 digits, 30 s step (the combination all authenticator apps support). Accept the current step and one step either side (±30 s clock drift). **Replay protection:** store the highest accepted step in `user_mfa_methods.last_used_step`; a code whose step is ≤ that value is rejected even if mathematically valid. Secret: 20 random bytes, shown once as base32 and as a QR (`otpauth://totp/ZOAURO%20Admin:<email>?secret=…&issuer=ZOAURO%20Admin`), stored encrypted (AES-256-GCM with `ENCRYPTION_KEY`, key id prefix so the key can be rotated, D70). Not active until the user types one valid code (a half-finished enrolment never locks anyone out).

**Email OTP and SMS OTP** (same engine, different transport), table `mfa_challenges`:
| Parameter | Default | Hard limit | Notes |
|---|---|---|---|
| Code | 6 digits from a CSPRNG (`crypto.randomInt`) | — | never `Math.random` |
| Stored as | `HMAC-SHA256(OTP_HMAC_KEY, challengeId ‖ code)` | — | the code itself is never stored or logged |
| Lifetime | 5 min | 2–10 min | after expiry the row is dead |
| Wrong guesses per code | 5 | 3–10 | then the challenge is consumed; user must request a new code |
| Resend cooldown | 30 s | 15–120 s | UI shows a countdown; server enforces |
| Sends per hour per user per channel | 5 | 1–20 | prevents SMS pumping and mailbox flooding |
| Sends per day per user per channel | 10 | 1–50 | |
| Single use | yes | — | `consumed_at` set in the same transaction as the login success |
| Destination | **only** the email / phone on the account record, verified (D72) | — | never a value supplied in the request |
Math for the tuning: with 5 sends/h × 5 guesses = 25 guesses/h against 10⁶ codes → 0.0025 % per hour, and the account locks long before at 5 failures (D77).

**SMS circuit breaker (D67):** a global counter of SMS sent per hour (setting `smsHourlyGlobalCap`, default 200). Above 80 % a Super Admin notification; at 100 % SMS is paused (email/authenticator keep working) until a Super Admin re-enables it. This is the control against SMS-pumping toll fraud, which otherwise shows up as a surprise bill.

**Backup codes:** 10 codes, each 10 characters of Crockford base32 (50 bits), shown as `XXXXX-XXXXX`; stored as `HMAC-SHA256(OTP_HMAC_KEY, normalised code)`. Single use (`used_at`). Shown once at generation, with download/copy and an "I have saved these" checkbox. Regenerating invalidates all older codes. Warn at ≤ 3 remaining.

**Comparison** of every code and hash uses `crypto.timingSafeEqual`.

### 2.3 Enrolment (first time) — and why it starts with a mailbox check
A new member logs in with a temporary password issued by Super Admin. If the policy requires 2-step and they have no method, the login returns `ENROLMENT_REQUIRED` and the UI opens `/2fa/setup`. **Danger:** anyone who knows or intercepts the temporary password could enrol *their own* authenticator and own the account. So:
1. **Mailbox proof first** (purpose `ENROL_PROOF`): a code is emailed to the account email on record; the person must enter it. The same step enrols Email OTP if the role allows it.
2. Then they may add an authenticator (QR), and SMS if allowed and enabled and a verified phone exists.
3. Backup codes are generated at the first enrolled method and must be acknowledged.
4. Only then does the session start (`POST /auth/mfa/enrol/complete`).
Super Admin bootstrap (first account from the seed): the same flow, with Mailpit in dev and SES in staging/production. If email is not yet working, the seed command prints a one-time enrolment code once to the console; this is the only place a code is ever shown outside the product and it is single use and expires in 15 minutes. (Task F1.7.)

**SMS enrolment:** only the phone number already on the member record (set by Super Admin in M03) can be verified; the member cannot type a different number (D72). Verifying it sends an SMS code to that number; success sets `users.phone_verified_at` and creates the SMS method. If Super Admin edits the phone, `phone_verified_at` is cleared and the SMS method is removed (audited, member emailed).

### 2.4 Re-authentication (step-up)
`POST /auth/reauth {password, code?, method?}` records `session.reauth_at` and `reauth_level`.
| Level | Needs | Used for | Valid |
|---|---|---|---|
| `PASSWORD` (doc 14) | current password | change role, change any member's access, edit Access Profile, deactivate zone, approve large refunds, rotate integration secrets (the doc 14 list) | 10 min |
| `STRONG` (D74) | password **and** a current second-step code (or backup code) | disable/remove a 2-step method, regenerate backup codes, reset another member's 2-step, change the security policy, change SMS provider settings | 5 min, single action |
A user with no 2-step method (policy off) uses `PASSWORD` for `STRONG` actions only if the policy is not "required" for their role; otherwise they could not exist in that state.

### 2.5 Recovery (no back door)
| Situation | Path | Safeguards |
|---|---|---|
| Lost phone, has backup codes | Sign in with a backup code; app prompts to add a new authenticator | code is consumed; email notice "a backup code was used" |
| Lost phone, no codes (Zonal Admin) | Super Admin opens the member > **Reset 2-step verification** | `STRONG` re-auth, reason required, all methods and codes deleted, all sessions revoked, member emailed, audit `user.two_factor_reset`, member must re-enrol (with mailbox proof) at next login |
| Lost phone, no codes (Super Admin) | Another Super Admin does the same | Security Status card warns when fewer than **2 active Super Admins** exist (D75) |
| Only Super Admin lost everything | Ops CLI `pnpm --filter api cli mfa:reset --email … --reason …` on the server | needs shell + production env; writes an audit row with actor `SYSTEM` and the operator's OS user in `note`; emails the account; documented in doc 17 and the runbook |
| Mailbox lost | Super Admin changes the member's email (M03, `PASSWORD`+`STRONG`), which removes Email OTP and requires re-proof | |
There is intentionally **no "email me a link to disable 2-step"** self-service route; that is how second steps are defeated.

### 2.6 Sessions
Server-side opaque id (32 random bytes, base64url) in cookie `zo_sid` (HttpOnly, Secure, SameSite=Lax); only `SHA-256(id)` is stored (`sessions.token_hash`), in PostgreSQL with Redis read-through (doc 06). Idle 30 min (sliding), absolute 12 h; **remember me** = absolute 7 days with idle 8 h (D79, Assumed: doc 14 gives only "7 days"); max 3 active sessions, the oldest is revoked on a 4th (audited). A new session id is minted at login success and after re-auth escalation (fixation). Any password change, reset, 2-step reset or Super Admin "revoke sessions" kills the relevant sessions. Cookie flags and CSRF as doc 14 (double-submit token in `zo_csrf`, header `X-CSRF-Token`, also required on `/auth/*` POSTs).

### 2.7 Emails sent
New-login notice (IP, device, time, method used); OTP email; 2-step method added/removed; backup codes regenerated or used; 2-step reset by admin; account locked; password changed/reset. None contain a link that signs in or disables a factor.

---
## 3. Data model (amends doc 08)
```
users                       (changes)  − mfa_secret_encrypted  − backup_codes_hash
                                       + phone_verified_at timestamptz null
                                       + password_changed_at timestamptz null
                                       mfa_enabled stays as a *derived* flag, updated in the same transaction as any method change
user_mfa_methods            id uuid pk, user_id fk, type MfaType {AUTHENTICATOR, EMAIL_OTP, SMS_OTP},
                            secret_encrypted text null  -- AUTHENTICATOR only: "v1.<kid>.<nonce>.<ciphertext>.<tag>"
                            verified_at timestamptz null  -- null = enrolment started, not confirmed
                            last_used_step bigint null    -- TOTP replay guard
                            is_primary bool, created_at, updated_at, disabled_at null
                            UNIQUE (user_id, type) WHERE disabled_at IS NULL
mfa_challenges              id uuid pk, user_id fk, purpose MfaPurpose {LOGIN, ENROL_PROOF, ENROL_EMAIL, ENROL_SMS, REAUTH},
                            method MfaType (EMAIL_OTP | SMS_OTP), code_hash text, destination_hint text (e.g. "a***@x.com", "+91•••••••210"),
                            expires_at, attempts int default 0, max_attempts int, send_count int, last_sent_at, consumed_at null,
                            ip inet, created_at
                            INDEX (user_id, purpose, method, created_at desc), INDEX (expires_at)
mfa_backup_codes            id uuid pk, user_id fk, code_hash text, batch_id uuid, used_at null, created_at
                            INDEX (user_id, used_at)
sessions                    (changes)  + mfa_verified_at, + mfa_method MfaType|'BACKUP_CODE'|null,
                                       + remember bool, + reauth_at null, + reauth_level null, + restricted text null ('PASSWORD_CHANGE')
login_history               (changes)  + mfa_method text null; reason values: BAD_PASSWORD, WRONG_TAB, LOCKED, INACTIVE, MFA_FAILED, MFA_EXPIRED, MFA_LOCKOUT, OK
settings                    (new keys, see §5)
```
Pending login state, rate-limit counters and the SMS circuit-breaker counter live in Redis only (TTL'd). Expired `mfa_challenges` are deleted by a nightly BullMQ job after 7 days (no PII beyond the hint, but it is noise). `mfa_challenges`, `user_mfa_methods` and `mfa_backup_codes` are registered in the audit redaction registry (`secret_encrypted`, `code_hash` → DROP) so the schema-walker test of doc 50 stays green.

**Extension point:** adding passkeys later = new `MfaType` value + new table for credentials; nothing in the login state machine changes.

---
## 4. Action catalogue additions (amends doc 50 §4)
Existing: `user.two_factor_enrolled`, `user.password_changed`, `user.password_reset_requested`, `user.locked`, `user.unlocked`, `session.revoked`, `reauth.failed`*, `settings.2fa_policy_changed`*. **Add first to `AUDIT_ACTIONS`** (rule: catalogue before code):
| Action | Sens. | When | Notes |
|---|---|---|---|
| `user.two_factor_enrolled` | normal | a method is confirmed | `diff.after.method`; never the secret |
| `user.two_factor_disabled` | HIGH | user removes a method (STRONG) | |
| `user.two_factor_reset` | HIGH | admin or CLI reset | `note` = reason; actor may be SYSTEM |
| `user.backup_codes_generated` | HIGH | generate/regenerate | |
| `user.backup_code_used` | HIGH | login or reauth with a backup code | |
| `user.mfa_challenge_failed` | normal, DENIED | wrong/expired code | rate limited 1 per minute per actor (D62) |
| `user.mfa_locked` | HIGH | 5 failures ended a login and locked | same as `user.locked` with `reason=MFA` if you prefer one action |
| `sms.paused` / `sms.resumed` | HIGH | circuit breaker | actor SYSTEM / Super Admin |
Successful login/logout still write `login_history` only (`audit: { none: 'login' }`). OTP send events are **not** audited (volume, T29); they are counted and capped.

---
## 5. Security policy (Settings > Security, keys in `settings`)
```jsonc
"security.password":  { "minLength": 12, "denylist": true, "maxAgeDays": null }     // minLength floor 12 cannot be lowered
"security.lockout":   { "maxAttempts": 5, "lockMinutes": 30 }                        // D37
"security.session":   { "idleMinutes": 30, "absoluteHours": 12, "rememberDays": 7, "rememberIdleHours": 8, "maxSessions": 3 }
"security.mfa": {
  "required":  { "SUPER_ADMIN": true,  "ZONAL_ADMIN": true  },                       // SUPER_ADMIN cannot be set false
  "allowed":   { "SUPER_ADMIN": ["AUTHENTICATOR"], "ZONAL_ADMIN": ["AUTHENTICATOR","EMAIL_OTP"] },   // SUPER_ADMIN must contain AUTHENTICATOR
  "smsEnabled": false,                                                                // cannot be true unless SMS provider is configured (D67)
  "otpTtlSeconds": 300, "otpMaxAttempts": 5, "resendCooldownSeconds": 30,
  "sendsPerHour": 5, "sendsPerDay": 10, "smsHourlyGlobalCap": 200
}
```
Validation (Zod in `@zoauro/shared`, enforced again server-side): the floors/ceilings in §2.2; `SUPER_ADMIN` always requires 2-step and always allows the authenticator; `SMS_OTP` can appear in `allowed` only when `smsEnabled` is true; `smsEnabled` can be true only when `SMS_PROVIDER` is a real provider (not `none` or `console`) **and** `SMS_DLT_TEMPLATE_ID_OTP` is set (production). Saving needs `STRONG` re-auth, writes `settings.2fa_policy_changed` with before/after, takes effect within 60 s (settings cache). Weakening changes (adding EMAIL_OTP/SMS for Super Admin, lowering `required` for Zonal Admin) show a confirmation that names the risk in one sentence.

**Enforcement when the policy tightens:** a member who has no allowed method is routed to `/2fa/setup` at their *next login*; existing sessions are revoked when `required` flips from false to true (otherwise the control would take effect only after 12 h). A member whose only method is no longer *allowed* (e.g. SMS switched off) gets the same treatment.

**Environment (doc 12 additions):** `OTP_HMAC_KEY` (≥ 32 bytes, distinct from `SESSION_SECRET` and `ENCRYPTION_KEY`), `ENCRYPTION_KEY` (existing, AES-256), `ENCRYPTION_KEY_PREVIOUS` (optional, for rotation), `SMS_PROVIDER` (`none` | `console` | `<adapter>`), `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID`, `SMS_DLT_TEMPLATE_ID_OTP`, `MFA_ISSUER` (default `ZOAURO Admin`). Validated at boot; production refuses to start with `SMS_PROVIDER=console`.

---
## 6. SMS in India (what must exist before it is switched on)
Commercial SMS to Indian numbers is filtered by the TRAI DLT framework: the business registers as an **entity**, registers a **sender ID (header)** and registers each **message template** (the OTP text, with variable slots); operators drop messages whose sender or template does not match. The provider needs your entity ID and the registered template ID on each API call. Registration is done by the business with an operator's DLT portal or through the chosen SMS provider, and takes days to weeks, so start it early. (Provider guides: [Plivo](https://www.plivo.com/docs/sms/concepts/dlt-registration-process), [Infobip](https://www.infobip.com/docs/essentials/dlt-registration).)
In this module: the provider is behind `interface SmsProvider { send({to /*E.164*/, templateId, variables:{otp, minutes}}): Promise<{providerMessageId}> }`. Shipped adapters: `ConsoleSmsProvider` (dev/test only; prints the code to the API console; refuses to load when `NODE_ENV=production`) and `DisabledSmsProvider` (default; every call fails closed with a typed error). **A real adapter is not part of this guide because the provider is not chosen** (D68, Open). It is one small file implementing the interface plus a delivery-failure mapping, ≈ 0.5 dev-week after the choice.
The SMS text must match the registered template exactly (variables only in registered slots), e.g. `{#var#} is your ZOAURO Admin verification code. Valid for {#var#} minutes. Do not share it. - ZOAURO` (wording is the owner's to register; keep it free of links).

---
## 7. Module structure
```
packages/shared/src/auth/
  schemas.ts          Zod: login, mfa verify/challenge, enrol, reauth, policy, member-reset
  mfa.ts              MfaType, MfaPurpose, error codes, policy floors/ceilings (single source for api + web)
apps/api/src/modules/auth/
  auth.routes.ts      /auth/*  (public + pending-cookie routes), audit metadata on every mutating route
  mfa.routes.ts       /auth/mfa/*, /me/mfa/*
  account.routes.ts   /me/sessions, /me/login-history, /me/password
  auth.service.ts     login(), logout(), reset flows, session create/revoke
  mfa.service.ts      state machine, verify(), enrol(), disable(), reset()
  otp.service.ts      challenge create/verify/resend, rate limits, circuit breaker
  totp.ts             thin wrapper over otplib (generate secret, uri, verify with window + step)
  backup-codes.ts     generate, hash, consume
  password.ts         Argon2id hash/verify, policy check, denylist
  crypto.ts           AES-256-GCM seal/open with key id; HMAC helpers; timing-safe compare
  pending.ts          Redis pending-login store
  reauth.ts           requireRecentReauth(level) guard
  sms/ provider.ts, console.provider.ts, disabled.provider.ts
  email/ templates (otp, new-login, mfa-changed, mfa-reset, locked)
  auth.repository.ts  only file importing Prisma for auth tables
  cli/mfa-reset.ts
apps/web/src/app/(auth)/ login, forgot-password, reset-password, 2fa, 2fa/setup
apps/web/src/app/account/security/page.tsx           (both roles)
apps/web/src/app/super-admin/settings/security/      (policy tab + Security Status card)
apps/web/src/components/auth/ OtpInput, MethodSwitcher, QrEnrol, BackupCodesPanel, SessionsTable, LoginHistoryTable
```
Libraries: `otplib` (already in doc 06; **v13 has a new API compared with v12, so read the installed types, do not copy v12 snippets**), `argon2`/`@node-rs/argon2` as chosen in F1.2 (check `pnpm why`), and two **new** ones that need your approval because AGENTS.md says no new libraries without a doc: `qrcode` (web, to draw the QR from the otpauth URI; alternative: draw nothing and show the key only) and `libphonenumber-js` (normalise phones to E.164, needed only for SMS; skip until SMS ships). Recorded as D80 (Assumed).

---
## 8. REST API (amends doc 09 §Auth)
Errors use the standard envelope. `P` = public, `PEND` = pending cookie, `S` = session, `A` = audited.
| Method | Path | Auth | Request → response | Notes |
|---|---|---|---|---|
| GET | /auth/csrf | P | → `{token}` | sets `zo_csrf` |
| POST | /auth/login | P | `{email,password,tab,remember}` → `{status:'OK'\|'MFA_REQUIRED'\|'ENROLMENT_REQUIRED', methods?:[{type,hint}], preferred?}` | `audit:none('login')`; sets `zo_sid` or `zo_mfa` |
| POST | /auth/mfa/challenge | PEND | `{method:'EMAIL_OTP'\|'SMS_OTP'}` → `{sent,hint,resendAfterSeconds,expiresInSeconds}` | 429 with `retryAfter` on cooldown/caps |
| POST | /auth/mfa/verify | PEND | `{method:'AUTHENTICATOR'\|'EMAIL_OTP'\|'SMS_OTP'\|'BACKUP_CODE', code}` → `{status:'OK', redirect}` | creates the session |
| POST | /auth/mfa/enrol/complete | PEND | `{}` → `{status:'OK',redirect}` | requires ≥1 verified allowed method and backup codes acknowledged |
| POST | /auth/logout | S | | `audit:none('logout')` |
| POST | /auth/forgot-password, /auth/reset-password | P | generic response; token single-use, hashed, 30 min | A |
| POST | /auth/change-password | S | `{current,new}` | also used for forced first-login change; A |
| POST | /auth/reauth | S | `{password, code?, method?}` → `{level, validUntil}` | A on failure |
| GET | /me | S | role, zones, permissions, `mfa:{enabled,methods[],backupCodesRemaining,required,enrolmentNeeded}` | |
| GET | /me/mfa | S or PEND(enrol) | methods, hints, primary, backup count, policy view (allowed methods for my role, smsAvailable) | |
| POST | /me/mfa/email/start, /me/mfa/email/confirm | S or PEND | `{}` / `{code}` | A (`two_factor_enrolled`) |
| POST | /me/mfa/authenticator/start | S or PEND | → `{secretBase32, otpauthUri}` | needs `mailboxProved` (pending) or `PASSWORD` re-auth (session); replaces any unconfirmed secret |
| POST | /me/mfa/authenticator/confirm | S or PEND | `{code}` → `{backupCodes?:[10]}` (only the first time) | A |
| POST | /me/mfa/sms/start, /me/mfa/sms/confirm | S or PEND | `{}` / `{code}`; 409 `SMS_NOT_AVAILABLE` if policy/provider off; 409 `PHONE_MISSING` | A |
| PUT | /me/mfa/primary | S | `{type}` | |
| DELETE | /me/mfa/{type} | S + `STRONG` | | A; 409 `LAST_METHOD_REQUIRED` if policy requires and it is the last allowed one |
| POST | /me/mfa/backup-codes/regenerate | S + `STRONG` | → `{codes:[10]}` | A |
| GET | /me/sessions | S | list (device, IP, created, last seen, current) | |
| DELETE | /me/sessions/{id}, POST /me/sessions/revoke-others | S | | A (`session.revoked`) |
| GET | /me/login-history | S | own last 50 (existing) | |
| GET/PUT | /settings/security | S, Super Admin, `settings:*`; PUT needs `STRONG` | policy (§5) | A (`settings.2fa_policy_changed`) |
| GET | /settings/security/status | Super Admin | counts enrolled/not by role, methods mix, active Super Admins, SMS provider/breaker state, failed MFA last 24 h | feeds the Security Status card |
| POST | /members/{id}/mfa/reset | Super Admin + `STRONG` | `{reason}` | A; owned by M03 routes, specified here |
| POST | /settings/security/sms/resume | Super Admin + `STRONG` | | A (`sms.resumed`) |
All `POST/PUT/DELETE` need CSRF. Rate limits (Redis, per IP and per account, in addition to §2.2): `/auth/login` 20 / 15 min per IP; `/auth/mfa/verify` 10 / 5 min per pending login and 30 / 15 min per IP; `/auth/forgot-password` 5 / hour per IP and per email.

---
## 9. UI specification
Figma has the login card (tabs, show/hide password, remember me, forgot password) and the Security settings tab with an "SMS OTP (disabled)" toggle; there are **no frames for `/2fa`, `/2fa/setup` or the account security page** (D47 pattern: build from this section, the designer reviews at the sprint demo). Use the existing tokens, `FormField`, `ConfirmDialog`, toasts.

### 9.1 `/login` (exists in Figma) — changes
Role tabs unchanged. After a correct password the card **swaps in place** to the verification step (same URL change to `/2fa` so refresh and back behave); "Back to sign in" ends the pending login. Generic error text only.

### 9.2 `/2fa` — Verify it's you
Header "Two-step verification", sub-line shows who ("Signing in as a***@gloaro.com"). Method switcher (segmented control) shows only the user's usable methods, default = primary. 6-cell `OtpInput`: numeric keypad on mobile, `autocomplete="one-time-code"`, paste fills all cells, auto-submit on the sixth digit, `aria-live` error. Email/SMS: "We sent a code to a***@x.com" + **Resend** with countdown (server value) + "Code valid for 5 min". Links: "Use a backup code" (single input, accepts with or without the dash), "Use another method". States: loading, wrong code (cells shake, keep focus), cooling down, locked (shows the unlock time), expired pending ("Your sign-in timed out, start again"). Never autofocus-submit an empty field.

### 9.3 `/2fa/setup` — three-step wizard
1. **Confirm your email**: code sent to the account email.
2. **Add a method**: cards for each allowed method. *Authenticator*: QR + "can't scan? enter this key" (grouped in 4s, copy button), type the 6-digit code to confirm. *Email*: already added by step 1 if allowed. *Text message*: only if allowed and enabled; shows the masked number from the member record ("To change it, ask your administrator").
3. **Save backup codes**: 10 codes, Copy / Download .txt / Print, checkbox "I have saved these codes" enables Continue. Shown once.
Cancel logs out. Super Admin wizard shows only the authenticator card.

### 9.4 `/account/security` (both roles; profile menu → Account security)
Cards: **Two-step verification** (list of methods with status, primary radio, Add, Remove (opens `STRONG` re-auth dialog: password + code)); **Backup codes** (remaining count, Regenerate); **Active sessions** (device, IP, location text from IP not required, last seen, "This device" badge, Revoke, "Sign out all other devices"); **Recent sign-ins** (last 50: time, result, method, IP). Zonal Admins have no Settings module (non-grantable), so this page is their only security UI.

### 9.5 Settings > Security (Super Admin; exists in Figma)
Sections as in Figma plus: **Two-step verification policy** (required per role; allowed methods per role as checkboxes; SMS toggle shown **disabled with the reason** "No SMS provider configured" until D67 conditions hold; OTP expiry, attempts, cooldown, caps with their allowed ranges beneath each field); **Security Status card** (members enrolled / not enrolled per role, with a link to the list of not-enrolled members; active Super Admins count with warning if < 2; SMS provider state and breaker; failed second-step attempts in 24 h). Saving opens the `STRONG` dialog and a diff.

### 9.6 Member detail (M03 screen)
Super Admin action **Reset 2-step verification**: dialog with consequences ("All methods and backup codes are deleted; all sessions end; the member must set up again"), required reason, `STRONG` re-auth.

### 9.7 Accessibility and copy
Every input labelled; OTP cells have a single accessible name ("Verification code, digit 1 of 6"); errors announced; works with keyboard only; no countdown that cannot be paused for assistive tech (show text "You can resend in 24 s" updated every 5 s to screen readers).

---
## 10. Security and threat additions (amends doc 13)
| ID | Threat | Impact | Mitigation | Test |
|---|---|---|---|---|
| T30 | OTP / TOTP guessing | Account takeover | 5 guesses per code, 5 failures lock 30 min (D77), per-pending-login and per-IP rate limits, 6-digit codes expire in 5 min, timing-safe compare | TC-AUTH-10…14 |
| T31 | SMS pumping / OTP flooding (cost, harassment) | Surprise bill, mailbox spam | Destination is never user-supplied, cooldown, hourly/daily caps, global SMS cap + circuit breaker, SMS off by default | TC-AUTH-17…20 |
| T32 | SIM swap / email takeover defeats OTP | Account takeover | Super Admin = authenticator only by default; SMS off by default; new-method and login emails; `STRONG` re-auth to change methods | TC-AUTH-26, 29 |
| T33 | MFA downgrade (attacker picks the weakest accepted method) | Bypass | Allowed methods are per role from policy, evaluated on the server; verify rejects a method not allowed or not enrolled for that user | TC-AUTH-21 |
| T34 | Enrolment hijack with a temporary password | Attacker owns the second factor | Mailbox proof before any enrolment (2.3); first-login order of gates (2.1) | TC-AUTH-22 |
| T35 | TOTP secret theft from DB / backup | Permanent factor compromise | AES-256-GCM, key from env not DB, key id for rotation, secret never returned after enrolment, redacted from audit/logs | TC-AUTH-30 |
| T36 | TOTP code replay (shoulder-surf, phishing relay within 30 s) | Session theft | `last_used_step` reject; short window; (phishing relay itself remains a residual risk until passkeys) | TC-AUTH-11 |
| T37 | Recovery abuse (social engineering Super Admin, support-reset) | Bypass | `STRONG` re-auth, reason, member email, audit HIGH, ≥ 2 Super Admins, CLI audited | TC-AUTH-31…34 |
| T38 | Pending-login cookie theft or fixation | Skip step 1 | Opaque, Strict, 5 min, bound to IP/UA hash (soft: UA only; IP changes on mobile), single use, new session id on success | TC-AUTH-9 |
| T39 | Enumeration via the 2-step step | Learn valid emails | Methods revealed only after correct password; identical errors and similar timing for unknown users | TC-AUTH-35 |
Residual risks to say out loud: real-time phishing of TOTP and OTP codes works against all three methods; the fix is passkeys (post-pilot). SMS remains the weakest link even with the controls above.

---
## 11. Test plan (add to doc 24; IDs continue TC-AUTH-6…)
Existing TC-AUTH-1…5 stay (TC-AUTH-3 "2FA wrong code" now maps to TC-AUTH-10). Time is controlled with an injectable clock; email goes to Mailpit/test double; SMS to `ConsoleSmsProvider` capturing messages in memory.

| ID | Area | Case | Expected |
|---|---|---|---|
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
Unit-level: RFC 6238 test vectors, AES-GCM tamper detection (flip one byte → fails), HMAC compare timing-safe, phone normalisation table, policy Zod floors/ceilings.
**Mutation checks to run once by hand (as in doc 50):** disable the replay check; skip the attempts increment; compare codes with `===`; return methods before the password check; allow `destination` from the request. Each must make at least one test fail.

---
## 12. Acceptance criteria and Definition of Done
Given a Super Admin with an authenticator, when they enter the right password, then they see the code screen and have no session until the code is accepted. Given 5 wrong codes, then the account is locked for 30 minutes and the attempt is audited. Given a Zonal Admin with email OTP allowed, when they request a code twice within 30 s, then the second request is refused with the remaining seconds. Given SMS is not configured, then the SMS toggle is disabled with the reason and no code path can send an SMS. Given a member lost their phone, when Super Admin resets their 2-step with a reason, then the member is emailed, all their sessions end and they must re-enrol with an email check. Given the policy changes to require 2-step, then members without it are forced to enrol at next login (doc 25).
**DoD:** TC-AUTH-1…47 pass in CI (UI cases in the nightly E2E); coverage guard green; mutation checks done and recorded; ZAP baseline has no new findings on `/auth/*`; doc 03/08/09/12/13/14/20/24 amended (done in this release); handoff block written; the owner has seen the three flows on staging (login+email OTP, enrol authenticator, recovery).

---
## 13. Effort and phasing
| Task | Content | Dev-weeks | When | Who |
|---|---|---|---|---|
| AUTH-1 | Schema, shared types/Zod, audit catalogue additions | 0.3 | S0–S1 | Dev 1 |
| AUTH-2 | Crypto helpers, TOTP wrapper, backup codes, password service (+ RFC vectors) | 0.4 | S1 | Dev 1 |
| AUTH-3 | Sessions, password login, lockout, reset, first-login, CSRF, login history (= F1.2) | 1.0 | S1 | Dev 1 |
| AUTH-4 | Two-step login state machine, TOTP verify, backup codes | 0.7 | S1–S2 | Dev 1 |
| AUTH-5 | OTP service + email OTP + rate limits | 0.5 | S2 | Dev 1 |
| AUTH-6 | SMS provider interface, console/disabled adapters, caps, breaker | 0.4 | S2–S6 | Dev 1 |
| AUTH-7 | Enrolment/management API, step-up, recovery, CLI | 0.8 | S2–S3 | Dev 1 |
| AUTH-8 | Policy API + Security Status API (SA-7.2 backend) | 0.3 | S6 | Dev 1 |
| AUTH-9 | Screens: login, `/2fa`, `/2fa/setup`, forgot/reset (F2.6) | 0.7 | S2 | Dev 2 |
| AUTH-10 | Account security page, Settings > Security policy tab, member reset action | 0.8 | S3 and S6 | Dev 2 / Dev 1 |
| AUTH-11 | Test suite, mutation checks, independent verification | 0.5 | with each task | Dev 3 reviews |
| **Total** | | **≈ 6.4** | | docs 33/34 had F1.2 + F2.6 + SA-7.2 ≈ 2.5 |
| AUTH-12 | Real SMS adapter (after provider chosen and DLT done) | +0.5 | post-pilot unless DLT is ready | Dev 1 |
**Honest effect on the plan:** ≈ +3.9 dev-weeks over docs 33/34, concentrated on Dev 1 who has no slack before S9 (doc 40). Without SMS now (AUTH-6 reduced to the interface only, and the screens' SMS card hidden) the increase is ≈ +3.5. Expect the pilot date to move by roughly one week, or move AUTH-10's Settings policy editor to after the pilot and ship the policy as seeded defaults (saves 0.5). **Move 2-step enforcement from Gate 3 to Gate 1** because the login flow shape depends on it (D69); building single-step first and adding the second step later means rebuilding F1.2 and the login screens.

---
## 14. Build procedure
Prompts, in order, with checks: **doc 54, Part A (M01-P1 … M01-P11)**. Rules as in doc 51: new session per prompt, plan mode, `pnpm lint && pnpm typecheck && pnpm test` green before commit, one prompt = one commit. If you already ran doc 51 Prompt A6 (password-only auth), doc 54 tells you which prompts become gap fixes.

---
## 15. Open decisions for the owner
| Id | Question | My default |
|---|---|---|
| D66 | May Super Admin use email or SMS as an alternative to the authenticator? | No (authenticator + backup codes). Weaker alternatives lower the whole account to their level |
| D68 | Which SMS provider and when does DLT registration complete? | Unknown; SMS stays off; adapter built after the choice |
| D73 | Is 2-step mandatory for Zonal Admins from day one? | Yes (they handle refunds and customer data). Switch off per role in settings if the pilot needs a grace period |
| D75 | Minimum two active Super Admin accounts at launch | Yes; the status card warns |
| D79 | Remember-me idle timeout | 8 h (doc 14 only says 7 days) |
| D80 | Add `qrcode` (and later `libphonenumber-js`) | Yes |
If you do nothing, the defaults apply (all marked Assumed in doc 03).

---
## 16. Verification of this guide against the pack (done before delivery)
Cross-read against docs 03, 06, 08, 09, 12, 13, 14, 20, 24, 25, 32, 34, 40, 50. Contradictions found and how they are resolved: doc 14 §2 (SMS kept off) and TD-17 are amended, not ignored (banner at the top, doc 03 D65–D68, doc 32 change-log); doc 08 `mfa_secret_encrypted`/`backup_codes_hash` replaced by tables; doc 09 had only `/auth/2fa/setup` and `/auth/2fa/verify`, replaced by §8; doc 06 says sessions in PostgreSQL with Redis read-through while doc 51 A6 says "Redis-backed", so this guide follows doc 06 and doc 54 corrects the wording. Versions of otplib (13.5.0), qrcode (1.5.4) and Argon2 libraries were looked up on the npm registry on 2026-10-12. **Not verified by running code:** no part of this module is implemented; test counts are planned, not passed.

## 17. Amendments applied to other documents
Doc 02 (AUTH-4 wording), 03 (D65–D80), 05 (UC-09, new UC-09b/09c), 06 (auth row), 08 (tables), 09 (auth endpoints), 11 (SMS row), 12 (env), 13 (T30–T39), 14 (§2), 17 (recovery row), 20 (screens), 24 (cases), 25 (criteria), 31 (T-7 line), 32 (TD-17 closed/changed, change-log), 34 (SA-7.2 pointer), 37 (reconciliation row 13), 39/40 (M01 row), 50 (§4 actions), README (index). See each document's own note.
