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
| 2026-10-10 | M04 module guide, D59–D62, audit schema redefined | Assistant | 03, 04, 07, 08, 09, 13, 15, 24, 25, 34, 39, 40, 50 |

## 4. Process
Any change to a decision, contract or convention adds a row here and updates the affected documents in the same PR. Post-mortem actions and deferred refactors are added as TD items with owner and revisit date. Review this file at the end of each phase.
