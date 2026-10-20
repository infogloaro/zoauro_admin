# 54 — Auth (with 2-step verification) and Zones: build prompts, in order, copy-paste

Specifications: **doc 52** (M01 Auth, Sessions and 2-step verification) and **doc 53** (M02 Zones). This file is only the prompts. Same rules as doc 51: nothing here asks Claude Code to edit documents (you copy them in, Step 0); no zip files; use the documents in your repo's `docs/` folder as the single source.

**Already have code or docs from before? Read doc 55 first.** It says which parts to adopt, trim or keep, and gives override blocks to paste at the end of prompts M01-P6, P8, P10 and M02-P2, P3, P4 (they remove an SMS circuit breaker, the full policy editor, a zone advisory lock and a resolver cache that are not worth building yet).

Rules for every prompt: new Claude Code session at the repo root → plan mode (Shift+Tab) → read the plan → approve → run `pnpm lint && pnpm typecheck && pnpm test` → commit only when green. **One prompt = one commit.** Do not skip or reorder. If a "Check" fails, fix it before the next prompt. Each prompt ends by appending a handoff block to `docs/handoff.md` (doc 38 §5), so the next session knows where you are.

---
## Step 0 — Put the new and changed documents in `docs/` (you do this, no Claude Code)

0.1 `git status` must be clean (commit or stash first).
0.2 Copy these files from the delivery into `docs/`, **same relative paths, overwrite**. They are the new guides and the pack documents amended for this release (list in the Appendix at the end of this file):
every file named in the Appendix at the end of this file (new: 52, 53, 54; amended: README, AGENTS.md and docs 02, 03, 05, 06, 08, 09, 11, 12, 13, 14, 17, 20, 24, 25, 31, 32, 34, 37, 39, 40, 42, 50). Copy `AGENTS.md` to the repo root as well as into `docs/` if your root copy exists.
0.3 Check the copy (each must print a number ≥ 1):
```bash
grep -c "D90" docs/A-product/03_Business_Rules_and_Decision_Register.md
grep -c "user_mfa_methods" docs/B-architecture/08_Database_Schema_and_Data_Dictionary.md
grep -c "T43" docs/C-security/13_Security_Requirements_and_Threat_Model.md
grep -c "TC-AUTH-47" docs/E-quality-ops/24_Test_Strategy_and_Test_Cases.md
ls docs/F-execution | grep -c "^5[23]_"      # prints 2
```
0.4 Commit: `git add -A && git commit -m "docs: auth (2-step) and zones module guides"`
0.5 **Decide or accept the defaults** (write your answer in doc 03 by hand: change "Assumed" to "Decided"). The prompts work with the defaults. The ones that change the build: **D66** (Super Admin may not use email/SMS instead of the authenticator), **D73** (2-step mandatory for Zonal Admins), **D82** (a pincode belongs to one zone), **D88** (order-number prefix; not needed until Orders). SMS provider (D68) is **not** needed to run these prompts.
0.6 Tools: Node 22, pnpm 9, Docker Desktop, Git, Claude Code. Mailpit (email) comes with the local infrastructure prompt of doc 51.

## Where this fits with doc 51
Doc 51 builds the foundation and the Audit module. This file continues from it:
| You have already run | Then |
|---|---|
| Doc 51 A1–A5 (scaffold, infrastructure, schema, audit guard, audit write path) | Start at **M01-P1** |
| Doc 51 A6–A8 (password auth, AuthContext, harness) | Run **M01-P1, P2**, then **M01-P3 as a gap fix** (it diffs against what exists), then continue. Do not rerun A6 |
| Nothing from doc 51 yet | Run doc 51 A1–A5 first (they now create the new tables because doc 08 is amended), then A7–A8 after M01-P4, and start here at **M01-P2** |
Zones (Part B) needs: schema (doc 51 A3 or M02-P1), audit write path (A5), AuthContext and the authorization harness (A7–A8) and the M01 session login (M01-P3).

---
# Part A — M01 Auth, Sessions and 2-step verification

