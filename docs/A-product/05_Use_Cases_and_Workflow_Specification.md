# 05 — Use Cases and Workflow Specification (v1.1)

## UC-01 Zone and Zonal Admin onboarding (Super Admin)
Pre: Super Admin signed in with 2FA. Steps: 1 Zone Management > Add Zone (name, city, pincode range, delivery charge, status). 2 Zonal Admins > Add (name, email, phone, assign **one or more zones**, initial password, status). 3 System emails credentials; sets must_change_password. 4 Audit entries created.
Alternates: duplicate zone name rejected; email already used rejected. Post: Zonal Admin can log in and sees an empty dashboard for the assigned zones.

## UC-02 Restaurant onboarding (Zonal or Super Admin)
Steps: Add restaurant (Pending) → upload documents → verify → set commission (default or Super Admin value) → set hours → activate. Rejection: status stays Pending with note. Same flow in the Homemakers module with homemaker fields.

## UC-03 Menu management
Add category → add item (name, description, vendor, category, price, stock, availability, featured, image) → toggle availability. Bulk: availability, category, price update with preview and confirmation.

## UC-04 Order handling
1. Customer places order (outside panel) → status Placed, appears in zone Orders.
2. Vendor accepts (or timeout cancels). 3. Preparing → Ready. 4. Zonal Admin assigns delivery partner (manual). 5. Partner picks up → Out for Delivery. 6. Delivered; COD marked collected.
Admin interventions: reassign partner, cancel with reason, mark delayed, refund.

## UC-05 Cancellation
Admin opens order → Cancel → reason code and note → confirmation → status Cancelled; if paid, refund suggested (full by default) → ledger entry. Notifications sent.

## UC-06 Refund
Order detail → Refund → type, amount (≤ captured − refunded), reason. If within Zonal limit: processed through gateway (or manual for COD). Else: status PENDING_APPROVAL, Super Admin sees queue, approves or rejects with note. Failure: status FAILED, retry with same idempotency key.

## UC-07 Delivery partner onboarding
Create → upload ID and vehicle documents → verify → activate. Availability toggled by partner app; admin can force offline.

## UC-08 Roles and Permissions
Super Admin selects role → toggles V/A/E/D/S per module → Save → confirmation toast, audit entry; changes apply on next request.

## UC-09 Security settings
Super Admin sets password policy, 2FA enforcement, session timeout, lockout; views login history and active sessions; revokes sessions.

## UC-09b 2-step verification: enrol and sign in
Pre: member has a temporary password. Steps: 1 login with password. 2 app asks to set up 2-step: confirm the email code first. 3 add authenticator (scan QR, enter code) and, where policy allows, email/SMS. 4 save 10 backup codes. 5 signed in. Later logins: password, then a code from the chosen method. Alternatives: wrong code 5 times locks 30 min; backup code works once.

## UC-09c 2-step recovery
Member lost the phone and codes: Super Admin opens the member > Reset 2-step verification (reason, password + code); all sessions end; member is emailed and sets up again with an email check. Super Admin locked out: another Super Admin resets; if none, ops runs the audited CLI (doc 52 §2.5).

## UC-11 Zonal Admin works across several zones
Pre: admin assigned to zones A and B. Steps: 1 Login → `/zone/dashboard` with scope "All my zones (2)". 2 KPIs and lists show A+B with a Zone chip. 3 Admin switches the sidebar zone card to B → URL `?zone=B`, all data narrows. 4 Creates a homemaker: Zone field offers only A and B. 5 New order in A triggers a toast naming zone A. Alternates: Super Admin removes B → next request on B objects is 404, switcher drops B. Post: no data from zone C is ever visible.

## UC-12 Assignment change (Super Admin)
Zonal Admins > Edit > Assign Zones → confirm with re-auth → diff audited → admin's scope updates on next request, sockets rejoin rooms.

## UC-10 Super Admin monitoring
Dashboard → drill into zone performance → open a zone's orders (global view with zone filter).

## Cross-cutting rules
Confirm destructive actions; show toasts; every write audited; every list supports search, filter, sort, pagination.
