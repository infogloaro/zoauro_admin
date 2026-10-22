# 00 — Alignment Review: pre-dev pack vs designer PDF vs Figma vs your project

Reviewed: 32-document pre-dev pack (v1.0), designer PDF, 17 Figma screenshots, the doc index you attached. The Figma prototype link could not be opened (no file access), so 16 of the PDF's 29 screens were not seen.

> **v2.0 update:** the panels are fed automatically by the customer, vendor and partner apps through an Integration API, and admin decisions are sent back as signed events (docs 41–48, `G-integration/contracts/`). Still open and blocking: **D18** (do the apps exist, with what backend). Earlier sections below describe v1.0 to v1.2 findings.

## Verdict
The pack is structurally complete (all 32 documents exist and are consistent with each other) and its business logic is solid. It was **not** development-ready against your project because of three conflicts, and it contained several gaps that would have stopped developers in the first weeks. v1.1 fixes what can be fixed from the evidence and lists what only you can decide.

## 1. Conflicts with your project (fixed in v1.1, confirm)
| # | Conflict | Earlier decision being changed | v1.1 action |
|---|---|---|---|
| 1 | **Stack.** v1.0 used Next.js route handlers as the backend, Auth.js, ECS Fargate + Terraform. Your GloAro CRM stack is Next.js + Express modular monolith, Prisma/PostgreSQL, Redis/BullMQ, Socket.IO, S3-compatible storage, Docker/Nginx/PM2, and you require the stack not to change without permission | v1.0 doc 06 and D5 (assistant-assumed) | Pack now uses the CRM stack (D16). Auth.js dropped: it is a Next.js library and cannot sit cleanly in front of an Express API (D5 changed) |
| 2 | **One zone per Zonal Admin** (D3, TD-3, PDF "assigned zone only", Figma "Assign Zone" single field). You now want one admin across multiple zones | D3 "one zone now, multi-zone later" | Reversed. Many-to-many assignments, scope switcher, per-request scope resolution, 15 new tests (docs 36, 08, 14). D7 (several admins per zone) decided |
| 3 | **Over-built hosting for the scale.** ECS Fargate, Terraform, Multi-AZ, WAF, CloudFront, separate AWS accounts, cross-region copies, F0-6 "size L" as the first task, for 50 admins and ~100k orders/month (≈ 2–3 orders/minute) | v1.0 doc 06 §5, doc 27 F0-6 | Start on one AWS host (Docker + Nginx) with RDS and S3; upgrade after the pilot (D31). This removes the biggest early task |

## 2. Questions only you can answer
| ID | Question | Blocks | Default used |
|---|---|---|---|
| **D18** | **Does a Zoauro backend, customer app, vendor app or partner app already exist?** The PDF says "the existing operational flow is retained". The pack assumes greenfield. If something exists, the schema and Phase SA-4 change from "build" to "integrate" | Foundation F1 | Greenfield + Intake API + order simulator |
| D6 | Payment gateway (Razorpay, Cashfree, other) | Phase SA-6 (week ~15) | Interface only |
| D36 | Should Zonal Admin get a Payments screen? Figma sidebar has none, but your D4 gives them refunds | ZA-6 design | Payments entry added, designer to confirm |
| D17 | Separate repo and database from the CRM/ERP? | F0 | Separate |
| D21 | Product name: ZOAURO (logo) vs GloAro (PDF) vs "GloAro Mart" (Figma zone page) | copy | ZOAURO brand, GloAro company |
| — | Zonal dashboard: add "Today's Revenue" (PDF) next to the five Figma cards? | ZA-5 | Yes, 6 cards |
| D13/D20 | Refund limits INR 1,000 per refund / 5,000 per day: per admin across zones, or per zone? | SA-6.4 | Superseded in v1.2: per member per zone (D20) |

## 3. PDF vs Figma vs pack: what did not match
Full table of 22 items in doc 37 §2. The ones that change development:
- Restaurants have two separate fields in Figma: **Verification** (Verified/Pending/Rejected) and **Status**. v1.0 had one status and "rejected stays pending" → now two fields (D22).
- Figma Zone Management has **State** and an **Upcoming** status, and shows admin per zone; the PDF field list has neither (D35).
- Orders show payment method **Wallet**; v1.0 only had Online and COD (D24).
- Figma lists show full phone numbers; your privacy doc requires masking (D26).
- Figma Restaurants page has a **Hotels** tab (a third vendor type) and Homemakers is a tab, not a sidebar item (D23, D27).
- Zonal dashboard in Figma differs from the PDF (no Today's Revenue; adds top restaurants, area chart, recent lists).
- Super Admin dashboard has 12 KPIs and widgets (revenue chart, categories, new registrations, platform health) beyond the PDF. Platform Health "uptime" would need new monitoring, so v1.1 limits it to DB values (D34).
- Security screen: lock 30 min, SMS OTP (disabled), login history shows Admin / Support Staff / Finance Staff roles; v1.0 assumed 15 min and two roles only (D37, D30).
- Permission matrix: Figma/PDF have View/Add/Edit/Delete; v1.0 needs a fifth Status column (D29). PDF says Delete is "Restricted" and Customers Add is "—"; your D2 gives full control, so defaults follow D2 and are editable.

## 4. Gaps inside the v1.0 pack (fixed)
| Gap | Where it hurt | Fix |
|---|---|---|
| `outbox` table required by doc 10 but not in the schema | event handling | added (doc 08) |
| `idempotency_keys` (24 h response store) not in schema | refunds, payments | added |
| COD daily cash settlement described in doc 16, no table | partner settlement | `cash_settlements` |
| Homemaker `daily_capacity` in forms (doc 22), not in schema | homemaker form | added |
| Exports expiring in 24 h, DSR requests, reconciliation runs, per-admin refund usage: no tables | privacy, finance | added |
| Customer-zone visibility undefined, yet Figma shows per-zone customer counts and zonal customer lists | scope leaks | rule D25 |
| "Area" filter in every Figma list, no field | filters, area chart | `area` text field (D38) |
| No intake path for orders; panels would be empty | all order work | Integration API + simulators (docs 41–45, SA-10) |
| Real-time via SSE while your CRM uses Socket.IO; no rule for who may join which room | scope leak risk | Socket.IO zone rooms joined server-side only |
| Global search box in the Figma header, not specified | leak risk | P1 task, scope-filtered (D32) |
| v1.0 backlog was one list for both panels | planning | three plans (33, 34, 35) with gates |

## 5. Scope I would not build yet (pushback)
Analytics, Offers & Coupons, Reviews & Ratings and Support are drawn in Figma but are not in your launch goal; they sit in SA-8 after the pilot. Also deferred: theme toggle, SMS OTP, Hotels, impersonation, partner sharing across zones, ECS/Terraform. Each is logged in doc 32.

## 6. What changed in the pack
Rewritten: 03, 04, 06, 07, 08, 09, 12, 14, 18, 27, 32, README, AGENTS.md. Patched: 01, 02, 05, 10, 11, 13, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31. Unchanged: 15. New: 00, 33–38.

## 7. Evidence limits
- Figma frames not in the zip were not seen; those screens are specified from docs 20/22 and marked provisional (doc 37 §1).
- Colours in doc 37 are read from screenshots and are approximate.
- I could not inspect your CRM repository from here. "Reuse CRM auth/UI kit" is stated as an option, not a fact.
- Week estimates are planning figures for two developers and should be re-measured after two sprints.