### Prompt M01-P1 — Schema and shared contracts (AUTH-1)
```
Task AUTH-1. Lane D (schema) + shared. Only the schema gatekeeper (Dev 1) runs this.
Load only: AGENTS.md, docs/F-execution/52_Module_Guide_M01_Auth_and_Sessions.md sections 3, 4, 5, docs/B-architecture/08_* (users, sessions, login_history, settings, mfa tables), docs/F-execution/50_* section 4 and 5 (catalogue and redaction rules).
1) Prisma: add enums MfaType {AUTHENTICATOR, EMAIL_OTP, SMS_OTP} and MfaPurpose {LOGIN, ENROL_PROOF, ENROL_EMAIL, ENROL_SMS, REAUTH}; models UserMfaMethod, MfaChallenge, MfaBackupCode with the columns, uniques and indexes of doc 52 section 3 (partial unique index on user_mfa_methods (user_id, type) where disabled_at is null needs a raw-SQL migration). Remove users.mfa_secret_encrypted and users.backup_codes_hash; add users.phone_verified_at and users.password_changed_at; extend sessions and login_history as in doc 52 section 3.
2) Create the migration with "prisma migrate dev --create-only --name auth_mfa" (using DATABASE_URL_MIGRATE), put the partial-index SQL in it by hand, then apply. If a table already holds data in your dev database, say so in the handoff; do not drop data silently.
3) packages/shared/src/auth/: Zod schemas for login, mfa challenge/verify, enrol, reauth, member reset and the security policy (floors and ceilings of doc 52 section 2.2 and 5; SUPER_ADMIN always required and always allows AUTHENTICATOR; SMS_OTP only if smsEnabled), MfaType/MfaPurpose, error codes. Export from the package.
4) Add the new actions of doc 52 section 4 to AUDIT_ACTIONS (packages/shared/src/audit/actions.ts) with module "auth" and the sensitivity given there. Register secret_encrypted and code_hash columns in the audit redaction registry (DROP). Run the audit schema-walker test; it must stay green.
Do not write services, routes or UI.
Done when: prisma validate and migrate succeed on an empty database and on the current dev database; shared Zod tests cover every floor/ceiling (a value just inside passes, just outside fails); the audit tests are green.
```
**Check:** `psql -U zoauro_owner zoauro -c '\d user_mfa_methods'` shows the partial unique index; `pnpm test` includes the policy-bounds tests; `grep -c "two_factor_reset" packages/shared/src/audit/actions.ts` prints 1.

### Prompt M01-P2 — Crypto, TOTP, backup codes, password service (AUTH-2)
```
Task AUTH-2. Lane A (pure library code, no routes). Load only: AGENTS.md, docs/F-execution/52_* sections 2.2, 5, 7 (structure and libraries), docs/C-security/14_* section 1.
Create in apps/api/src/modules/auth/: crypto.ts, totp.ts, backup-codes.ts, password.ts.
- crypto.ts: AES-256-GCM seal/open with a key id prefix "v1.<kid>.<nonce>.<ct>.<tag>", key from ENCRYPTION_KEY, optional ENCRYPTION_KEY_PREVIOUS for rotation (open tries current then previous); hmac(OTP_HMAC_KEY, ...) helper; timingSafeEqual wrapper. Add OTP_HMAC_KEY (>= 32 bytes, must differ from SESSION_SECRET and ENCRYPTION_KEY) to the env Zod schema and .env.example; fail fast at boot.
- totp.ts: wrapper over otplib. READ THE INSTALLED otplib TYPES FIRST (version 13 changed its API compared with 12; do not paste v12 snippets). SHA-1, 6 digits, 30 s, accept the current step and +-1 step, return the matched step number so the caller can enforce replay protection. Expose generateSecret(), otpauthUri(email), verify(secret, code, lastUsedStep) => {ok, step}. Issuer from MFA_ISSUER (default "ZOAURO Admin").
- backup-codes.ts: generate 10 codes of 10 Crockford-base32 chars shown as XXXXX-XXXXX; normalise (strip dash/space, upper-case, map I/L->1 O->0); hash with hmac; consume helper.
- password.ts: Argon2id hash/verify (reuse the library chosen in doc 06 / already installed; run "pnpm why argon2 @node-rs/argon2" and use what is there), minimum length 12, local denylist of the 1,000 most common passwords (small checked-in file), constant-time dummy verify for unknown users.
Tests: RFC 6238 SHA-1 test vectors; replay (step <= lastUsedStep rejected); +-1 step accepted, +-2 rejected; AES-GCM round-trip, tamper (flip one byte) fails, wrong key fails, previous key opens; backup code normalisation table; denylist; dummy-verify timing is within the same order as a real verify (assert a loose ratio, not exact).
Done when: pnpm lint && pnpm typecheck && pnpm test pass. No new libraries except those already in doc 06; if "qrcode" is needed it belongs to the web app in M01-P9, not here.
```
**Check:** open `totp.ts` and confirm it never returns or logs the secret except from `generateSecret()`; `grep -rn "Math.random" apps/api/src/modules/auth` prints nothing.

