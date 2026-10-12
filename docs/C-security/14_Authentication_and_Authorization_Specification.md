# 14 — Authentication and Authorization Specification (v1.2)

## 1. Provider decision (D5, changed)
v1.0 assumed Auth.js. Auth.js is a Next.js library; with the Express API (D16) it would force auth into the web tier and split the trust boundary. v1.1 uses **in-house session auth inside the API**: small, fully under our control, easy to scope by zone, and the same family of pattern as the GloAro CRM auth. If the CRM auth code is shareable, extract it into a package rather than copying; otherwise build to this spec.
Cognito remains rejected unless SSO/social login becomes a requirement. **Figma shows "Login with Google" on the login card. It is not in v1 (D42):** admin accounts are created by Super Admin, and social login would bypass the password policy, 2FA enforcement and lockout in this spec.

## 2. Authentication rules
- Email + password; Argon2id; minimum 12 characters (configurable); breached-password check optional.
- Generic error "Invalid email or password".
- Lockout: max attempts 5 → lock **30 minutes** (Figma defaults, D37; both editable in Settings > Security).
- 2FA (amended by doc 52, D65–D77): authenticator app (TOTP) mandatory for Super Admin and required by default for Zonal Admin (policy); email OTP and **SMS OTP** are supported methods per role policy; Super Admin defaults to authenticator + backup codes only (D66). SMS OTP is built behind a provider interface and **off until a real provider and DLT-registered template exist** (D67; this replaces "kept off" and TD-17). 10 single-use backup codes. No session cookie exists until the second step passes (D69).
- Session: opaque ID in HTTP-only, Secure, SameSite=Lax cookie; idle timeout 30 min (Figma default); absolute 12 h; remember me 7 days (setting).
- Multiple sessions policy configurable (Figma toggle "Allow multiple sessions"; default allowed up to 3).
- Reset password: single-use hashed token, 30 min expiry; revokes all sessions.
- First login of new admin forces password change.
- New-login email with device and IP (Figma toggle "Notify on new login").
- Login history and active sessions viewable by self; Super Admin can view/revoke any.

## 3. Login flow
The login card has two tabs, **Super Admin** and **Zonal Admin** (Figma). The tab is a UI selector only: the server checks the account's identity role against it and answers a mismatch with the same generic "Invalid email or password" error. Then: credentials → (if MFA) code → create session → record login_history → redirect by role: Super Admin `/super-admin/dashboard`, Zonal Admin `/zone/dashboard`. A Zonal Admin with no active zones lands on `/zone/no-zones` (read-only message, logout).

## 4. Authorization
```
AuthContext = {
  userId, role, isSuperAdmin,
  assignedZoneIds: UUID[],                          // active admin_zone_assignments
  permissionsByZone: Map<ZoneId, Set<"module:action">>,   // profile + grants - denies, per assignment (v1.2, D41)
  limitsByZone: Map<ZoneId, { perRefund, dailyRefund, canReveal, canExport }>,
  requestedZoneIds: UUID[] | "ALL",
}
can(ctx, "orders:edit", zoneId)                    // capability in ONE zone (writes, object access)
zonesFor(ctx, "orders:view")                       // = requested ∩ { z | permissionsByZone[z] has "orders:view" } (lists, aggregates)
repo.orders.list(ctx, filters)                     // uses zonesFor(ctx, "orders:view"); Super Admin with no zone requested = no filter
```
The whole `AuthContext` is built per request from `admin_zone_assignments`, `access_profiles`, `profile_permissions` and `assignment_overrides` (Redis read-through, ≤ 60 s TTL, explicit invalidation on any access change). Nothing about zones or permissions is stored in the session.
- Enforced in: controllers (permission guard declares `module:action`), services (`can(ctx, perm, zoneId)` for the object's zone), repositories (`zonesFor`). Middleware only authenticates and builds the context.
- Zone scope is **not** stored in the session. It is resolved from assignments each request, so revoking a zone applies immediately (R-ACC-5). Cache TTL ≤ 60 s with explicit invalidation on every access change (`PUT /zonal-admins/{id}/access`, profile edits).
- Object in an unassigned zone → 404. Zone id in query not assigned → 404 `ZONE_NOT_FOUND`. Zone assigned but module not viewable there → 404 on read, 403 on write. Deny overrides always win.
- Any change to a profile, an assignment, an override or a limit invalidates the affected members' cached context immediately and emits `scope.changed` (members' tabs refetch `/me`). Access changes do not revoke sessions; removing a member's last zone or suspending the account does.
- Socket.IO handshake uses the same session; rooms `zone:<id>:orders` are joined only for zones where the member has `orders:view`, and `zone:<id>:refunds` only where they have `refunds:view`; rooms are re-evaluated on `scope.changed`.
- High-risk actions require recent re-authentication (password or TOTP within 10 min): change role, **change any member's access (profile, overrides, limits, zones)**, edit an Access Profile, delete/deactivate zone, approve large refund, mark payout paid, change payment settings, move vendor to another zone. **Amended (D74):** two levels. `PASSWORD` for the list above; `STRONG` (password + a current second-step code) for removing a 2-step method, regenerating backup codes, resetting a member's 2-step, editing the security policy.

## 5. Privileged access
Super Admin accounts limited and named; no shared accounts; all Super Admin actions audited; break-glass account stored offline, used only with incident record. A Zonal Admin cannot edit their own role, permissions, status or zone assignments (R-ACC-1).

## 6. Test requirements
Matrix test: for each endpoint × actor × zone relationship × permission state (granted, missing, denied-by-override). Actors: Super Admin, Admin(A, full), Admin(A+B, full in A and read-only in B), Admin(A, payments denied), Admin(none). Relationships: in-scope zone, other assigned zone, unassigned zone C, no zone filter, forged zone filter. See doc 24.

## 8. App-client authentication (v2.0)
Customer, vendor and partner app backends are **machines, not users**: no session, no cookies, no CSRF. They authenticate each request with `X-Zoauro-Key-Id`, `X-Zoauro-Timestamp` and an HMAC signature over method, path and body hash (doc 42 §1), plus a mandatory Idempotency-Key on writes. Client records live in `api_clients` with scopes and an IP allow-list; secrets are AES-GCM encrypted with `ENCRYPTION_KEY`. They are completely separate from panel permissions: an app client can never call a panel endpoint and a panel user can never call `/intake/*`. Creating, rotating, disabling a client needs Super Admin with recent re-authentication and is audited.
