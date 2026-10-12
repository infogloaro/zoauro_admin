# 50 — Module Guide M04: Audit and Logs (v1.1)

Everything needed to build, verify and operate the Audit and Logs module: what it does, how it works, data, API, UI, structure, tests, and phase-by-phase Claude Code prompts. Owner Dev 1, reviewer Dev 3 (doc 40). Related: doc 04 (permissions), 08 (schema), 09 (API), 13 (threats), 14 (auth), 15 (retention), 39 (module M04), 45 (integration logs).

> **Status of this guide (v1.1).** Written against pack v2.2. It changes a few lines in other docs (section 17). **A verified reference implementation now exists** in `Zoauro-M04-Audit-Bundle/` (delivered with this pack): the shared catalogue, the write-path service, the database guard migrations, the read-path rules (visibility, mapper, list planning), the coverage guard and 70 automated tests plus 13 performance tests, run against PostgreSQL 16 (section 18). It is **not yet inside your repository**: your repo has only Prompt 0 of doc 49 done, so there is no monorepo, Prisma client, session auth or AuthContext to attach it to. Everything that needs those (Express routes, repository on Prisma, the UI, jobs) is still to build with the prompts in section 15. Prompts AU-1 to AU-4 now start from the bundle instead of generating the code again.

---
## 1. What the module does
**One sentence:** it keeps an unforgeable record of *who did what, to which record, in which zone, when, from where, and what changed*, and lets the right people read it.

| Need | How the module serves it |
|---|---|
| "Who changed this restaurant's commission?" | Activity tab on every record (Super Admin and zone members who can view the record) |
| "What did this member do last week?" | System Logs (Super Admin), filter by actor, date, module |
| Dispute on a refund or payout | The audit row has before/after, actor, zone, note, request id |
| Insider misuse / compromised account (doc 17) | Sensitive-action filter, denied attempts, IP and device of each action |
| Compliance (doc 15) | Reveals of phone/email, document views, exports, access changes are recorded; 3-year retention |
| Proof the access model works (M03) | Every access change writes `access_changes` and an audit row in the same transaction |

### 1.1 In scope
1. The **write path**: a small service every module calls inside its own database transaction (`lib/audit`).
2. The **read path**: Super Admin System Logs, the per-record Activity tab, sign-in history list, CSV export.
3. **Guards**: database-level append-only protection, redaction of secrets and personal data, and a test that fails when a write route forgets to audit.
4. **Retention**: yearly purge after a verified archive (built after pilot, see 14).

### 1.2 Out of scope (and why)
| Not built | Reason |
|---|---|
| Hash-chained / WORM / external tamper-evident log | Overkill at this scale. SEC-6 (append-only, not editable from the app) is met by database privileges plus a trigger. Revisit if an auditor or regulator asks |
| Separate audit microservice or SIEM | Same database, same transaction is simpler and gives exact consistency |
| Auditing every app event (every order step from vendor/partner/customer apps, location pings, stock toggles) | Those already live in `order_status_history` and `integration_inbound_log`; copying them would add roughly 600k rows a month for no new information (D59) |
| Real-time audit feed / alerts | Not needed for v1. Dead-letter and security alerts belong to M21/doc 30 |
| User-editable or deletable logs | Never. There is no write or delete endpoint |
| Application/server logs (stdout, Sentry) | Separate: doc 30. Audit is business history, not debugging output |

### 1.3 Four different "logs" (do not mix them)
| Log | Table | Who writes | Where shown | Owner |
|---|---|---|---|---|
| **Audit log** (this module) | `audit_logs` | services via `lib/audit` | Settings > System Logs, Activity tabs | M04 |
| Access change history | `access_changes` (+ a matching audit row) | M03 | Zone Administration > Access Change History | M03 |
| Sign-in history | `login_history` | M01 | Settings > Security, System Logs > Sign-ins tab | M01 writes, M04 lists |
| Integration event log | `integration_inbound_log`, `webhook_deliveries` | M21 | Settings > Integrations > Event monitor | M21 |
| Order history | `order_status_history` | M11 | Order timeline | M11 |

---
## 2. How it works
### 2.1 Write path (the rule: same transaction, fail closed)
```
HTTP request ──► middleware: requestContext (actor, ip, userAgent, requestId)  [AsyncLocalStorage]
   │
   ▼
route guard (authz) ─► controller ─► service
                                      │ prisma.$transaction(async tx => {
                                      │    const before = await repo.get(tx, id)
                                      │    const after  = await repo.update(tx, id, data)
                                      │    await audit.record(tx, { module, action, entity, before, after, note })
                                      │ })
                                      ▼
                     commit: business change + audit row together, or neither
```
* If the audit insert fails, the business change rolls back (fail closed). An unaudited change must not exist.
* If the business change fails, no audit row is written (rolled back with it).
* A no-op (before equals after after redaction) writes **no** row.
* Reads that matter (reveal phone/email, view/download a document, export) are recorded by the same call before the data is returned; if recording fails, the data is not returned.
* **Actors:** `USER` (Super Admin or Zonal Admin member), `APP_CLIENT` (customer/vendor/partner app backend through the Integration API, for master-data events only), `SYSTEM` (jobs: acceptance timeout, payout run, retention), `WEBHOOK` (payment provider). Jobs run inside `runAsSystem('job-name', fn)`; the Integration API sets the actor from the verified client.
* **Coverage guard:** every mutating route declares `audit: { module, action }` in its route metadata (or `audit: 'none'` with a reason from an allow-list such as `/auth/logout`). A middleware flags any mutating route that finished with 2xx and no audit row: it throws in test and logs an error in production. The authorization harness (F1.6) also runs this check over the OpenAPI list.

### 2.2 Read path and visibility
| Reader | What they can read | Fields hidden |
|---|---|---|
| **Super Admin** | All rows, free search, filters, export | none |
| **Zonal Admin member** | Only the **Activity tab of a record** (needs `entityType` + `entityId`). Row visible only if the member holds `<row.module>:view` in `row.zone_id` (via `can()`); rows with no zone, or module in {access, settings, integrations, zones, audit, admins, auth, system}, are never visible | `ip`, `userAgent`, `requestId`, `sessionId` |
| App clients | nothing | — |
Free listing (`GET /audit-logs` without an entity) as a Zonal Admin: **403**. Entity in an unassigned zone, or module not viewable: **404** (same rule as the rest of the pack, doc 14 §4). Implementation rule: in entity mode a Zonal viewer whose **first page** has no visible rows gets 404 (every real entity has at least a creation row, so an empty first page means "not yours or not there"); a later empty page is a normal end of list.

### 2.3 What gets an audit row (rule of thumb)
Admin and system **decisions and changes** to master data, configuration, access and money; plus sensitive reads. Not: list views, searches, dashboard loads, app event streams (D59). Full catalogue in section 4.

