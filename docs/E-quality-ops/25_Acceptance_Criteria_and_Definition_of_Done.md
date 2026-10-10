# 25 — Acceptance Criteria and Definition of Done

## 1. Definition of Done (every feature)
- [ ] Meets requirements in docs 02–05 and the feature's acceptance criteria.
- [ ] Zod schemas, OpenAPI updated; types generated.
- [ ] Authorization enforced server-side; authorization matrix tests added.
- [ ] Zone isolation verified for Admin(A), Admin(A+B) and unassigned zone C (TC-MZ).
- [ ] Unit + integration tests added and passing; coverage not reduced.
- [ ] Audit log entries for all writes.
- [ ] UI matches Figma; loading, empty, error states present; keyboard and screen-reader checked.
- [ ] No lint, type, or `npm audit` high errors.
- [ ] Migrations reviewed, reversible (expand/contract).
- [ ] Logging without PII; Sentry breadcrumbs sensible.
- [ ] Docs updated (changed contract → doc 09/08/10; decision → doc 03; deviation → doc 32).
- [ ] Reviewed by one other developer; demo to product owner on staging.

## 2. Feature acceptance criteria (Given/When/Then)
**Login:** Given valid credentials, When submitted, Then Super Admin lands on global dashboard and Zonal Admin on zone dashboard. Given 5 failed attempts, Then account locks per policy.
**Zone management:** Given Super Admin, When creating a zone with unique name, Then zone is Active, audited, and visible in Zonal Admin assignment. Given duplicate name, Then error on the field.
**Zonal Admin creation:** Given one or more zones assigned, When saved, Then the admin sees only those zones' data; credentials emailed; first login forces password change.
**Orders list:** Given Zonal Admin with zones A and B, Then only A and B orders appear in list, counts, search and export. Given filters, Then URL reflects them and reload keeps them.
**Order transition:** Given valid next status, Then it saves, history is added, event emitted. Given invalid, Then 409 and no change.
**Restaurant/homemaker approval:** Given Pending vendor with verified documents, When approved, Then status Active, visible to customers, audit entry. Suspended vendor cannot receive new orders.
**Menu:** Given item with price and vendor, When availability toggled off, Then customers cannot order it; change is audited.
**Refund:** Given paid order, When Zonal Admin refunds within limit, Then gateway refund created once, ledger reversal posted, order payment_status updated. Above limit → queue; Super Admin approval completes; requester cannot approve.
**Payments webhook:** Given valid signature, Then payment confirmed once even if replayed.
**Roles and permissions:** Given Super Admin saves matrix, Then effective on next request, sessions refreshed, audit entry.
**Settings:** Given Super Admin changes password policy, Then enforced on next password change; Zonal Admin cannot open settings.
**Dashboard:** Given data, Then KPIs equal direct database counts; Zonal dashboard aggregates exactly the effective scope and excludes other zones; p95 < 2 s.
**Zone scope switcher:** Given an admin with zones A and B, When they select B, Then every list, KPI, chart, export and alert narrows to B and the URL reflects it; given A removed by Super Admin, Then A data is 404 on the next request.
**Security settings:** Given 2FA enforced, Then users without 2FA are forced to enroll at next login.

### Integration with the apps (v2.0)
See `G-integration/45` §5 and `H-delivery/48` (TC-INT-1…26, E2E-1…8). A feature that reads or writes app-fed data is done only when its inbound handler, outbound event (if any), inbound-log entry and audit row exist and are tested with the simulators.

### Access control (v1.2)
- Given a zone with two members of different access, when each logs in, then each sees only the modules and actions granted to them in that zone.
- Given a member with Read Only in zone B, when they try to change an order in B, then 403; the same action in zone A succeeds.
- Given Super Admin changes a profile, when members use it, then their next request reflects the change and the change appears in Access Change History with the member emailed.
- Given a Zonal Admin, when they call any access-control endpoint, then 403.

## 3. Release gate acceptance
All P0 features accepted; test exit criteria (doc 24) met; security review passed; backup restore tested; runbooks reviewed.
