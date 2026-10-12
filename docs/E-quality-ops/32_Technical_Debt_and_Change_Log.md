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
| TD-17 | Theme toggle, SMS OTP, Hotels tab not in v1 (D23, D33, doc 14) | Scope | Product owner | Post launch |

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
| 2026-10-10 | F0.3/F0.4 tooling deviations: tsx and tsup instead of ts-node-dev; Node 24 locally with .nvmrc 22; local compose uses offset host ports (Postgres 5440 (5441 when 5440 is taken: ZOAURO_PG_PORT), Redis 6390, MinIO 9020/9021) and pinned MinIO/mc/Mailpit images (minio/minio:latest is gone from Docker Hub); `pg` and `ioredis` added to apps/api for /api/ready until Prisma arrives in F1.1 | Developer (Lane D) | 06, 12 |
| 2026-10-10 | F1.1 schema: Prisma 7.10 (CLI pinned to match client; `prisma@latest` resolves to an 8.0 release candidate); `postgresqlExtensions` preview feature for pg_trgm; CHECKs and partial unique indexes in a second hand-written migration because Prisma cannot express them; PartnerStatus enum taken from doc 10 section 5; ambiguities listed in the F1.1 handoff block | Developer (Lane D) | 08, 10, 06 |
| 2026-10-10 | F1.2 auth: `@node-rs/argon2` (Argon2id, prebuilt binary, no install scripts) and `@prisma/adapter-pg` (Prisma 7 runtime driver) added to apps/api; sessions are PostgreSQL rows with a Redis read-through cache (doc 06) and timeouts enforced from timestamps; CSRF token is an HMAC of the session token hash; login rate limits 10/min per email and 30/min per IP, forgot-password 3 per 15 min per email and 10/min per IP | Developer (Lane A) | 06, 14 |
| 2026-10-11 | F1.3 access: permission keys and the grantable matrix live in packages/shared (doc 04 gives prose only; module key names follow the audit modules and docs 09/44); AuthContext resolved per request from the access tables with a Redis cache clamped to 60 s and explicit invalidation; `refunds:create` read as `refunds:add`; `reveal`/`export` stay flags in limitsByZone, not permission keys | Developer (Lanes A+D) | 04, 14, 36 |
| 2026-10-11 | F1.4: error codes and the error body moved to packages/shared (PASSWORD_CHANGE_REQUIRED added to doc 09 list); idempotency stores only 2xx responses, scopes the key to the caller, hashes method + path + canonical body, takes over an unfinished request after 60 s, 24 h retention | Developer (Lanes A+D) | 09 |
| 2026-10-11 | F1.5: OpenAPI 3.1 generated from shared Zod with @asteasolutions/zod-to-openapi (named in doc 06) and the client types with openapi-typescript (added; doc 09 names no generator); the contract lives in apps/api/src/openapi/operations.ts and carries x-access and x-audit per operation; committed copies are checked by a test (CI) and by `pnpm openapi:check`; new package @zoauro/api-client | Developer (Lanes A+D) | 06, 09 |
| 2026-10-11 | F1.6: authorization matrix harness reads the OpenAPI x-access declarations and generates 401/403/404/allowed per operation, actor and zone; it also cross-checks served routes against the document. Found and fixed an inconsistency in F1.3: a write that names a zone is 404 for an unassigned zone even for a member who holds the action nowhere (requirePermission option zoneInRequest). Minimal GitHub Actions workflow added ahead of F0.5 | Developer (Lanes A+D) | 04, 24, 36 |
| 2026-10-11 | F1.7 seed: roles, the five default Access Profiles with the doc 04 matrix (Support cancels orders via orders:status per doc 09; Zone Manager refund limits INR 1,000 / 5,000 per D13, in paise) and the first Super Admin from INITIAL_SUPERADMIN_*; idempotent, never overwrites an existing profile or account; reveal/export defaults are all off (doc 04 gives none) | Developer (Lanes A+D) | 03, 04, 08, 12 |
| 2026-10-11 | AU-3 audit wiring: the coverage guard counts rows in a per-request tally, separate from the actor context (a service's own context, e.g. forgot/reset password with nobody signed in, still counts); a path that deliberately changes nothing calls `noteAuditNoop()` (forgot-password for an unknown or rate-limited email, an idempotent replay) and counts as an audited no-op (TC-AUD-27); routes take audit metadata from operations.ts via `auditOf(operationId)`, so route and x-audit cannot drift; the session carries the display name for the actor snapshot (name as of session load); the "app logger" is console.error until a logger exists (doc 06 names none) | Developer (Lane A) | 50, 09 |
| 2026-10-12 | AU-4 audit read API: seventh audit_logs index (zone_id, module, action, id DESC) via a new migration, found necessary by the 2M-row run (TC-AUD-25 zone+module+action with no match was 1.3 s); list SQL is raw (Prisma.sql) with ORDER BY audit_logs.id (an unqualified id sorted the aliased text column); /login-history masks emails; local Postgres host port 5441 because 5440 is used by another project's container (ZOAURO_PG_PORT) | Developer (Lane A) | 50, 08, 09 |
| 2026-10-12 | AU-7 Activity tab: first apps/web code. Adds @tanstack/react-query, @radix-ui/react-dialog, lucide-react (all in doc 06) and jsdom + Testing Library for component tests; api-client gains path parameters; money fields in a diff are recognised by name (MONEY_FIELDS) because the audit diff carries no types; the timeline shows changed field names, not values (the list contract has none) | Developer (Lane B) | 06, 50 |
| 2026-10-12 | AU-6 System Logs page: two read-only endpoints added to doc 50 §8 because the filter bar had no data source (GET /audit-logs/actors, name prefix over `users`; GET /audit-logs/zones, all zones), both `audit:view`, Super Admin only; first shared UI (DataTable, FilterBar, Combobox, Badge, Tabs, Tooltip), root providers, a Server Component route guard (no session: redirect to /login; any other role: 404); Playwright added as a root dev dependency, run by `pnpm e2e:system-logs` against a throwaway database with 2,000,000 audit rows; links to Access change history and Integration events are disabled until those pages exist | Developer (Lane B) | 06, 50, 18 |

## 4. Process
Any change to a decision, contract or convention adds a row here and updates the affected documents in the same PR. Post-mortem actions and deferred refactors are added as TD items with owner and revisit date. Review this file at the end of each phase.