### Prompt M01-P3 — Sessions and password login (AUTH-3; gap fix if doc 51 A6 already ran)
```
Task AUTH-3 (= task F1.2 in docs/F-execution/33_*). Lane A. Load only: AGENTS.md, docs/F-execution/52_* sections 2.1 (steps 1 and 3 only), 2.6, 2.7, 8, docs/C-security/14_* sections 1-3, docs/B-architecture/06_* (auth row), docs/B-architecture/08_* (users, sessions, login_history), docs/F-execution/50_* section 2.1 and 4 (auth actions).
FIRST inspect apps/api/src/modules/auth for existing code (doc 51 Prompt A6 may already have produced password login). If it exists: list the differences from this spec in the plan and change only what differs; do not rewrite working code. If it does not: build all of it.
Implement: POST /auth/login (password step only for now: returns status OK when the user has no verified MFA method and policy does not require one; MFA_REQUIRED handling comes in M01-P4), /auth/logout, /auth/forgot-password, /auth/reset-password, /auth/change-password, /auth/reauth (PASSWORD level only now), GET /auth/csrf, GET /me (stub permissions), GET /me/sessions, DELETE /me/sessions/{id}, POST /me/sessions/revoke-others, GET /me/login-history.
Rules: Argon2id via password.ts; sessions stored in PostgreSQL (sessions.token_hash = SHA-256 of the opaque id) with Redis read-through, per doc 06; cookie zo_sid HttpOnly Secure SameSite=Lax; idle 30 min sliding, absolute 12 h, remember me = 7 days absolute and 8 h idle (D79); max 3 sessions, revoke the oldest on a 4th (audit session.revoked); new session id on login; lockout 5 failures / 30 minutes (D37) stored on users.failed_attempts/locked_until; generic error text; the login request carries tab SUPER_ADMIN or ZONAL_ADMIN and a mismatch gives the same generic error without incrementing failed_attempts; first-login forced password change implemented as a "restricted" session that can call only /auth/change-password, /me and /auth/logout; reset token single-use, hashed, 30 min, reset revokes all sessions; CSRF double-submit (zo_csrf cookie + X-CSRF-Token) on every POST/PUT/PATCH/DELETE including /auth/*; rate limits of doc 52 section 8; login_history rows with the reason values of section 3; new-login email through the existing mail service (Mailpit in dev).
Audit (inside the same transaction, via lib/audit; use runWithAuditContext with the target user as actor for flows without a signed-in user): user.password_changed, user.password_reset_requested, user.locked, user.unlocked, session.revoked, reauth.failed. Successful login/logout: audit: { none: 'login' } / { none: 'logout' }.
Tests: TC-AUTH-1, 2, 4, 5, 8, 36 (PASSWORD level only), 37, 38 (password-reset part), 40, 41, 42, 43 (audit rows), 35 (enumeration: identical body, timing within noise), plus a cookie-flags test. Do NOT build any second-step logic.
Done when: pnpm lint && pnpm typecheck && pnpm test pass.
```
**Check:** log in on both tabs in a browser or with curl; fail five times and see the lock; `select action, outcome from audit_logs order by id desc limit 10;` shows your attempts; the wrong-tab credentials give the same message as a wrong password.

### Prompt M01-P4 — Two-step login: pending state, TOTP, backup codes (AUTH-4)
```
Task AUTH-4. Lane A. Load only: AGENTS.md, docs/F-execution/52_* sections 2.1, 2.2 (TOTP and backup codes), 2.5, 8, 10 (T30, T33, T36, T38, T39), the existing apps/api/src/modules/auth code, docs/F-execution/50_* section 4.3.
Implement the state machine of doc 52 section 2.1:
- pending.ts: Redis store for the pending login {userId, tab, remember, ip, uaHash, attempts, stage, mailboxProved}, 5-minute TTL, opaque id in cookie zo_mfa (HttpOnly, Secure, SameSite=Strict, Path=/api/auth), single use, deleted on success/failure/logout.
- POST /auth/login now: after the password check decide MFA_REQUIRED (user has >= 1 verified method that policy allows for the role), ENROLMENT_REQUIRED (none, policy requires; stage ENROL), or OK. Methods are returned only after the password is correct. No zo_sid is set for the first two outcomes and /me must return 401 with only zo_mfa present.
- POST /auth/mfa/verify for AUTHENTICATOR and BACKUP_CODE now (EMAIL_OTP / SMS_OTP return 501 until M01-P5): policy check that the method is allowed for the role and enrolled for this user (otherwise the same generic failure); TOTP verify with last_used_step replay guard updated in the same transaction; backup code consumed (used_at) in the same transaction; every failure increments users.failed_attempts and the pending attempts (5th failure locks 30 min and ends the pending login, D77); success: reset failed_attempts, new session via the M01-P3 code, login_history with mfa_method, new-login email, clear pending. Using a backup code also emails the user and audits user.backup_code_used.
- Audit: user.mfa_challenge_failed as DENIED outcome, rate limited 1 per minute per actor and action (D62; extend the short list in doc 50 section 4.3 by adding it to the code's DENIED allow-list), user.locked on lockout.
- Password reset must not bypass the second step (D76) and must not touch MFA rows: add the test.
Tests: TC-AUTH-6, 7, 9, 10, 11, 21, 26, 38 (full), 39, and a test that GET /me, any /me/* route and any module route reject a request holding only zo_mfa. Use an injectable clock; generate valid codes with the TOTP wrapper in the test.
Done when: pnpm lint && pnpm typecheck && pnpm test pass; the mutation checks "skip replay guard", "skip attempts increment", "compare with ===" and "return methods before password check" each make a test fail (do it once by hand, then revert, and note it in the handoff).
```
**Check:** with a seeded user who has an enrolled authenticator, log in with curl: after the password you get `MFA_REQUIRED` and **no `zo_sid`**; `curl /me` with only the `zo_mfa` cookie gives 401.

