# 01 — Project Brief

> v1.1: aligned to the GloAro CRM stack (D16) and multi-zone Zonal Admins (D3 changed). See doc 03.

## 1. Vision
A centralised web admin panel for the GloAro food delivery ecosystem. **Super Admin** monitors and controls the entire platform. **Zonal Admin** runs one or several operating zones: its restaurants, homemakers, delivery partners, customers, orders and payments.

## 2. Problem and opportunity
Operating several cities from one back office causes slow decisions, over-broad access and weak financial control. Zones let daily operations be delegated while the owner keeps global control.

## 3. Objectives
- Centralise restaurants, homemakers, food items, orders, customers, delivery partners.
- Give KPI visibility to each role.
- Support multiple cities and zones without code changes.
- Separate global control from zone-level operations.
- Control payments, commission, refunds and payouts.
- Provide settings, notifications and security controls.
- Enforce role-based, zone-scoped access.

## 4. Stakeholders
| Stakeholder | Interest |
|---|---|
| Platform owner / management | Global visibility, revenue, control |
| Super Admin team | Zones, admins, finance, settings |
| Zonal Admins | Day-to-day zone operations |
| Restaurants and homemakers | Orders, menu, payouts |
| Delivery partners | Assignments, cash settlement |
| Customers | Reliable orders and refunds |
| Development team | Clear specifications |

## 5. Scope
**In scope:** login and role routing; both dashboards; orders; restaurants; homemakers; menu/food items; customers; delivery partners; payments, commission, refunds, payouts; zone management; Zonal Admin management; roles and permissions; settings; security (2FA, sessions, logs); notifications; audit logs. Phase 2: analytics, offers and coupons, reviews and ratings, support tickets.
**Out of scope:** customer, restaurant, homemaker and delivery partner apps. Zonal Admin Zone Reports, Zone Performance and Complaints (per Figma).

## 6. Constraints
- Stack = GloAro CRM stack (doc 06, D16). Deploy on AWS, starting single-host (D31). UI follows the Figma prototype. COD must be supported.

## 7. Success metrics
| Metric | Target |
|---|---|
| Cross-zone data leaks in authorization tests | 0 |
| Dashboard load (p95) | < 2 s |
| List screens (p95, 10k rows) | < 1.5 s |
| Admin write actions audited | 100% |
| New zone + Zonal Admin onboarding without code | Yes |
| Payment and refund records reconciling with gateway | 100% |

## 8. Assumptions
One Zonal Admin may hold many zones and a zone may have several admins; homemakers separate from restaurants; customers shared across zones; INR, GST, IST defaults configurable; gateway undecided.

## 9. Risks
| Risk | Mitigation |
|---|---|
| Zone data leak (now N-zone aware) | Repository-level scope filter, scope-hash cache keys, automated tests incl. multi-zone, optional RLS |
| Over-powerful Zonal Admin | Refund limits, audit log, soft delete |
| Duplicate payments | Idempotency keys, signed webhooks |
| Scope creep | Backlog priorities, change log |
| Unclear business rules | Decision register with owner and date |
