# 59 — Control & Governance module: Phase 0 implementation map and schema/API plan

Status: **proposal, waiting for the owner's approval** (gate of Phase 0). Nothing below is built or migrated yet.
Source: the owner's "Zoauro Super Admin Control & Governance Module" specification (2026-10-15) and the rule
"until the Super Admin defines a rule, the default rule is followed; once the Super Admin changes it, that one is
followed". Inspection was read-only (code at a8d3c9a, docs 03, 08, 09, 12, 18, 36, 43, events catalogue).

Legend: **Built** = in code and tested · **Partial** = some of it exists · **Missing** = not in code ·
**Blocked** = needs a module that does not exist yet.

## 1. Implementation map (spec section → what exists)

| Spec | State | What exists (file) | What is missing |
|---|---|---|---|
| 2.1 Dashboard | Partial | Super Admin dashboard: zones by status, latest zones, 2-step coverage, recent activity (`features/dashboard/*`) | Admin counts (active / suspended / not yet signed in), pending requests, recent access + settings changes, sensitive actions, "needs configuration" list. All from real data; no order or money tiles until those modules exist |
| 2.2 Zones | Built, one gap | Create, edit, pincodes, activate, deactivate with reason, delete only when never live, impact preview, team and activity tabs (`modules/zones`, `features/zones`) | **Suspend** (no SUSPENDED status, decision Q2). Zone-level setting overrides (2.7) |
| 2.3 Zonal Admin accounts | Built, one gap | Create with temporary password, edit, suspend/reactivate (ends sessions), reset password, revoke sessions, soft delete, access summary and history (`modules/access`, `features/access/admins`) | No email invite flow (D103 chose temporary password); "pending invitations" will mean "created, never signed in" (Q8) |
| 2.4 Membership and responsibilities | Built | Per member per zone: profile + GRANT/DENY overrides + limits, zone teams (`admin_zone_assignments`, `assignment_overrides`) | Nothing; "responsibility" = profile + overrides in that zone |
| 2.5 Permission editor | Built | Grid from the registered catalogue (`packages/shared/src/permissions.ts`), never-grantable locks, 422 on non-grantable, preview, deny wins, `access_changes` before/after, server enforcement via `can()` / `zonesFor()` | Show the deny reason in the preview (small web change) |
| 2.6 Service switches | Partial | Switches, defaults Restaurants ON / Home Food ON / Hotel OFF, PASSWORD re-auth, audit (D92). Migration `20261014090000_zone_services` applied to `zoauro` on 2026-10-15 (session -90, owner-approved) | Enforcement: `assertServiceEnabled()` exists but nothing calls it, because onboarding, orders and the intake API are not built (**Blocked**). Reason field on the switch |
| 2.7 Platform settings | Missing | Only `security.mfa` in `settings` (validated, 60 s cache, audited). `settings` has no version, no zone column | Typed settings registry, platform values, zone overrides, effective-value resolution, versioning, UI |
| 2.8 Change workflow | Partial | Pattern exists in Security settings (validate → re-auth → transaction + audit → cache cleared) | Generic: diff preview, impact preview, mandatory reason, version check, `config.changed` outbox event |
| 2.9 Settings History | Missing | Audit log rows for `settings.*` actions | History screen with filters, secrets redacted |
| 2.10 Access requests | Missing | Nav entry R13 (Soon) | Table, API, My Requests, Super Admin queue, approve/reject, emails |
| 2.11 Zone scope switcher | Missing | API already scopes by `?zoneId=` (requested ∩ assigned); `user_preferences.last_zone_scope` column exists; read-only Zone chip | Top-bar switcher, URL state, `PUT /me/zone-scope`, apply on dashboards/lists |

Dependencies outside this module: the **outbox publisher** is not running (`worker.ts`), so `config.changed` and
`zone.updated` are written to the outbox but not yet delivered to the apps. The **intake API** is empty.

## 2. How "default until the Super Admin changes it" works