### Prompt M01-P5 — OTP challenges and email OTP (AUTH-5)
```
Task AUTH-5. Lane A. Load only: AGENTS.md, docs/F-execution/52_* sections 2.2 (email/SMS table), 2.7, 5, 8, 10 (T30, T31), existing auth module, docs/B-architecture/11_* (email).
Implement otp.service.ts and finish the EMAIL_OTP path:
- createChallenge(user, purpose, method): CSPRNG 6-digit code (crypto.randomInt), store HMAC-SHA256(OTP_HMAC_KEY, challengeId || code) only, TTL/attempt/cooldown/hourly/daily limits read from settings security.mfa with the floors and ceilings of doc 52 (counters in Redis, window by clock). Resend replaces the code on the same challenge row, increments send_count, sets last_sent_at, resets attempts for the new code, and invalidates the previous code. Destination is ALWAYS the verified email on the account record (never from the request).
- verifyChallenge(): timing-safe compare, attempts++ on failure, consume on success in the SAME transaction as the login/enrol success, expired/consumed/over-attempt all return the same generic failure.
- POST /auth/mfa/challenge (pending cookie) and the EMAIL_OTP branch of /auth/mfa/verify; 429 with retryAfter on cooldown and caps.
- Email template (plain, no links): subject "Your ZOAURO verification code", code, validity, "if this wasn't you, ignore this email and tell your administrator". Never log the code; log only challenge id and masked destination.
- Nightly BullMQ job: delete mfa_challenges older than 7 days (registered in the worker, with a test that calls the handler).
Tests: TC-AUTH-12, 13, 14, 15, 16 (assert DB and captured logs contain no plaintext code), 17, and that the EMAIL_OTP method is rejected for a role whose allowed list does not include it (Super Admin default) with the generic failure.
Done when: pnpm lint && pnpm typecheck && pnpm test pass; mutation checks "accept code from request-supplied destination" and "no attempts increment" each break a test.
```
**Check:** with Mailpit running, log in as a Zonal Admin who has Email OTP: the email arrives; a second request within 30 s is refused; the code works once.

### Prompt M01-P6 — SMS provider interface, caps and circuit breaker (AUTH-6)
```
Task AUTH-6. Lane A. Load only: AGENTS.md, docs/F-execution/52_* sections 2.2, 5, 6, 8 (sms rows), 10 (T31), the otp.service.ts from M01-P5, docs/B-architecture/12_*.
Build the SMS path but keep it OFF:
- sms/provider.ts: interface SmsProvider { send({to /*E.164*/, templateId, variables:{otp, minutes}}): Promise<{providerMessageId}> }; sms/disabled.provider.ts (default, throws SmsDisabledError); sms/console.provider.ts (prints the message to the API console and records it in memory for tests; refuses to load when NODE_ENV=production). Provider selected by SMS_PROVIDER (none | console); do NOT write a real provider adapter and do NOT pick a vendor (decision D68 is open).
- Env: SMS_PROVIDER, SMS_API_KEY, SMS_SENDER_ID, SMS_DLT_ENTITY_ID, SMS_DLT_TEMPLATE_ID_OTP, validated at boot; production fails to start with SMS_PROVIDER=console; settings validation: smsEnabled=true is rejected unless the provider is real and SMS_DLT_TEMPLATE_ID_OTP is set.
- otp.service: SMS_OTP branch uses users.phone only if phone_verified_at is set (verification itself happens in M01-P7); body text built from the registered-template constant in one file; E.164 normalisation using a small local function for +91 numbers for now (the library libphonenumber-js is NOT added until a real provider is chosen).
- Global hourly cap (setting smsHourlyGlobalCap, default 200): Redis counter; at 80% notify Super Admins; at 100% pause SMS (audit sms.paused, actor SYSTEM); POST /settings/security/sms/resume (Super Admin, STRONG re-auth placeholder = PASSWORD level until M01-P7) audits sms.resumed.
Tests: TC-AUTH-18, 19, 20; an SMS challenge cannot target a request-supplied number; paused state keeps email and TOTP working.
Done when: pnpm lint && pnpm typecheck && pnpm test pass; with smsEnabled=false no code path can reach the provider (test by spying on the provider).
```
**Check:** `SMS_PROVIDER=console`, enable SMS in a test settings row: the message appears in the API console; in production mode the API refuses to boot with `console`.