---
## 3. Data model
### 3.1 `audit_logs` (replaces the single-line definition in doc 08)
| Column | Type | Notes |
|---|---|---|
| id | uuid v7 | primary key; time-ordered, so it is also the pagination cursor |
| created_at | timestamptz | default now() |
| actor_type | enum `USER, APP_CLIENT, SYSTEM, WEBHOOK` | |
| actor_id | uuid null | `users.id` or `api_clients.id`; null for SYSTEM |
| actor_name | text | snapshot ("Karthik M", "Vendor app", "System: payout-run") so history survives renames and soft deletes |
| actor_role | text null | `SUPER_ADMIN` / `ZONAL_ADMIN` snapshot |
| zone_id | uuid null | zone of the **entity**; null for global things (settings, zones list, access) |
| module | text | permission module key (doc 04) |
| action | text | `entity.verb`, past tense, from the catalogue |
| entity_type | text | `restaurant`, `order`, `user`, … |
| entity_id | uuid null | |
| entity_label | text null | snapshot for display ("ZO-100245", "Annapoorna Mess") |
| outcome | enum `SUCCESS, DENIED` | DENIED only for the short list in 4.3 |
| sensitivity | enum `NORMAL, HIGH` | HIGH: reveal, export, document view, access, settings, money approvals, client/secret changes |
| before_json, after_json | jsonb null | **changed fields only**, redacted (section 5) |
| note | text null | reason typed by the actor (cancel reason, rejection note) |
| ip | inet null | |
| user_agent | text null | truncated to 300 chars |
| request_id | text null | correlates with application logs |
`access_changes` keeps its own columns (doc 08). Append-only for both.

```prisma
model AuditLog {
  id           String   @id @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  actorType    AuditActorType @map("actor_type")
  actorId      String?  @map("actor_id") @db.Uuid
  actorName    String   @map("actor_name")
  actorRole    String?  @map("actor_role")
  zoneId       String?  @map("zone_id") @db.Uuid
  module       String
  action       String
  entityType   String   @map("entity_type")
  entityId     String?  @map("entity_id") @db.Uuid
  entityLabel  String?  @map("entity_label")
  outcome      AuditOutcome @default(SUCCESS)
  sensitivity  AuditSensitivity @default(NORMAL)
  beforeJson   Json?    @map("before_json")
  afterJson    Json?    @map("after_json")
  note         String?
  ip           String?  @db.Inet
  userAgent    String?  @map("user_agent")
  requestId    String?  @map("request_id")

  @@index([zoneId, id(sort: Desc)])
  @@index([zoneId, module, id(sort: Desc)])
  @@index([entityType, entityId, id(sort: Desc)])
  @@index([actorId, id(sort: Desc)])
  @@index([module, action, id(sort: Desc)])
  @@index([sensitivity, id(sort: Desc)])
  @@map("audit_logs")
}
```
No foreign keys to `users`/`zones` (history must outlive them; snapshots carry the names).
**Indexes (changed in v1.1 after the 2,000,000-row test, section 18):** the five above plus `(zone_id, module, id DESC)`; without it a zone + module + action filter with few or no matches took about 450 ms at p95 (the planner walked the module/action index and filtered by zone). Two expression indexes for the `q` search, `lower(entity_label) text_pattern_ops` and `lower(actor_name) text_pattern_ops`, cannot be written in `schema.prisma`, so they live in a second raw-SQL migration (`20261010000100_audit_search_indexes`); without them a `q` with no match scanned the whole table (1.8 s at 2M rows, 1 ms with them). Date filters (`from`/`to`) must be sent to PostgreSQL as an id range **and** a `created_at` range: `id >= lower AND id <= upper AND created_at BETWEEN from AND to`, with `lower`/`upper` from `uuidv7Bounds()`; `created_at` alone has no index and a window two years back took 650 ms, with the id range 2 ms. Reference model and migrations: bundle `apps/api/prisma/`.

### 3.2 Database guard (migration written as raw SQL; test it, do not trust it)
```sql
-- run as the migration/owner role. Three roles (v1.1):
--   zoauro_owner  runs migrations only, never in the app's environment
--   zoauro_app    API and worker: SELECT + INSERT only
--   zoauro_purge  retention job only: SELECT + DELETE (the trigger still allows deletes only with the flag and for rows older than 3 years)
REVOKE ALL ON audit_logs, access_changes FROM zoauro_app, zoauro_purge, PUBLIC;
GRANT SELECT, INSERT ON audit_logs, access_changes TO zoauro_app;
GRANT SELECT, DELETE ON audit_logs, access_changes TO zoauro_purge;

CREATE OR REPLACE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit rows are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('zoauro.audit_purge', true) = 'on'
       AND OLD.created_at < now() - interval '3 years' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit rows cannot be deleted';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_guard BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();
-- repeat both triggers for access_changes (same function; its purge rule is the same 3 years)
```
**Checked (v1.1):** the real migration file (bundle `20261010000000_audit_guard/migration.sql`) was applied to PostgreSQL 16 and exercised by `guard.test.ts`, 18 tests on both tables: the app role can INSERT and SELECT but gets *permission denied* on UPDATE, DELETE, TRUNCATE, `ALTER TABLE … DISABLE TRIGGER` and `DROP TRIGGER`; the table owner is stopped by the trigger; the purge role cannot delete without the flag, cannot delete a 1-year-old row even with the flag, deletes a 4-year-old row with the flag, and the flag does not outlive its transaction. Mutation checks confirmed the tests fail when a trigger is removed, UPDATE is granted, or the 3-year rule is dropped. Limit: a database owner or superuser can still drop the trigger, which is why migration credentials never go into the application's environment. Re-prove it in your own stack with TC-AUD-7/8.
**Correction found while building:** v1 of this guide revoked DELETE from `zoauro_app` and then expected the retention job, which runs inside the API's worker, to delete. It could not. The job therefore connects with its own `zoauro_purge` role (new env var `DATABASE_URL_AUDIT_PURGE`, only in the worker's environment, doc 12).

The purge job is the only code that sets `zoauro.audit_purge` (`SET LOCAL` inside its own transaction) and the trigger still refuses rows younger than 3 years. In local Docker all three roles must exist (bundle `docker/initdb/01-roles.sql`), otherwise the REVOKE protects nothing; the migration fails with a readable message if a role is missing.

### 3.3 Volume (estimate, to be replaced with real numbers after the pilot)
~100k orders a month, perhaps 10% need an admin action, plus master-data edits, logins, reveals: about 20–40k rows a month, under 2 million rows in 3 years. One table with the indexes above is enough; no partitioning until ~20 million rows (doc 06 already says "only if load requires").

---
## 4. Action catalogue
Defined once in `packages/shared/src/audit/actions.ts` as `AUDIT_ACTIONS: Record<string, { module, label, sensitivity }>`. The UI renders `label`; filters list the keys. Adding a module action means adding it here first (same rule as permission keys).

