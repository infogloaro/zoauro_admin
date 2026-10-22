# 55 — Moving from what you already have to docs 52–54 (adopt, trim, or keep)

For a repo that already has pack v2.3 in `docs/`, and possibly code from doc 51 (monorepo, audit module, password login A6, AuthContext A7–A8). I do not know exactly what code you have, so the plan starts with a read-only audit that tells you; then you run only the prompts that apply. Nothing here edits a shipped migration or rewrites working code.

## 1. Verdict per change (what is worth it for this project)
Scale reality: 3 developers, an internal admin panel, a few dozen admins, pilot in about 26 weeks. Judged against that:

| Change | Verdict | Why |
|---|---|---|
| No session until the second step (pending cookie), wrong codes count toward lockout, replay guard, hashed OTP, mailbox proof before first enrolment | **Adopt** | These are the difference between "has 2FA" and "2FA that works". Small code, high value. Cheap now, a rewrite later |
| Authenticator + backup codes + email OTP | **Adopt** | Already promised in doc 14; the guide only makes it precise |
| SMS OTP: interface, disabled adapter, caps, breaker | **Trim: interface + disabled adapter only** | You have no provider and no DLT registration. The breaker and global cap protect a feature that cannot run. Build the provider interface and "off" so the toggle can exist; add caps/breaker in the same task as the real adapter (AUTH-12). Saves ≈ 0.3 dev-week and removes untestable code. This changes doc 52 §2.2 "SMS circuit breaker" from v1 to AUTH-12 |
| `STRONG` re-auth level | **Adopt, small** | Only five actions use it; one extra field and a guard |
| Policy editor with every number editable (TTL, caps, cooldown) | **Trim: seed the defaults, edit only required/allowed methods per role in v1** | Nobody will tune OTP TTL in the pilot; the Zod floors protect the rest. Saves ≈ 0.3 dev-week. The numbers stay in `settings` so the editor can come later |
| Ops CLI reset + ≥ 2 Super Admins warning | **Adopt** | Cheapest insurance against locking yourself out |
| Account security page (methods, sessions, history) | **Adopt** | Zonal Admins have no Settings module, so this is their only security UI |
| Zones: unique pincode index, immutable code, DB CHECKs, status transitions, impact check, audit actions | **Adopt** | Mistakes here misroute orders |
| Zones: advisory lock around overlap check | **Drop** | The unique index already makes overlap impossible; the lock only improves the error message under a rare race. Catch the unique violation and return `PINCODE_OVERLAP`. Changes doc 53 §3 and prompt M02-P2 (TC-ZONE-7 still passes: one wins, the other gets the 409) |
| Zones: Redis resolver cache with `zones:version` | **Defer** | An indexed lookup on a 6-char unique column is a millisecond query at 10 000 rows. Measure in M02-P3 (TC-ZONE-30); add the cache only if p95 misses 50 ms. Removes the stale-cache threat T43 until needed |
| Zones: detail page tabs (Team, Activity) | **Trim to Overview + Pincodes** in v1 | Team/Activity depend on M03 and M04 UIs that do not exist yet; add when they do |
| Everything in docs 02–50 patches | **Adopt** | Pure consistency; keeps one source of truth |
| "Trust this device" / passkeys / geofencing | **Not added** | Out of scope on purpose (docs 52 §1.2, 53 §1.5) |

**Keep as it is, if your code already does it:** Argon2 library choice, opaque-session storage (doc 06 says PostgreSQL + Redis read-through; if A6 used Redis-only sessions with the same cookie flags and timings, keep it and just add `mfa_verified_at`, `reauth_*` to whatever store you have), your CSRF implementation if it is double-submit, your existing login_history rows, your existing zones list/overlay UI. The guides specify behaviour; they do not demand a rewrite of equivalent code.

## 2. Steps
1. **Copy the documents** (Step 0 of doc 54, plus this file). Commit as `docs: auth and zones guides`.
2. **Review the diffs by hand** before any code: `git diff HEAD~1 -- docs/A-product/03_* docs/C-security/14_*`. These two carry the decisions; if you disagree with D66, D67, D73 or D82, edit doc 03 now.
3. **Apply the trims of §1** by editing three lines of text (you, not Claude Code): in doc 54 prompts M01-P6 and M01-P8 and M02-P2/P3 the overrides in §3 below replace the text. Easiest: paste the matching override block at the end of the prompt.
4. **Run the audit prompt (§4)** in a read-only session. It outputs a table: existing / matches / differs / missing for auth and zones.
5. **Run the doc 54 prompts that the table says are needed**, in order. Map:

| Audit result | Run |
|---|---|
| No auth code | doc 54 M01-P1 … P11 |
| Password login exists (A6), no 2FA | M01-P1, P2, P3 as gap fix (it diffs), P4 … P11 |
| TOTP already built (single-step: session first, code after) | M01-P1, P2; then **P4 as a rewrite of the login path only** (this is the one change that cannot be a gap fix: the session must not exist before the code). Migrate data per §5 |
| Zones list/CRUD exists | M02-P1 (migration with a data pre-check), P2 as gap fix, P3, P4 as gap fix, P5 |
| No zones code | M02-P1 … P5 |