### Prompt M01-P7 — Enrolment, management, step-up and recovery (AUTH-7)
```
Task AUTH-7. Lane A. Load only: AGENTS.md, docs/F-execution/52_* sections 2.3, 2.4, 2.5, 8, 10 (T32, T34, T35, T37), the existing auth module, docs/F-execution/50_* section 4.
Implement:
- Enrolment endpoints of doc 52 section 8 under /me/mfa/*, accepting a full session OR the pending cookie in stage ENROL (guard requireSessionOrEnrolPending). First method requires mailbox proof (purpose ENROL_PROOF) before /authenticator/start; /email/start+confirm; /authenticator/start returns {secretBase32, otpauthUri} once and stores the encrypted unconfirmed secret (replacing any unconfirmed one); /authenticator/confirm verifies a code, activates, sets primary, returns 10 backup codes only on the first method; /sms/start+confirm use users.phone only and set phone_verified_at; PUT /me/mfa/primary; GET /me/mfa; POST /auth/mfa/enrol/complete (needs >= 1 verified allowed method and acknowledged backup codes) which creates the session.
- Step-up: reauth.ts requireRecentReauth('PASSWORD'|'STRONG'); /auth/reauth accepts password and, for STRONG, a code (TOTP, OTP or backup) and records reauth_at/level; STRONG valid 5 minutes and consumed by the first action. Apply STRONG to DELETE /me/mfa/{type}, POST /me/mfa/backup-codes/regenerate, POST /members/{id}/mfa/reset, PUT /settings/security, POST /settings/security/sms/resume.
- DELETE /me/mfa/{type}: 409 LAST_METHOD_REQUIRED when policy requires 2-step and it is the last allowed method. Every change sends the "method added/removed" email and revokes other sessions on removal.
- POST /members/{id}/mfa/reset (Super Admin only): requires reason, deletes methods and backup codes, revokes sessions, emails the member, audit user.two_factor_reset. If a Super Admin edits a member's email or phone, clear email-OTP/SMS methods and phone_verified_at accordingly (hook for M03; add the function and a test, M03 calls it).
- CLI: apps/api/src/cli/mfa-reset.ts ("pnpm --filter api cli mfa:reset --email x --reason y"): refuses unless NODE_ENV and DATABASE_URL are set, writes audit row with actor SYSTEM and the OS username in note, emails the user.
- Security Status backend: GET /settings/security/status (counts per role of enrolled/not enrolled, methods mix, active Super Admins, SMS state, failed second-step attempts 24 h).
Tests: TC-AUTH-22, 23, 24, 25, 27, 28 (policy part moves to P8 if not built), 30, 31, 32, 33, 34, 36 (STRONG), 44. Authorization actors: Super Admin, Zonal Admin, none.
Done when: pnpm lint && pnpm typecheck && pnpm test pass; mutation checks "skip mailbox proof", "return secret after enrolment", "allow reset without STRONG" each break a test.
```
**Check:** enrol an authenticator for a seeded Zonal Admin end to end with curl or a test script; try to call `/me/mfa/authenticator/start` before the email proof and see 403.

### Prompt M01-P8 — Security policy (AUTH-8)
```
Task AUTH-8 (backend of SA-7.2). Lane A. Load only: AGENTS.md, docs/F-execution/52_* section 5, 8, docs/F-execution/34_* SA-7.1/SA-7.2 rows, the settings module if it exists.
Implement GET/PUT /settings/security using the shared Zod policy (floors, ceilings, Super Admin invariants, SMS conditions), STRONG re-auth on PUT, diff + audit settings.2fa_policy_changed, effective within 60 seconds (settings cache with explicit invalidation). Enforcement: when required flips false->true for a role, revoke that role's existing sessions that lack mfa_verified_at; a user whose only method is no longer allowed gets ENROLMENT_REQUIRED at next login (login already supports it; add the policy-change handling and tests).
Tests: TC-AUTH-28, 29; invalid values rejected with field errors; a Zonal Admin gets 403.
Done when: pnpm lint && pnpm typecheck && pnpm test pass.
```
**Check:** change the Zonal Admin policy in a test; the next login of an enrolled-with-SMS-only member lands in `ENROLMENT_REQUIRED`.