| Module | Actions (HIGH marked *) |
|---|---|
| auth | `user.two_factor_enrolled`, `user.two_factor_disabled`*, `user.two_factor_reset`*, `user.backup_codes_generated`*, `user.backup_code_used`*, `user.mfa_challenge_failed` (DENIED, rate limited), `user.password_changed`, `user.password_reset_requested`, `user.locked`, `user.unlocked`, `session.revoked`, `reauth.failed`*, `sms.paused`*, `sms.resumed`* (doc 52 §4) |
| zones | `zone.created`, `zone.updated`, `zone.deactivated`*, `zone.activated`, `zone.delivery_charge_changed`*, `zone.pincodes_changed`*, `zone.deleted` (doc 53 §4) |
| admins / access | `member.created`, `member.updated`, `member.suspended`, `member.reactivated`, `member.password_reset`*, `access.profile_set`*, `access.override_set`*, `access.limit_set`*, `access.zone_added`*, `access.zone_removed`*, `access_profile.created/updated/deleted`* |
| restaurants, homemakers | `restaurant.created/updated/deleted`, `restaurant.verified`*, `restaurant.rejected`*, `restaurant.activated/deactivated/suspended`*, `restaurant.commission_changed`*, `restaurant.zone_moved`*, `restaurant.document_added`, `restaurant.document_viewed`* (and `homemaker.*`) |
| menu | `menu_item.created/updated/deleted`, `menu_item.admin_disabled`, `menu_item.bulk_updated` |
| customers | `customer.created`, `customer.updated`, `customer.blocked`*, `customer.unblocked`*, `customer.contact_revealed`* |
| delivery | `partner.created/updated`, `partner.verified/rejected`*, `partner.suspended`*, `partner.force_offline`*, `partner.document_viewed`* |
| orders | `order.cancelled_by_admin`, `order.accepted_on_behalf`, `order.partner_assigned`, `order.partner_reassigned`, `order.marked_delayed`, `order.exported`* |
| payments, refunds, settlements, payouts | `refund.requested`, `refund.approved`*, `refund.rejected`*, `refund.processed`, `refund.failed`, `cod_settlement.confirmed`*, `payout.generated`, `payout.marked_paid`*, `reconciliation.mismatch_ack`* |
| settings | `settings.updated`* (carries the setting key in `entity_label`), `settings.2fa_policy_changed`* |
| integrations | `integration_client.created/rotated/disabled/enabled`*, `webhook.created/updated/paused`*, `delivery.retried`, `registration.zone_assigned` |
| notifications | `broadcast.created`* |
| audit | `audit.exported`* |
| system | `job.order_auto_cancelled`, `job.payment_expired`, `job.payout_run` (actor SYSTEM) |