6. **Verification prompts** (M01-P11, M02-P5) at the end, as written.

## 3. Override blocks (paste at the end of the named prompt)
**M01-P6 (SMS):** `Override from doc 55: build ONLY provider.ts, disabled.provider.ts, console.provider.ts, the env validation and the rule "smsEnabled cannot be true without a real provider and template id". Do NOT build the global hourly cap, circuit breaker, sms.paused/resumed actions or the resume endpoint; those move to task AUTH-12 with the real adapter. Skip TC-AUTH-20.`
**M01-P8 (policy):** `Override from doc 55: PUT /settings/security accepts only security.mfa.required and security.mfa.allowed per role (and smsEnabled, with its rule). All other values stay at the seeded defaults and are read-only in the API response. Keep the Zod floors/ceilings in the shared schema for later.`
**M01-P10 (UI):** `Override from doc 55: the policy editor shows required and allowed methods per role only; the other numbers are shown read-only with their values.`
**M02-P2 (zones service):** `Override from doc 55: do NOT use pg_advisory_xact_lock. Rely on the UNIQUE(pincode) index: catch the unique-violation inside the transaction, roll back, and return PINCODE_OVERLAP with the conflicting pincodes and owning zone (query them after the failure). TC-ZONE-7 still requires exactly one of two concurrent creates to succeed. Drop the advisory-lock mutation check.`
**M02-P3 (resolver):** `Override from doc 55: no Redis cache and no zones:version counter. Implement the plain indexed lookup, run TC-ZONE-30 against 10,000 seeded pincodes, and report p95. Only if p95 exceeds 50 ms warm, stop and propose the cache; do not add it speculatively. Skip TC-ZONE-19's cache part (keep the "new charge visible immediately" assertion).`
**M02-P4 (UI):** `Override from doc 55: zone detail page has Overview and Pincodes tabs only; Team and Activity tabs are added when the Access and Audit screens exist.`

## 4. Audit prompt (read-only, new session)
```
Role: read-only auditor. Do not edit or create files. Compare the current repository with these specs: docs/F-execution/52_Module_Guide_M01_Auth_and_Sessions.md, docs/F-execution/53_Module_Guide_M02_Zones.md and docs/H-delivery/55_Migrating_Existing_Work_to_Auth_and_Zones_Guides.md section 1.
Inspect: apps/api/src/modules/auth, apps/api/src/modules/zones (if present), prisma/schema.prisma and migrations for users, sessions, login_history, user_mfa_methods, mfa_*, zones, serviceable_pincodes, packages/shared (auth, zones), apps/web login / 2fa / zone screens, tests under tests/ for TC-AUTH and TC-ZONE ids.
Output ONE table with columns: Requirement (short), Spec section, Status (MATCHES / DIFFERS / MISSING), Evidence (file:line), Effort (S/M/L). Cover at least: session created before the second step? (yes/no), where MFA secrets and backup codes are stored and whether encrypted, replay protection, OTP hashing, attempt counting vs lockout, re-auth levels, wrong-tab handling, cookie flags, session storage (Postgres/Redis), zone code immutability, UNIQUE pincode index, CHECK constraints, status transition rules, impact check, resolver behaviour for INACTIVE/UPCOMING, audit actions present in AUDIT_ACTIONS, tests present.
Then list: (a) existing data that needs migrating (counts of users with MFA data, zones violating the new constraints), (b) anything that would be destroyed by the planned migrations, (c) items you could not determine. Do not recommend rewrites of code that already matches behaviour.
```

## 5. Data migration notes (only if the audit finds existing rows)
- **Existing TOTP secrets in `users.mfa_secret_encrypted`:** copy into `user_mfa_methods` (type AUTHENTICATOR, `verified_at` = enrolment time or now, `is_primary` true) in the same migration, **keeping the ciphertext as is** only if it is already AES-256-GCM with the current key; otherwise decrypt and re-seal in a one-off script run by the owner, never in SQL. Backup-code hashes: if they were not HMAC with `OTP_HMAC_KEY`, discard them and force regeneration (users see a prompt). Drop the old columns in a **later** migration, after one release.
- **Zones that violate the new constraints** (duplicate pincodes across zones, bad codes, duplicate names): the migration must fail loudly with the list; fix the data first. Do not auto-delete.
- **Active sessions** at cutover: revoke all (users sign in again through the two-step flow).
- Take a database backup before applying; run the migration on a copy first.

## 6. What this document does not change
Docs 52–54 remain the specification; this file only records which parts to defer or drop and how to adopt them without rewriting working code. The three deferred items (SMS breaker, full policy editor, resolver cache) are listed as tasks AUTH-12, AUTH-8b and ZONE-3b so they are not forgotten.