### Prompt M01-P9 — Screens: login, /2fa, /2fa/setup, forgot/reset (AUTH-9; Dev 2, lane B)
```
Task AUTH-9 (= F2.6 extended). Lane B (web only). Load only: AGENTS.md, docs/F-execution/52_* section 9.1-9.3 and 9.7, docs/D-ui/19_*, 20_* (Login), 22_*, the shared Zod from packages/shared/src/auth, the existing components/ui kit and the Figma login card (docs/design if present).
Build apps/web/src/app/(auth)/: login (role tabs, show/hide, remember me, forgot link), /2fa (method switcher, OtpInput with paste and auto-submit and autocomplete="one-time-code", resend countdown from the server value, backup-code entry, generic error, locked/expired states), /2fa/setup (three-step wizard: confirm email -> add method with QR using the "qrcode" package (approved as D80; add it to apps/web only) and the manual key -> save backup codes with copy/download and the acknowledge checkbox -> complete), /forgot-password, /reset-password, and the forced change-password screen. TanStack Query + React Hook Form + Zod from the shared package. No tokens in localStorage; cookies only; send X-CSRF-Token.
Shared components in components/auth: OtpInput, MethodSwitcher, QrEnrol, BackupCodesPanel.
Tests: component tests for OtpInput (paste, backspace, auto-submit), Playwright TC-AUTH-45 (login + email OTP via Mailpit API) and TC-AUTH-46 (enrol authenticator using a test TOTP generator), axe on the three pages (TC-AUTH-47).
Done when: pnpm lint && pnpm typecheck && pnpm test pass and the Playwright flows pass locally.
```
**Check:** do the whole flow by hand in a browser: wrong password → generic error; right password → code screen; Mailpit code works; refresh on `/2fa` keeps the step; "Back to sign in" ends it.

### Prompt M01-P10 — Account security page, policy tab, member reset (AUTH-10)
```
Task AUTH-10. Lane B. Load only: AGENTS.md, docs/F-execution/52_* sections 9.4-9.6, docs/D-ui/20_* (Settings > Security), the components from M01-P9, docs/F-execution/37_* row 13.
Build /account/security for both roles (profile menu link): methods card with add/remove/primary, STRONG re-auth dialog (password + code), backup codes card with regenerate, active sessions table with revoke and "sign out other devices", recent sign-ins table. Build Settings > Security (Super Admin): existing Figma sections plus the 2-step policy editor (SMS toggle DISABLED with the reason text until the backend says it is available) and the Security Status card; saving shows the diff and the STRONG dialog. Add "Reset 2-step verification" to the member detail screen if M03's member screen exists; if not, build the dialog component and leave the wiring to M03 with a note in the handoff.
Tests: Playwright for removing a method, regenerating codes and revoking a session; axe on the page; Zonal Admin cannot open Settings > Security.
Done when: pnpm lint && pnpm typecheck && pnpm test pass.
```
**Check:** as a Zonal Admin you can reach `/account/security` and not `/super-admin/settings/security`.

### Prompt M01-P11 — Independent verification of the whole module (new session, read-only)
```
Role: independent reviewer. Do not edit any file. Load only: docs/F-execution/52_*, docs/C-security/13_* (T30-T39), the code under apps/api/src/modules/auth, packages/shared/src/auth, apps/web/src/app/(auth) and account/security.
1) Trace each of T30-T39 to the code that mitigates it and the test that proves it; list any threat without both.
2) Check these invariants and show the lines: no session cookie before the second step; wrong codes increment failed_attempts; codes and secrets never logged or returned after enrolment; destination never taken from a request; replay guard in the same transaction as success; methods revealed only after a correct password; every mutating route has audit metadata.
3) Run the suite and report counts: pnpm test, and the TC-AUTH ids covered vs doc 52 section 11.
4) Do the five mutation checks of doc 52 section 11 on a scratch copy and report which survive.
5) List anything you could not verify.
Output a table: item, evidence (file:line), verdict (OK / GAP / NOT VERIFIED). Do not soften findings.
```
**Check:** fix every GAP in a separate prompt; do not call the module done while a threat has no test.

---
# Part B — M02 Zones