### 4.0 Zone rule for `entity.zoneId` (enforced by `record()`)
* **Must be a uuid:** `restaurant, homemaker, menu_item, partner, order, refund, cod_settlement`.
* **Must be passed explicitly (uuid, or `null` if truly global):** `customer, payout, payment`. A customer has no single zone, so pass the zone in which the action happened (for a reveal: the zone the member was working in; for Super Admin edits: the zone of the customer's latest order or address, else `null`). Rows with `null` are invisible to Zonal members (D63).
* Anything else (zones, access, settings, integrations, system): any value, normally `null`.

### 4.1 Naming rules
`entity.verb`, lower snake case, past tense, no sentences. One action per business event, not per column. Bulk operations write **one** row with a summary (`count`, ids list capped at 100 in `after_json`).

### 4.2 Sensitivity
HIGH rows are indexed for the "sensitive only" filter and are what a Super Admin reviews first.

### 4.3 Denied attempts (`outcome=DENIED`), kept deliberately short
1. A Zonal Admin calling any access, integrations or settings endpoint (403).
2. A write carrying a zone id outside the member's assignment (404 ZONE_NOT_FOUND).
3. Failed re-authentication on a high-risk action.
4. Reveal or export attempted without permission.
Rate limit: at most one DENIED row per (actor, action) per minute, so scanning cannot flood the table. Super Admin opening System Logs is **not** audited per view (noise); only exports are.

---
## 5. Diff and redaction rules (`lib/audit/diff.ts`, `redact.ts`)
1. `diff(before, after)` returns only changed keys (deep for nested objects, arrays compared as whole values). Create: `before=null`, `after=` all non-null fields. Delete (soft): `before` snapshot, `after=null` or `{deleted_at}`.
2. **Never stored (value replaced by the marker `[redacted]`; the key stays so the history shows *that* it changed, never what it changed to):** `password`, `passwordHash`, `token*`, `secret*`, `secretEncrypted`, `totp*`, `otp*`, `apiKey`, `cardNumber`, `cvv`, `upi*Pin`, `sessionToken`, `authorization`, `signature`; plus names ending in `secret`, `token`, `password`, `apiKey` (clientSecret, refreshToken …). Safe look-alikes are on an explicit allow-list (`cardLast4`, `twoFactorEnabled`, `mustChangePassword`, …).
3. **Masked** (store `98****1234` style, last 4 kept): `phone`, `email` (first letter + domain), bank account numbers, GST/PAN/FSSAI numbers, Aadhaar.
4. **Truncated:** any string over 2,000 characters; arrays over 100 items summarised as `{count, first100Ids}`.
5. Unknown keys pass through; the policy lives in one registry (`registry.ts`) listing field name → `drop | mask | keep`, extended when a new sensitive column is added. A unit test walks the Prisma schema and fails if a column named like a secret is not covered.
6. Order matters: **diff the raw values first, then redact the result.** If values were masked first, a phone number whose middle digits changed would look unchanged (`98****1234` both times) and the change would be lost as a "no-op". Redaction still happens before the row is built, so even a database leak of the audit table exposes no secrets.

---
## 6. Module structure
```
packages/shared/src/audit/
  actions.ts            AUDIT_ACTIONS catalogue + types
  schemas.ts            Zod: list query, list item, detail, export request
apps/api/src/lib/audit/               (write path, imported by every module)
  context.ts            AsyncLocalStorage: actor, ip, userAgent, requestId, rowsWritten, noops; runAsSystem()
  audit.service.ts      record(tx, entry), recordMany, createAudit(deps).recordDenied
  diff.ts               changed-fields diff (diff raw, then redact)
  redact.ts + registry.ts + schema-walker.ts   field policy and the schema test
  id.ts                 uuidv7 (monotonic), createUuidV7(clock), uuidv7Bounds(from, to)
  rate-limit.ts         DeniedRateLimiter: in-memory (tests) and Redis SET NX EX (production)
  coverage.ts           evaluateCoverage, checkOpenApiAuditMetadata, AUDIT_NONE_REASONS
  middleware.ts         auditContextMiddleware, auditMeta, auditCoverage (Express)
  errors.ts shared.ts index.ts
apps/api/src/modules/audit/           (read path)
  routes.ts  controller.ts  service.ts  repository.ts  permissions.ts  events.ts  index.ts
  visibility.ts         canSeeRow, zonalPredicate, planAuditList, entityModeNotFound
  mapper.ts             row → DTO (omits ip/userAgent/requestId for Zonal, builds changes[])
  exports.processor.ts  CSV export job (P1)
  retention.processor.ts  archive + purge jobs (post-pilot)
apps/api/prisma/migrations/<ts>_audit_guard/migration.sql
apps/api/tests/audit/*.test.ts
apps/web/features/audit/
  SystemLogsPage.tsx  AuditFilters.tsx  AuditTable.tsx  AuditDetailDrawer.tsx
  DiffView.tsx  ActivityTab.tsx  ExportDialog.tsx  useAuditLogs.ts
apps/web/app/(super)/super-admin/settings/logs/page.tsx
```
Layering follows doc 06/07: the **repository** is the only place that queries `audit_logs` for reading; `lib/audit` is the only place that inserts.

---
## 7. Service interface (inside the API)
```ts
// lib/audit/audit.service.ts
type AuditEntry = {
  module: ModuleKey;
  action: AuditActionKey;                    // must exist in AUDIT_ACTIONS
  entity: { type: string; id?: string; label?: string; zoneId?: string | null };
  before?: unknown;                          // full or partial object, redacted and diffed inside
  after?: unknown;
  note?: string;
};
export const audit = {
  record(tx: Prisma.TransactionClient, e: AuditEntry): Promise<void>,   // reads actor/ip/ua/requestId from context
  recordMany(tx, entries: AuditEntry[]): Promise<void>,
  recordDenied(e: Omit<AuditEntry,'before'|'after'>): Promise<void>,    // own short transaction, rate limited
};
export function runAsSystem<T>(jobName: string, fn: () => Promise<T>): Promise<T>;

// usage in any service
await prisma.$transaction(async (tx) => {
  const before = await repo.findById(tx, ctx, id);
  const after  = await repo.update(tx, ctx, id, input);
  await audit.record(tx, {
    module: 'restaurants', action: 'restaurant.commission_changed',
    entity: { type: 'restaurant', id, label: after.name, zoneId: after.zoneId },
    before: { commissionPct: before.commissionPct }, after: { commissionPct: after.commissionPct },
  });
});
```
Rules: `tx` is mandatory (no overload without it); `record` throws if the action key is unknown, if the actor is missing outside `runAsSystem`, or if the entity has a zone-owned type and `zoneId` is undefined (explicit `null` only for global entities).

---
## 8. REST API (additions to doc 09)
Base `/api/v1`. All responses use the standard envelope and error codes.
| Method | Path | Permission | Behaviour |
|---|---|---|---|
| GET | `/audit-logs` | `audit:view` (Super Admin) **or** entity mode | Cursor list, newest first. Query: `limit` (≤100, default 50), `after` (id), `from`, `to` (ISO), `actorId`, `actorType`, `module`, `action`, `entityType`, `entityId`, `zoneId` (repeatable), `outcome`, `sensitivity`, `q` (matches `entity_label` and `actor_name`, case-insensitive prefix). **Entity mode** (`entityType` + `entityId` both present): allowed for a Zonal Admin who can view that module in that zone; other filters except `limit`, `after`, `from`, `to` are ignored for them. Zonal request without entity mode → 403 |
| GET | `/audit-logs/{id}` | as above | Detail with `changes[]`. Not visible → 404 |
| GET | `/audit-logs/catalogue` | `audit:view` | modules and action keys with labels, for the filter UI |
| POST | `/audit-logs/exports` | `audit:export` (Super Admin) + re-auth | Body = same filters + `format: "csv"`. Row cap 100,000; returns `202 { exportId }` |
| GET | `/exports/{id}` | requester | status and a 24-hour signed URL (existing exports table) |
| GET | `/login-history` | `audit:view` | Super Admin: all users; filters `userId`, `success`, `from`, `to`, cursor |
| GET | `/me/login-history` | session | own last 50 sign-ins |
There is **no** POST/PUT/PATCH/DELETE on audit rows.
Implementation notes: `from`/`to` become `id` bounds plus `created_at` bounds (section 3.1); `q` becomes `lower(entity_label) LIKE lower(q)||'%' OR lower(actor_name) LIKE lower(q)||'%'` (escape `%` and `_` in the input); Zonal entity mode adds the `zonalPredicate` as `(module = m AND zone_id = ANY(zones)) OR …` next to the entity filter and returns 404 on an empty first page.

**List item**
```json
{
  "id": "0192f1d2-…", "createdAt": "2026-10-10T07:25:03Z",
  "actor": { "type": "USER", "id": "…", "name": "Karthik M", "role": "ZONAL_ADMIN" },
  "zone": { "id": "…", "name": "Coimbatore" },
  "module": "restaurants", "action": "restaurant.commission_changed", "actionLabel": "Changed commission",
  "entity": { "type": "restaurant", "id": "…", "label": "Annapoorna Mess" },
  "outcome": "SUCCESS", "sensitivity": "HIGH", "note": null,
  "changedFields": ["commissionPct"],
  "ip": "203.0.113.5", "userAgent": "Chrome 129 / Windows", "requestId": "…"
}
```
Detail adds `changes: [{ "field": "commissionPct", "before": 15, "after": 18 }]`. For Zonal Admins `ip`, `userAgent`, `requestId` are absent.
Errors: 401 unauthenticated; 403 forbidden (free listing by Zonal, missing `audit:export`); 404 not visible; 422 bad filter; 429 export rate limit (3 per hour per user).

Permissions (doc 04): `audit:view` and `audit:export` are **not grantable** to Zonal Admin; their entity Activity access is derived from the entity module's view permission.

---
## 9. UI specification (no Figma frames, D47: build from this, designer reviews at the sprint demo)
### 9.1 Settings > System Logs (`/super-admin/settings/logs`, Super Admin)
* Tabs: **Activity** (audit_logs) · **Sign-ins** (login_history) · link "Access change history" (goes to M03 screen) · link "Integration events" (goes to M21).
* Filter bar: date range (default last 7 days), actor (typeahead), actor type, module, action (grouped by module), zone, entity type, search box (entity label/actor name), outcome, "Sensitive only" toggle, Reset. Filters live in the URL.
* Table columns: Time (local, tooltip UTC), Actor (avatar initials + name + role chip, app/system chip), Action (label + module chip), Entity (label, link to the record if still visible), Zone chip, flags (HIGH badge, Denied badge). Row click opens the drawer. "Load more" using the cursor; row count not shown (cursor pagination has no total).
* Drawer: header (action label, time), actor block (name, role, IP, device), entity block (link), note, **DiffView** table (Field / Before / After; masked values shown as is), request id with copy button, "More from this actor" and "More for this record" shortcuts.
* Export button (opens ExportDialog: shows the current filters, row estimate cap, re-auth prompt, then toast "Export is being prepared"; link appears in the notification bell).
* States: loading skeleton rows, empty ("No activity matches these filters" + Reset), error with retry, partial-results never.
### 9.2 Activity tab on records
Reusable `<ActivityTab entityType entityId />` mounted on restaurant, homemaker, partner, customer, order, zone (SA), member (SA), refund detail pages (doc 21 item 10). Shows a compact vertical timeline (actor, label, time, field changes inline for the latest 3 changes, "View details" opens the same drawer without ip/device for Zonal). Same permission rule as 8; hidden when the member cannot view.
### 9.3 Accessibility and format
Keyboard navigable table and drawer, focus return on close, times in the configured timezone (Asia/Kolkata default), Indian number format in diffs for money fields (paise → ₹).

---
## 10. Security and privacy
| Risk | Control |
|---|---|
| T27 Tampering or deletion of audit rows (insider with DB or API access) | App DB role has INSERT/SELECT only; trigger blocks UPDATE/DELETE/TRUNCATE; no API verbs; purge only through the retention job after 3 years; migration role credentials kept out of the app |
| T28 Secrets or personal data leaking into audit JSON | Redaction before insert (section 5), registry test against the Prisma schema, masked phone/email, no request bodies stored |
| T29 Log flooding / storage abuse | Denied rows rate-limited; bulk actions write one row; export capped (100k rows, 3 per hour); app event streams excluded (D59) |
| Zonal Admin reading beyond their access | Visibility is evaluated with `can()` on the row's module and zone; free listing denied; ip/device hidden; tests TC-AUD-9…13 |
| Log injection (newlines/markup in names or notes) | Values stored as data (jsonb/text), escaped by React; CSV export prefixes `=`, `+`, `-`, `@` cells with `'` |
| Time manipulation | `created_at` set by the database, never by the client; ids are time-ordered UUID v7 generated server-side |
| Reveal/export without trace | Fail closed: no audit row, no data |
Privacy (doc 15): audit rows contain IP and user agent of staff (personal data of admins): visible only to Super Admin; retention 3 years; erased by the same purge. Customer personal data appears only masked.

## 11. Retention and archive (post-pilot build, AU-5)
Changes doc 15 §4 ("hot 12 months, then archive") to **D60**: keep all 3 years in the one table (volume is small, section 3.3), take a **monthly archive** to S3 for safety, delete only after 3 years.
1. Monthly job (day 2, 02:00 IST): export last month's rows to `s3://<backup bucket>/audit/YYYY-MM.jsonl.gz` (SSE, private), with object metadata `row-count` and `sha256`; log result; alert on failure.
2. Daily purge job: for each month older than 3 years whose archive object exists and whose metadata row-count equals the database count, delete those rows inside a transaction with `SET LOCAL zoauro.audit_purge='on'`. No archive or mismatch → skip and alert.
3. `login_history`: purge rows older than 12 months nightly (doc 15). Same job file, different rule.
4. Nothing is 3 years old until late 2029; building this after the pilot is safe, but it is on the launch-plus-90-days checklist (doc 31) so it is not forgotten.

## 12. Test plan (module tests; run on every PR)
| ID | Case | Expected |
|---|---|---|
| TC-AUD-1 | Successful write through a service | One audit row in the same transaction with actor, zone, module, action, entity, changed fields |
| TC-AUD-2 | Business step throws after the audit call | Neither the change nor the audit row exists |
| TC-AUD-3 | Audit insert throws (simulated) | Business change rolled back, request fails with 500 |
| TC-AUD-4 | Update with identical values | No audit row |
| TC-AUD-5 | Diff stores only changed fields; create stores `before=null`; soft delete stores snapshot | Matches rules in 5 |
| TC-AUD-6 | Redaction: password, tokens, secrets dropped; phone/email/bank masked; long text truncated; schema walker finds no uncovered secret-like column | Pass |
| TC-AUD-7 | As `zoauro_app`: UPDATE, DELETE, TRUNCATE on `audit_logs` and `access_changes` | All fail |
| TC-AUD-8 | Purge function: row older than 3 years with flag + archive verified deletes; younger row or no flag refuses | Pass |
| TC-AUD-9 | Zonal member: `GET /audit-logs` without entity | 403 |
| TC-AUD-10 | Zonal member: entity Activity for a restaurant in their zone with `restaurants:view` | 200, only that entity's rows, no ip/userAgent/requestId |
| TC-AUD-11 | Same member, restaurant in unassigned zone | 404, no rows |
| TC-AUD-12 | Member with `restaurants:view` denied by override in zone A | Activity for A restaurants returns 404 |
| TC-AUD-13 | Rows with module access/settings/integrations/zones, or zone null, for a Zonal member | Never returned, even by entity id |
| TC-AUD-14 | Super Admin filters: actor, actor type, module, action, entity, zone, date range, outcome, sensitive-only, `q` | Correct subsets; combined filters AND |
| TC-AUD-15 | Cursor pagination while rows are inserted concurrently | No duplicates, no gaps, strictly descending ids |
| TC-AUD-16 | App-client master-data event (vendor registration) | Row with `actor_type=APP_CLIENT`, name "Vendor app" |
| TC-AUD-17 | Reveal contact | Audit row `customer.contact_revealed` written first; if audit fails no data returned |
| TC-AUD-18 | Export: without `audit:export` 403; without re-auth 401; with both a CSV appears; export itself audited; formula-leading cells escaped; >100k rows rejected | Pass |
| TC-AUD-19 | Coverage guard: a new mutating route with no audit metadata | Test fails; allow-listed `audit:'none'` routes pass |
| TC-AUD-20 | DENIED rows: Zonal calls `/access-profiles`; 6 attempts in one minute | 1 row (rate limited), outcome DENIED |
| TC-AUD-21 | Member renamed and later soft-deleted | Old rows still show the original `actor_name` |
| TC-AUD-22 | Access change (M03 test) | `access_changes` row and `audit_logs` row share a transaction and `request_id` |
| TC-AUD-23 | Sign-in list: failed + successful attempts appear; Zonal cannot call `/login-history`; `/me/login-history` returns only own | Pass |
| TC-AUD-24 | Performance with 2M seeded rows: filtered list p95 < 300 ms, entity activity p95 < 100 ms | Pass, with `EXPLAIN` showing index use |
| TC-AUD-25 | (added v1.1) Date window two years back, `q` with no match, zone + module + action with no match | each p95 < 300 ms |
| TC-AUD-26 | (added v1.1) Changing only the middle digits of a phone number | A row is written (diff before redaction), values masked |
| TC-AUD-27 | (added v1.1) A route that changed nothing (identical values) returns 2xx | Coverage guard does not flag it (counted as an audited no-op) |
| TC-AUD-28 | (added v1.1) Purge role: no flag, flag + young row, flag + old row | refused, refused, deleted; flag does not survive its transaction |

## 13. Acceptance criteria and Definition of Done
* **Given** any admin write in any module, **when** it succeeds, **then** exactly one audit row exists with actor, zone, module, action, entity, changed fields and request id; **when** it fails, none exists.
* **Given** a Zonal Admin on a restaurant page in their zone, **when** they open Activity, **then** they see only that restaurant's history and no IP or device.
* **Given** Super Admin opens System Logs, **when** they filter by actor and date, **then** results appear in under 2 seconds with a diff for each change.
* **Given** anyone with database access as the application role, **when** they try to change or delete an audit row, **then** the database refuses.
* **Module done when:** TC-AUD-1…24 pass in CI (TC-AUD-8 and 24 may run in a nightly job), coverage guard active for all existing routes, doc 08/09/04/13/15/24/25 amendments merged, handoff block written, independent verification (Phase 10) completed with no open High findings.

## 14. Effort and phasing
| Phase | Tasks | Size (dev-weeks) | Priority | Sprint (doc 40) |
|---|---|---|---|---|
| AU-1 | Schema, enums, guard migration, roles | 0.3 | P0 | S0–S1 (with F1.1) |
| AU-2 | `lib/audit` service, context, diff, redaction, catalogue | 0.6 | P0 | S2 |
| AU-3 | Middleware wiring, coverage guard, harness check | 0.4 | P0 | S2 |
| AU-4 | Read API (list, detail, catalogue, login history), visibility rules | 0.5 | P0 | S4 |
| AU-6 | System Logs UI + diff drawer | 0.8 | P1 | S7 |
| AU-7 | `ActivityTab` component | 0.3 | P0 | with each vendor/order detail page (S3–S5) |
| AU-8 | CSV export | 0.3 | P1 | after pilot |
| AU-5 | Archive and purge jobs | 0.3 | P1 | before launch + 90 days |
| AU-9 | Tests TC-AUD-1…24, verification | 0.5 | P0 | spread across the above |
Total ≈ **3.3 dev-weeks**; the earlier plan allowed ≈ 1.4 (F1.4 audit part + SA-1.5 + SA-7.4). The extra ≈ 1.9 buys the DB guard, redaction, coverage test and Activity tab; export and archive (0.6) can wait until after the pilot, leaving ≈ 2.7 for launch. This may add up to a week of load on Dev 1 around S2–S4; watch it at the end of S2 (doc 40 note). Phases AU-6 and AU-8 can move to Dev 2 if Dev 1 is full.

---
## 15. Build procedure A to Z (what to do, in order)
### Phase 0 — Prerequisites (do these first; nothing here is built yet)
Your repository currently has the orientation step only (doc 49 Prompt 0). The audit module needs these to exist and pass `pnpm lint && pnpm typecheck && pnpm test`:
| Needed | From | Doc 49 prompt |
|---|---|---|
| Monorepo scaffold | F0.3 | Prompt 1 |
| Local Postgres/Redis/MinIO + env validation | F0.4 | Prompt 2 |
| Prisma base schema (including `audit_logs` as redefined in section 3) | F1.1 | Prompt 3 |
| Session auth (actor identity) | F1.2 | Prompt 5 |
| AuthContext and scope-aware repositories (`can`, `zonesFor`) | F1.3 | Prompt 6 |
Run Prompts 1, 2, 3, 5, 6 first. In Prompt 7 (F1.4) **skip the audit service** (this module replaces it). Before Prompt 3, apply the amendments of section 17 to the docs in the repository so the schema picks up the new `audit_logs` definition.

### Phase 0.5 — Apply doc amendments (prompt)
```
Read docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md section 17 only.
Apply each listed amendment to the named documents exactly as written. Do not change anything else. Show me a summary of each file changed (before/after of the edited lines) and commit as "docs: apply M04 audit amendments".
```

### Phase 0.6 — Adopt the verified bundle (new in v1.1; after Prompts 1, 3, 5, 6 exist)
```
Copy Zoauro-M04-Audit-Bundle/ to a temporary folder outside the repo (do not commit it). Read its README.md and docs/handoff block first.
Then adopt it into the repository without rewriting it:
1. packages/shared/src/audit/* -> packages/shared/src/audit/ ; export it from the package index; point apps/api/src/lib/audit/shared.ts at the real package name.
2. apps/api/src/lib/audit/* -> apps/api/src/lib/audit/ (keep file names).
3. apps/api/src/modules/audit/{visibility,mapper,index}.ts -> same path. Do not add routes yet.
4. apps/api/prisma/audit.model.prisma: paste the enums and model into prisma/schema.prisma (Dev 1 only); create the two raw-SQL migrations exactly as in the bundle (names and order), after the migration that creates audit_logs and access_changes.
5. docker/initdb/01-roles.sql: merge into the repo's database init so zoauro_owner, zoauro_app, zoauro_purge exist; make API and worker connect as zoauro_app, migrations as zoauro_owner.
6. apps/api/tests/audit/* -> same path. Replace support/db.ts only where the repo already has a test database helper; keep the assertions. Adapt imports, nothing else.
Run: pnpm lint && pnpm typecheck && pnpm test. Report every test that fails and why; do not change an assertion to make it pass.
```
The bundle was verified against a stand-in business table and a hand-written DDL, so the first run in the real repo is itself a check: differences (column names, Prisma JSON null handling, lint rules such as `no-restricted-paths`) show up as failures to resolve, not as silent changes.

### Common header for every prompt below (paste first)
```
Constraints: follow AGENTS.md. Do not change the stack. Do not invent endpoints, fields, enum values or permission keys: if docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md does not define them, stop and ask. One concern per commit. Keep changes under 400 lines unless the task says otherwise. Never print secrets. Finish with: pnpm lint && pnpm typecheck && pnpm test, then append a handoff block to docs/handoff.md.
```

### Phase 1 — AU-1: schema and database guard (Dev 1, lane D)
```
Task AU-1. Start from the bundle (Phase 0.6). Load only: docs/F-execution/50_* sections 3 and 5, docs/B-architecture/08_* (audit_logs, access_changes), docs/C-security/13_* (SEC-6).
Add the AuditLog Prisma model, enums AuditActorType, AuditOutcome, AuditSensitivity, and the six indexes of section 3.1 (bundle apps/api/prisma/audit.model.prisma). Add the two raw-SQL migrations of the bundle (guard, then search indexes). Create roles zoauro_owner, zoauro_app and zoauro_purge in the docker init script; API and worker connect as zoauro_app, migrations as zoauro_owner, the retention job (later) as zoauro_purge via DATABASE_URL_AUDIT_PURGE.
Write tests (tests/audit/guard.test.ts) for TC-AUD-7 and TC-AUD-8 using two connections (app role, owner role).
Done when: as zoauro_app, UPDATE/DELETE/TRUNCATE on audit_logs and access_changes fail; inserts and selects work; purge function test passes.
```

### Phase 2 — AU-2: write-path service (Dev 1, lane A)
```
Task AU-2. Load only: docs/F-execution/50_* sections 2.1, 4, 5, 6, 7; docs/A-product/04_* (module keys); AGENTS.md.
Start from the bundle files (Phase 0.6); verify, do not regenerate. The catalogue is packages/shared/src/audit/actions.ts (section 4). Create apps/api/src/lib/audit/{context,audit.service,diff,redact,registry,index}.ts as in section 6/7: AsyncLocalStorage context, record(tx, entry), recordMany, recordDenied (rate limited 1/min per actor+action, own transaction), runAsSystem. record() must throw on unknown action, missing actor, or undefined zoneId for a zone-owned entity type.
Redaction registry per section 5 plus a test that walks prisma/schema.prisma and fails for any secret-like column name not covered.
Tests: TC-AUD-1 to TC-AUD-6, TC-AUD-20, TC-AUD-21 (unit/integration with the test database).
Do not touch other modules yet.
```

### Phase 3 — AU-3: wiring and coverage guard (Dev 1, lane A)
```
Task AU-3. Load only: docs/F-execution/50_* section 2.1; docs/B-architecture/09_* conventions; AGENTS.md.
1) Add request-context middleware (actor from the session/AuthContext, ip, user agent, requestId) before routes; for the Integration API set actor type APP_CLIENT from the verified client (stub if IH-1 not built).
2) Add route metadata support: every mutating route must declare audit: { module, action } or audit: 'none' with a reason from a small allow-list in one file (logout, token refresh, health).
3) Add the coverage middleware (lib/audit/coverage.ts): after a mutating 2xx response, if no audit row was recorded in this request and the route is not allow-listed, throw in NODE_ENV=test and log an error otherwise.
4) Extend the authorization harness (F1.6) with a check that lists every mutating route from the OpenAPI file and fails if audit metadata is missing.
5) Retrofit the routes that already exist (auth: password change/reset, session revoke; anything from F1.x) with audit calls.
Tests: TC-AUD-19, TC-AUD-22 (with a stub for M03), TC-AUD-17 (using a stub reveal endpoint behind the test flag).
```

### Phase 4 — AU-4: read API (Dev 1, lane A)
```
Task AU-4. Load only: docs/F-execution/50_* sections 2.2, 8; docs/C-security/14_* section 4; docs/F-execution/36_* section 5.
Start from bundle modules/audit/{visibility,mapper}.ts (Phase 0.6). Implement the remaining modules/audit files (routes, controller, service, repository, permissions) using them: GET /audit-logs (Super Admin free mode, Zonal entity mode), GET /audit-logs/{id}, GET /audit-logs/catalogue, GET /login-history, GET /me/login-history. Visibility is evaluated per row with can(ctx, `${row.module}:view`, row.zone_id); excluded modules and null-zone rows are never returned to Zonal Admins; ip/userAgent/requestId stripped by the mapper. Cursor = id (UUID v7). Zod schemas in packages/shared/src/audit/schemas.ts. Add the endpoints to the OpenAPI file and regenerate the client.
Seed 2M rows with a script (scripts/seed-audit.ts) and record EXPLAIN output in the handoff block.
Tests: TC-AUD-9 to TC-AUD-16, TC-AUD-23, TC-AUD-24 (performance test can be nightly).
```

### Phase 5 — AU-7: ActivityTab (Dev 2 or Dev 1, lane B)
```
Task AU-7. Load only: docs/F-execution/50_* section 9.2; docs/D-ui/22_* (components), docs/D-ui/21_* item 10; the generated API client.
Build apps/web/features/audit/{ActivityTab,AuditDetailDrawer,DiffView,useAuditLogs}.tsx. ActivityTab takes entityType and entityId, calls GET /audit-logs in entity mode, renders a compact timeline with the latest 3 changes inline, opens the drawer for details, handles loading/empty/error/403/404 states and hides itself when the API returns 404. Mount it on the existing detail pages that exist so far (add a TODO list of pages not yet built). No new API work.
Done when: a Zonal Admin sees the tab for a restaurant in their zone without IP or device; a Super Admin sees them.
```

### Phase 6 — AU-6: System Logs screen (Dev 1 or 2, lane B)
```
Task AU-6. Load only: docs/F-execution/50_* section 9.1; docs/D-ui/19_*, 22_*; DataTable and FilterBar components.
Build /super-admin/settings/logs with tabs Activity and Sign-ins, filter bar (URL state), table with cursor "Load more", the detail drawer from Phase 5, links to Access change history and Integration events, loading/empty/error states, route guard (Super Admin only, 404 for others). No export button yet.
Done when: all filters in section 9.1 work against the seeded 2M rows and the page renders in under 2 seconds.
```

### Phase 7 — AU-8: CSV export (post-pilot, Dev 1, lane A+B)
```
Task AU-8. Load only: docs/F-execution/50_* sections 8 (exports), 10; the existing exports framework (if absent, implement a minimal one with the exports table and a BullMQ job).
Implement POST /audit-logs/exports (audit:export, re-auth, 3/hour/user, 100,000 row cap), the processor streaming CSV with formula-injection escaping, signed 24-hour URL, an audit row audit.exported, and the ExportDialog + bell notification. Tests TC-AUD-18.
```

### Phase 8 — AU-5: retention jobs (before launch + 90 days, Dev 1, lane A)
```
Task AU-5. Load only: docs/F-execution/50_* section 11; docs/C-security/15_* section 4; docs/B-architecture/12_* (S3).
Implement the monthly archive job (JSONL.gz to the backup bucket with row-count and sha256 metadata), the daily purge job for audit_logs (only months older than 3 years with a verified archive, using SET LOCAL zoauro.audit_purge), and the nightly login_history purge (12 months). Alerts on failure. Run once against staging with backdated test data and show the results.
Tests: TC-AUD-8 extended with the archive check.
```

### Phase 9 — Adoption: make every module use it (each module owner, continuous)
```
Task AU-adopt for module <name>. Load only: docs/F-execution/50_* sections 4, 7; the module's service files.
For every write in the module, call audit.record(tx, …) with the catalogue action, entity, zone and before/after. Declare audit metadata on each mutating route. Add the module's actions to AUDIT_ACTIONS if missing (same PR). Add one test per write asserting the audit row. Run the coverage guard.
```
(Definition of Done for every future task in docs 33–35 already includes this line: doc 25 amendment.)

### Phase 10 — Independent verification (fresh session, read-only reviewer)
```
You are a reviewer, not the author. Do not modify any file. Read docs/F-execution/50_Module_Guide_M04_Audit_and_Logs.md and the code under apps/api/src/lib/audit, apps/api/src/modules/audit, apps/api/prisma/migrations (audit), apps/web/features/audit and apps/api/tests/audit.
Produce a table: each requirement of sections 2, 3, 5, 8, 10 and each test TC-AUD-1…24 → status (Met / Partly / Missing / Not applicable yet), evidence (file:line or test name), and any deviation from the doc. Then list: (1) any write route without audit metadata, (2) any place that inserts into audit_logs outside lib/audit, (3) any place that could log request bodies or PII, (4) any query on audit_logs outside the audit repository, (5) any way for a Zonal Admin to receive ip/userAgent or a row from an excluded module. Run the test suite and report results. Rank findings High/Medium/Low. Do not fix anything.
```
Then the author fixes High and Medium findings and re-runs Phase 10 until none remain.

---
## 16. Verification of this guide against the pack (done before delivery)
Method: searched every document of the pack for audit-related text and read the relevant sections of docs 03, 04, 06, 07, 08, 09, 10, 13, 14, 15, 20, 21, 24, 25, 33, 34, 39, 40. Findings:
| # | Finding | Resolution |
|---|---|---|
| 1 | Doc 08 `audit_logs` had no actor type, name snapshot, outcome, sensitivity, user agent or note, so app/system actors and readable history were impossible | Redefined in section 3, amendment in 17 |
| 2 | Doc 09 listed `GET /audit-logs` only; no detail, catalogue, export, login history | Section 8, amendment |
| 3 | Doc 04 gave Zonal Admin "entity Activity" but no rule for which rows | Section 2.2 rule |
| 4 | Doc 15 says "hot 12 months, then archive"; unnecessary at this volume | D60: one table for 3 years, monthly S3 archive, delete after 3 years |
| 5 | Doc 24 TC-AUTH-2 says "locked 15 min"; decision D37 is 30 min | Fix in 17 |
| 6 | Doc 07 module list still names `roles` | Rename to `access` in 17 |
| 7 | Plan sizes audit at ≈ 1.4 dev-weeks; this guide needs ≈ 3.3 (2.7 before pilot) | Section 14, flagged to owner |
| 8 | "Audit all writes" would include every app event (≈ 600k rows/month) | D59 excludes them, domain history tables cover them |
| 9 | SEC-6 had no mechanism | DB role + trigger (section 3.2) |
| 10 | Doc 25 DoD "Audit log entries for all writes" not testable | Route metadata + coverage guard |
| 11 | Retention job could not delete: it runs as the app role, whose DELETE was revoked | Third role `zoauro_purge`, own connection string (section 3.2) |
| 12 | `q` search had no index: 1.8 s for a term with no match at 2M rows | Expression indexes in a second migration (section 3.1) |
| 13 | Date filters on `created_at` had no index: 650 ms for an old window | Send an id range too (`uuidv7Bounds`) |
| 14 | Zone + module + action with few matches: 450 ms at p95 | Sixth index `(zone_id, module, id DESC)` |
| 15 | Masking before diffing lost phone-number changes | Diff raw, then redact (section 5.6) |
| 16 | A no-op write (identical values) would trip the coverage guard | Audited no-ops are counted |
| 17 | Customer rows have no single zone, so Zonal members could never see them in the Activity tab | Explicit zone rule and D63 (section 4.0) |
| 18 | A test clock could poison the global id generator (ids dated 2033) | `createUuidV7(clock)` per instance |
Executed here (v1): the guard SQL (section 3.2) on PostgreSQL 16, results in 3.2. Not executed: the Prisma model, the TypeScript snippets and everything in sections 6–9; prove them with the tests in section 12. Figma has no System Logs frame (D47).

## 17. Amendments to apply to other documents (Phase 0.5)
1. **Doc 03:** add rows in section 1.4: *D59* audit_logs records admin and system decisions, master-data changes by apps, and sensitive reads; it does not copy high-volume app event streams (order steps, location, stock toggles) — Decided (design), doc 50. *D60* audit retention: one table for 3 years, monthly S3 archive, delete after 3 years only with verified archive (changes doc 15 hot/archive) — Assumed. *D61* audit failures fail the business transaction (fail closed) — Decided (design). *D62* DENIED outcomes recorded for a short list with a 1/min rate limit — Assumed.
2. **Doc 04:** row "Audit / system logs": SA `V E(export)` all; Zonal "entity Activity only, derived from the entity module's view permission; `audit:view` and `audit:export` not grantable".
3. **Doc 08:** replace the `audit_logs` row with the table of doc 50 §3.1 (columns, enums, indexes, no foreign keys, append-only enforced by role and trigger); add "login_history purge 12 months".
4. **Doc 09:** replace the `/audit-logs` line with the rows of doc 50 §8 (list, detail, catalogue, exports, `/exports/{id}`, `/login-history`, `/me/login-history`).
5. **Doc 13:** SEC-6 text: "append-only enforced by database privileges and trigger (doc 50 §3.2)"; add threats T27, T28, T29 from doc 50 §10.
6. **Doc 15:** §4 audit logs row: "3 years in one table; monthly S3 archive; purge after verified archive"; §7 add "reveal, document view and export are recorded before data is returned".
7. **Doc 24:** replace TC-AUD-1 with "TC-AUD-1…24 — doc 50 §12"; change TC-AUTH-2 "Locked 15 min" to "Locked 30 min (D37)".
8. **Doc 25:** DoD line "Audit log entries for all writes" → "Every mutating route declares audit metadata; the coverage guard passes; the write has an audit test".
9. **Doc 07:** API module list: replace `roles` with `access`.
10. **Docs 34, 39, 40:** M04 tasks point to doc 50 phases AU-1…AU-9 (SA-1.5 → AU-4, SA-7.4 → AU-6); M04 effort note ≈ 3.3 dev-weeks.
11. **Doc 32:** change-log row "M04 module guide, D59–D62, audit schema redefined".

## 18. Build status and evidence (v1.1)
Bundle: `Zoauro-M04-Audit-Bundle/` (README.md inside). Command: `npm install && npm test` (needs PostgreSQL 16 reachable as `postgres:postgres@127.0.0.1`, or set `PG_ADMIN_URL`); performance: `AUDIT_PERF=1 npm test -- perf` (about 2 minutes, seeds 2,000,000 rows).
Result on delivery: typecheck clean (strict, `noUncheckedIndexedAccess`); 70 tests pass; 13 performance tests pass; mutation checks (9 deliberate breakages of the guard, redaction, visibility, no-op, user-agent, mapper and coverage code) each made at least one test fail.

| Test | Status | Evidence |
|---|---|---|
| TC-AUD-1, 2, 3, 4 | **Proven** (stand-in business table, real PostgreSQL) | `service.test.ts` |
| TC-AUD-5, 6 | **Proven** | `diff-redact.test.ts` (diff, redaction, schema walker on a fixture schema) |
| TC-AUD-7, 8 | **Proven** | `guard.test.ts` (18 tests, both tables) |
| TC-AUD-9, 10, 11, 12, 13 | **Proven at function and SQL-predicate level**; the HTTP-level versions need the real routes | `read-path.test.ts` (predicate evaluated in SQL equals `canSeeRow` for 5 viewers) |
| TC-AUD-14 (filters) | **Pending** (repository not built) | — |
| TC-AUD-15 | **Proven** for the id ordering and cursor shape (120 rows, 30 inserted mid-paging) | `read-path.test.ts` |
| TC-AUD-16, 21 | **Proven** | `service.test.ts` |
| TC-AUD-17 (reveal fails closed) | **Pending** (needs the customers module); the mechanism (audit throws, caller rolls back) is proven by TC-AUD-3 | — |
| TC-AUD-18 (export) | **Pending** (AU-8) | — |
| TC-AUD-19 | **Proven** runtime (Express + supertest) and static (OpenAPI `x-audit`) | `coverage.test.ts` |
| TC-AUD-20 | **Proven** (6 attempts → 1 row; window expiry; failure never breaks the caller) | `service.test.ts` |
| TC-AUD-22 (M03 transaction) | **Pending** (needs M03) | — |
| TC-AUD-23 (login lists) | **Pending** (needs M01) | — |
| TC-AUD-24, 25 | **Proven** on 2,000,000 rows: all query shapes p95 ≤ 21 ms (worst: `q` with matches 20.9 ms); thresholds 100/300 ms | `perf.test.ts` |
| TC-AUD-26, 27, 28 | **Proven** | `service.test.ts`, `coverage.test.ts`, `guard.test.ts` |
Not verified here: the Prisma model compiling in your repo (no Prisma was available), the Prisma adapter for `AuditTx` (a thin wrapper, see the bundle README), Redis rate limiting (implemented against an ioredis-shaped interface, tested with the in-memory twin), the UI (no Figma frame exists, D47), archive and purge jobs (AU-5), CSV export (AU-8).