One typed registry in `packages/shared/src/settings/` lists every setting: key, group, Zod schema, code default,
whether a zone may override it, re-auth level, whether apps read it (`config.changed`), and its **effect state**.

```
effective(key, zone) = zone override  ??  platform value saved by the Super Admin  ??  code default (the decided rule)
```

- Nothing is written to the database until the Super Admin saves; until then the code default applies.
- "Reset to default" deletes the saved value, so the default applies again.
- A zone override can only be set for keys marked zone-overridable; removing it falls back to the platform value.
- Every screen shows where the value comes from: **Default**, **Set by Super Admin**, or **Zone override**.

Effect state (shown as a badge so no switch pretends to work):

| State | Meaning |
|---|---|
| Enforced | The backend uses it today |
| Saved, applies when <module> ships | Stored and validated; the workflow that reads it is not built yet |
| Not configured | Value deliberately empty (refund rules, loyalty); the related behaviour stays off |

## 3. Settings registry (initial keys and defaults)

| Key | Default (the decided rule) | Zone override | Effect today |
|---|---|---|---|
| `refunds.limits` | per refund ₹1,000; per day ₹5,000; second approver above ₹10,000 (D95) | Yes | **Enforced as caps in the access editor**: a member's limit cannot be saved above the zone cap (Q1). Refund execution: applies when Refunds ships |
| `refunds.rules` | Not configured (cancellation windows, reasons, cost owner, approvals) | Yes | Not configured |
| `onboarding.documents` | Restaurants required: FSSAI, GST, PAN, bank. Delivery partners: licence, RC, ID, bank (stored, inactive). Home Food: Q4 | No (platform) | Applies when onboarding ships; policy: affects new applications only |
| `support.sla` | first response 2 h, resolution 24 h, escalation 12 h, reopen 7 days, round-robin | Yes | Applies when Support ships |
| `notifications.timing` | order updates: any time; promotional: sent only 09:00–21:00 Asia/Kolkata. Security and legal notices are never held | Yes | Applies when Notifications ships |
| `notifications.channels` | in-app ON, email ON, SMS OFF, WhatsApp OFF | No | SMS / WhatsApp cannot be switched on while the provider is not ready |
| `orders.numberFormat` | `ZO-{ZONE}-{SEQ}` with live preview | No | Applies when Orders ships; policy Q5 |
| `sms.provider` | MSG91; sender ID and DLT template ID empty | No | Credentials stay in server env; the API returns only "configured: yes/no" |
| `loyalty` | earn rate, expiry, redemption value: empty | No | Not configured |
| `security.mfa` | existing (moved into the registry, same key, no data change) | No | Enforced |

Secrets are never settings values. Before/after values of any key marked secret-bearing are redacted in audit and
history.

## 4. Schema plan (one new, additive migration; nothing changes in shipped migrations)

```sql
-- 1. optimistic version on platform settings (existing table; existing row security.mfa gets version 1)
ALTER TABLE settings ADD COLUMN version integer NOT NULL DEFAULT 1;

-- 2. zone overrides
CREATE TABLE zone_settings (
  zone_id     uuid        NOT NULL REFERENCES zones(id),
  key         text        NOT NULL,
  value_json  jsonb       NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  updated_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, key)
);

-- 3. access requests
CREATE TYPE "AccessRequestKind"   AS ENUM ('ZONE', 'PERMISSION');
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TABLE access_requests (
  id              uuid PRIMARY KEY,
  requester_id    uuid NOT NULL REFERENCES users(id),
  kind            "AccessRequestKind" NOT NULL,
  zone_id         uuid NOT NULL REFERENCES zones(id),
  module          text,              -- PERMISSION only; must be grantable
  action          "AccessAction",    -- PERMISSION only
  reason          text NOT NULL,
  status          "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  decision_reason text,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- one open request per requester + zone + permission
CREATE UNIQUE INDEX access_requests_one_pending
  ON access_requests (requester_id, zone_id, kind, coalesce(module, ''), coalesce(action::text, ''))
  WHERE status = 'PENDING';

-- 4. only if Q2 = separate status
-- ALTER TYPE "ZoneStatus" ADD VALUE 'SUSPENDED';
```