### Prompt M02-P1 — Schema, pincode helpers, shared contracts (ZONE-1)
```
Task ZONE-1. Lane D + shared. Schema gatekeeper (Dev 1). Load only: AGENTS.md, docs/F-execution/53_Module_Guide_M02_Zones.md sections 2.3, 3, 4, docs/B-architecture/08_* (zones, serviceable_pincodes), docs/F-execution/50_* section 4 and 5.
1) Prisma: update Zone (code, version, activated_at, deactivated_at, deactivation_reason, created_by, deleted_at, color_hex) and ServiceablePincode: pincode char(6), source PincodeSource {RANGE, MANUAL, IMPORT}. Create the migration with "prisma migrate dev --create-only --name zones_integrity" and write by hand: UNIQUE(code) including soft-deleted rows, unique index on lower(name) where deleted_at is null, UNIQUE(pincode) on serviceable_pincodes, CHECK constraints from doc 53 section 3 (code regex, delivery_charge 0..100000, pincode regex, from <= to). Existing dev data: if rows violate a constraint, stop and report.
2) packages/shared/src/zones/: pincode.ts (normalise, validate ^[1-9][0-9]{5}$, expandRange with the 2000 cap), palette.ts (12 tokens), schemas.ts (create, patch, pincodes, deactivate), errors.ts. Pure functions with unit tests (valid and invalid tables, range edge cases, 2001 refused).
3) Add zone.delivery_charge_changed, zone.pincodes_changed, zone.deleted to AUDIT_ACTIONS (HIGH where doc 53 section 4 says).
Done when: prisma migrate succeeds on an empty and on the dev database; a database test proves each constraint rejects a bad row when inserted directly with SQL as zoauro_app (so the DB protects itself, not just the service); unit tests pass.
```
**Check:** `psql … -c "insert into serviceable_pincodes (...) duplicate pincode"` fails with a unique violation.

### Prompt M02-P2 — Service and API (ZONE-2)
```
Task ZONE-2 (= SA-1.1 backend). Lane A. Load only: AGENTS.md, docs/F-execution/53_* sections 2.1, 2.2, 2.6, 5, 7, 8, docs/B-architecture/09_* (zones), docs/F-execution/50_* section 2.1, the BaseRepository/AuthContext code, docs/F-execution/36_* section 1.
Implement apps/api/src/modules/zones per doc 53 section 7: routes, controller, service, repository (only Prisma importer), pincodes.service.ts, impact.service.ts, zones.events.ts.
- Endpoints of section 5 except /zones/resolve (M02-P3): list, summary, create, get, patch, PUT pincodes (with ?preview=true dry run), lookup, activate, impact, deactivate, delete, team (read-only; if M03 does not exist yet return an empty list with partial:true).
- Rules: Super Admin only (Zonal Admin gets 403 on every route); code immutable; optimistic version (409 STALE_VERSION); status transitions of section 2.1 only; activation preconditions; deactivate needs reason, impactVersion match and PASSWORD re-auth; delete only for pristine zones; overlap check inside a transaction with pg_advisory_xact_lock(hashtext('zones.pincodes')); range recomputation touches only source=RANGE rows; removing pincodes returns the mismatch list and never moves vendors.
- impact.service.ts defines the port interface ImpactSources and registers stub implementations returning zeros with partial:true until the Restaurants, Homemakers, Partners, Orders and Access modules register real ones. The UI must be able to tell the difference.
- Every write: one transaction containing the change, the audit row (correct action: delivery charge and pincode changes use their own actions) and the outbox/event rows for zone.updated and admin.zones_changed, and the zones:version cache bump after commit.
Tests: TC-ZONE-5, 6, 7 (real concurrency: two connections), 8, 9, 10, 11, 12, 13, 14, 15, 16 (use a stub open-order count; the full check repeats when Orders exist), 17, 18, 22, 23, 24, 25, 26 (stub vendor), 27. Authorization actors: Super Admin, Admin(A), Admin(A+B), Admin(none).
Done when: pnpm lint && pnpm typecheck && pnpm test pass; mutation checks "remove advisory lock", "allow code patch", "cascade-update vendors on deactivate" each break a test.
```
**Check:** create two zones via the API; try to give the second one a pincode of the first and read the error; deactivate without a reason and read the error.

### Prompt M02-P3 — Zone resolver, cache and events (ZONE-3)
```
Task ZONE-3 (with IH-2 resolver part). Lane A. Load only: AGENTS.md, docs/F-execution/53_* sections 2.3, 2.5, docs/G-integration/42_*, docs/G-integration/contracts/intake.openapi.yaml (ZoneResolution and /zones/resolve) and events.catalog.json (zone.updated), docs/G-integration/44_* if the intake framework exists.
Implement resolve.service.ts exactly as section 2.3: normalise pincode, look up serviceable_pincodes, map status (ACTIVE -> serviceable with charge; UPCOMING -> not serviceable with status UPCOMING; INACTIVE and unknown -> NONE), lat/lng accepted but not used (state this in a code comment and in the response doc note), Redis cache zones:pin:<pincode> TTL 300 s keyed with the global zones:version counter. Do not change the contract files. If the intake framework (IH-1) already exists, register GET /zones/resolve with scope zones:resolve and the per-client rate limit; if not, ship the service plus a contract test that validates its output against the ZoneResolution schema and leave route registration to IH-2, noting that in the handoff.
Outbox: ensure zone.updated rows carry {zoneId, name, status, pincodeRange (the range string, or "multiple"), deliveryChargePaise} exactly as the catalogue lists it; do NOT add pincodeCount (that needs the app teams, D87).
Intake order check (if the order intake exists): the serviceability check reads the zone row inside its own transaction and does not trust the cache.
Tests: TC-ZONE-19, 20, 21, 24 (event content), 30 (performance on 10,000 seeded pincodes; report numbers). 
Done when: pnpm lint && pnpm typecheck && pnpm test pass and the performance numbers are in the handoff block.
```
**Check:** change a zone's charge and call the resolver immediately — you get the new charge.

