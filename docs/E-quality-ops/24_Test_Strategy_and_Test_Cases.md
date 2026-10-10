# 24 — Test Strategy and Test Cases

## 1. Pyramid
| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest | Services, utils, Zod schemas, state machine | 80% on `modules/*/service.ts` and `lib` |
| Integration | Vitest + real PostgreSQL (Testcontainers) | Repositories, API routes, transactions, migrations | Every endpoint |
| Authorization | Vitest matrix | Actor (SuperAdmin, Admin(A), Admin(A+B), Admin(none)) × zone relationship × endpoint | 100% of endpoints |
| E2E | Playwright | Critical user journeys, both roles | ~25 flows |
| Component | Testing Library | Forms, tables | Key components |
| Accessibility | axe in Playwright | Core pages | No critical violations |
| Performance | k6 | Dashboard, orders list | Meets doc 02 targets |
| Security | `npm audit`, OWASP ZAP baseline, Semgrep | Whole app | No high issues |

## 2. Authorization test matrix (auto-generated from the OpenAPI spec)
For each endpoint test: unauthenticated (401); Admin(A) own zone (allowed per matrix); Admin(A) zone B (404); Admin(A+B) zones A and B (allowed), zone C (404), forged `zoneId` filters (404); Admin(none) (empty/404); capability missing (403); Super Admin (allowed). List endpoints must return only own-zone rows; counts and exports too; search must not leak.

## 3. Key test cases
| ID | Area | Case | Expected |
|---|---|---|---|
| TC-AUTH-1 | Login | Valid credentials | Role-based redirect |
| TC-AUTH-2 | Login | 5 wrong passwords | Locked 15 min, audit entry |
| TC-AUTH-3 | 2FA | Wrong code | Rejected, attempts limited |
| TC-AUTH-4 | Session | Idle past timeout | Redirect to login |
| TC-AUTH-5 | Reset | Reused token | Rejected |
| TC-ZONE-1 | Isolation | Zone A admin GET order of zone B | 404 |
| TC-ZONE-2 | Isolation | Zone A admin PATCH vendor of zone B | 404, no change |
| TC-ZONE-3 | Isolation | Dashboard counts | Only zone A |
| TC-ZONE-4 | Isolation | Guess IDs in bulk endpoint | Zone B IDs ignored/rejected |
| TC-ROLE-1 | RBAC | Zonal Admin calls zone create | 403/404 |
| TC-ROLE-2 | RBAC | Zonal Admin edits commission | Rejected |
| TC-ORD-1 | Orders | Valid transition chain to DELIVERED | History rows created |
| TC-ORD-2 | Orders | Skip PREPARING→DELIVERED | 409 INVALID_STATE_TRANSITION |
| TC-ORD-3 | Concurrency | Two admins transition same order | One 200, one 409 |
| TC-ORD-4 | Concurrency | Two admins assign same partner beyond cap | Cap respected |
| TC-VEN-1 | Vendors | Suspended vendor | Hidden, open orders continue |
| TC-VEN-2 | Menu | Item with both restaurant and homemaker | DB CHECK rejects |
| TC-PAY-1 | Payments | Valid signed webhook | Payment PAID, ledger balanced |
| TC-PAY-2 | Payments | Invalid signature | 400, nothing changed |
| TC-PAY-3 | Payments | Webhook replay | 200, no duplicate effect |
| TC-PAY-4 | Payments | Amount mismatch with gateway | Flagged, not PAID |
| TC-REF-1 | Refunds | Zonal refund within limit | Processed |
| TC-REF-2 | Refunds | Above limit | PENDING_APPROVAL |
| TC-REF-3 | Refunds | Same idempotency key twice | One refund |
| TC-REF-4 | Refunds | Refund > captured − refunded | 422 |
| TC-REF-5 | Refunds | Requester approves own | Rejected |
| TC-UPL-1 | Uploads | .exe renamed .jpg | Rejected |
| TC-AUD-1 | Audit | Any write | Audit row with actor and zone |
| TC-SEC-1 | Security | XSS payload in vendor name | Escaped everywhere |
| TC-SEC-2 | Security | CSRF without token | 403 |
| TC-SEC-3 | Security | CSV export with `=cmd` cell | Escaped |
| TC-UI-1 | UI | Keyboard-only create zone | Possible |
| TC-INT-1…26 | Integration with apps | Full list in `H-delivery/48` §3 | All pass against simulators in CI and against sandbox before go-live |
| TC-AC-1…14 | Access control | Full list in doc 36 §6b | All pass; per-PR regression |
| TC-MZ-1…15 | Multi-zone | Full list in doc 36 §6 | All pass; part of the per-PR regression suite |

## 5. Regression suite
All TC-ZONE, TC-MZ, TC-AC, TC-INT, TC-PAY, TC-REF run on every PR; E2E smoke on merge; full E2E nightly on staging.

## 6. Test data
Factories (zones A, B and C; Super Admin; Admin(A); Admin(A+B); Admin(none); vendors, orders in all states). Deterministic seeds. No production data.

## 7. Exit criteria
No open P0/P1 bugs; authorization matrix 100% pass; coverage targets met; accessibility and security scans clean.