Reused, no new tables: Settings History reads the existing append-only `audit_logs` (module `settings`), as the
spec asks ("normal audit architecture"); zone scope uses the existing `user_preferences.last_zone_scope`
(one zone or null = all, which matches the switcher's options); refund usage keeps `refund_daily_usage`.

Target when approved: `zoauro_owner@zoauro` on localhost (zone_services is already applied). The exact SQL
generated by Prisma is shown again before it is applied.

## 5. API plan (extends doc 09; all Super Admin only unless marked)

| Method and path | Permission, re-auth | Purpose |
|---|---|---|
| `GET /settings` | settings:view | Registry: every key with default, platform value, source, effect state, version |
| `GET /settings/{group}?zoneId=` | settings:view | Effective values for a zone, with source per key |
| `POST /settings/{group}/preview` | settings:view | Validate, diff old/new, impact (e.g. members whose limit is above the new cap) |
| `PUT /settings/{group}` | settings:edit, re-auth Q3; body `{values, reason, version}` | Save platform values; transaction + audit + cache clear + `config.changed` for app-read keys |
| `DELETE /settings/{group}/{key}` | settings:edit, re-auth | Reset to default |
| `PUT /zones/{id}/settings/{group}` / `DELETE …/{key}` | settings:edit, re-auth | Zone override / remove override |
| `GET /settings/history` | settings:view | Audit-based history; filters key, group, zone, actor, date; secrets redacted |
| `PUT /zones/{id}/services` | existing; add mandatory `reason` | Reason recorded in audit |
| `GET/POST /me/access-requests`, `POST /me/access-requests/{id}/cancel` | any signed-in Zonal Admin (own only) | Request Access, My Requests |
| `GET /access-requests`, `GET /access-requests/{id}` | access:view | Queue (with pending count for the badge) and detail with effective-access preview |
| `POST /access-requests/{id}/approve` | access:edit + PASSWORD; `{reason, profileId?, version}` | Applies through the same access-editor service and validation; cannot self-approve |
| `POST /access-requests/{id}/reject` | access:edit; `{reason}` | Reject |
| `PUT /me/zone-scope` | session | Save the switcher preference (doc 09 already defines it) |

New audit actions: `settings.updated` (exists), `settings.reset`, `settings.zone_override_set/removed`,
`access.request_created/cancelled/approved/rejected`. Emails (D99 in-app + email): new request → Super Admins;
decision → requester. No secrets, no links that grant access.

## 6. Lanes

Backend lane: migration, settings service and registry, access requests API, `/me/zone-scope`, enforcement hooks,
API and authorization tests (SuperAdmin, Admin(A), Admin(A+B), Admin(none)). Web lane: Platform Settings screens
with the change workflow, Settings History, Request Access / My Requests, Super Admin queue and badge, zone
switcher, dashboard counts, e2e.

## 7. Decisions needed (proposed default in bold)

1. ₹1,000 / ₹5,000 are **zone caps for every Zonal Admin; a member's limit = their own limit, never above the
   cap** (D106's ₹1,00,000 stays the highest value the Super Admin can type).
2. Zone "Suspend": **no new status; Suspend = the existing Deactivate (paused, with reason)**; or add SUSPENDED
   as a separate, temporary state.
3. Re-auth: **password for business settings; password + code for security, SMS provider and refund limits**.
4. Home Food documents: **leave not configured until confirmed** (spec: do not invent).
5. Order number change: **applies only to orders created after saving; existing numbers never change; sequence
   continues per zone; numbers stay unique**.
6. Approving a zone request: **the Super Admin picks the access profile at approval**.
7. Switcher URL: **`?zone=<ZONE CODE>`** (doc 18); the API keeps `?zoneId=`.
8. "Pending invitations" on the dashboard: **accounts created but never signed in** (no email invites, D103).