### Prompt M02-P4 — Zone Management screens (ZONE-4; Dev 2 or Dev 1, lane B)
```
Task ZONE-4 (= SA-1.1 UI). Lane B. Load only: AGENTS.md, docs/F-execution/53_* section 6, docs/D-ui/19_*, 20_* (Zone Management), 22_* (Zone form), the components/ui kit and Figma Zone Management frames if available, the shared zones Zod.
Build apps/web/src/app/super-admin/zones: list (KPI cards, "zones without a team" chip, table columns per Figma, filters, search, row menu), Add/Edit overlay with code (disabled after creation), pincode editor (range + paste/CSV + chips + live overlap hint from /zones/lookup), MoneyInput, status, 12-swatch colour picker, description; zone detail page with Overview / Pincodes / Team (read-only) / Activity tabs (ActivityTab from the Audit module if it exists, otherwise a placeholder component with a TODO in the handoff); Activate and Deactivate dialogs with the impact table (show "Some modules are not built yet" when partial:true), reason, acknowledgement checkbox and re-auth. Server field errors map to form fields; PINCODE_OVERLAP lists the conflicts.
Tests: component tests for the pincode editor; Playwright TC-ZONE-28; axe TC-ZONE-29.
Done when: pnpm lint && pnpm typecheck && pnpm test pass and the Playwright flow passes.
```
**Check:** in the browser: add a zone with an overlapping pincode and read the error naming the other zone; fix, save, activate, deactivate (see the impact dialog).

### Prompt M02-P5 — Independent verification (new session, read-only)
```
Role: independent reviewer. Do not edit any file. Load only: docs/F-execution/53_*, docs/C-security/13_* (T40-T43), apps/api/src/modules/zones, packages/shared/src/zones, the migrations, apps/web/src/app/super-admin/zones.
1) Show that each rule R-ZONE-1..10 is enforced where the doc says (DB constraint or code) with file:line, and the test that proves it.
2) Prove R-ZONE-2 at database level: show the unique index and the test that inserts a duplicate directly with SQL.
3) Check that deactivate performs no writes to vendors, partners or orders (grep the transaction) and that the cache version is bumped after commit and not before.
4) Run pnpm test; report the TC-ZONE ids covered vs doc 53 section 9 and which are still stubbed on other modules.
5) Do the five mutation checks of doc 53 section 9 on a scratch copy; report survivors.
6) List what could not be verified (anything that needs Orders, Restaurants, M03 or the intake framework).
Output a table: item, evidence, verdict (OK / GAP / NOT VERIFIED).
```

---
## If something goes wrong
| Symptom | Likely cause | Fix |
|---|---|---|
| `otplib` code from an example does not compile | version 13 API differs from v12 | Prompt P2 says read the installed types; tell Claude Code to do exactly that |
| OTP email never arrives locally | Mailpit not running or `SMTP_URL` wrong | `docker compose -f docker-compose.dev.yml ps`; open http://localhost:8025 |
| `/me` returns 401 right after the password step | correct: no session until the second step | use the verify call, then `/me` |
| Migration folder sorts before `init` | copied folder names from another project | always `prisma migrate dev --create-only` |
| API refuses to boot: `OTP_HMAC_KEY` | new env var | add a 32+ byte value to `.env`; must differ from the other secrets |
| API refuses to boot with `SMS_PROVIDER=console` in production | by design | use `none` until a provider is configured |
| Pincode overlap error on seed | seed data reuses a pincode | make seed pincodes disjoint |
| Test locks the same account repeatedly | tests share a user | create a user per test, reset the clock |
| Impact shows zeros | other modules not built yet | expected; the response says `partial:true` |
If a prompt fails twice, stop, paste the failing test output into a new session with "Task: fix this failing test only; do not change the test", and commit separately.

## Appendix — the files changed in this release
New: `F-execution/52_*`, `F-execution/53_*`, `H-delivery/54_*`. Amended: `README.md`, `A-product/02, 03, 05`, `B-architecture/06, 08, 09, 11, 12`, `C-security/13, 14, 17`, `D-ui/20`, `E-quality-ops/24, 25, 32`, `F-execution/34, 37, 39, 40, 50`, `G-integration/42`, `A-product/02`, `E-quality-ops/25, 31`, `AGENTS.md`. Copy all of them.
