# 31 — Release Plan and Launch Checklist

## 1. Release stages
| Stage | Audience | Exit |
|---|---|---|
| Internal alpha | Developers | Core flows work on staging |
| UAT beta | Super Admin team + one pilot Zonal Admin **holding two zones** on staging | P0/P1 bugs closed, sign-off |
| Pilot launch | One or two zones (e.g. Coimbatore + a second) with one multi-zone Zonal Admin, in production | 2 weeks stable, metrics healthy |
| General release | Additional zones | Onboard via Zone Management |

## 2. Release gates
| Gate | Criteria |
|---|---|
| Functional | All P0 features accepted (doc 25) |
| Quality | Test exit criteria (doc 24) met; no open P0/P1 |
| Security | Authorization matrix 100% incl. TC-MZ-1…15; ZAP baseline clean; pen test findings high/critical fixed; dependency audit clean |
| Performance | k6 targets met (dashboard p95 < 2 s) |
| Operations | Alerts, dashboards, on-call, runbooks live |
| Data | Migration/import rehearsed; rollback tested |
| Backup | Restore test completed within RTO |
| Legal | Privacy notice, terms, DPAs reviewed |
| Sign-off | Product owner, tech lead, security reviewer |

## 3. Launch checklist
**T-14 days:** feature freeze; UAT; load test; pen test; confirm gateway production keys and webhook URL; SES production access; domain, DNS, TLS ready.
**T-7:** data migration rehearsal (vendors, customers, partners, historic orders if any); seed zones and Zonal Admins; train admins (short guide); verify 2FA enrolment for Super Admins; check WAF rules. Also: at least two Super Admins enrolled with an authenticator and backup codes stored; SMS stays off unless DLT registration is complete (doc 52).
**T-7 (apps):** each app team has passed the contract suite in sandbox (doc 48); production clients created; webhook URLs registered and tested; reconciliation agreed; pilot-zone feature flag ready on every app side.
**T-2:** production backup snapshot; verify restore; verify alarms by test triggers; freeze config.
**T-1:** deploy release candidate to production behind admin-only access; smoke tests; go/no-go meeting.
**Launch day:** deploy tag; run post-deployment verification (doc 29); enable pilot zone; monitor live for 4 hours with the team on call; check payments and webhooks with a controlled real transaction and refund.
**T+1 to T+7:** daily review of errors, reconciliation, support tickets; hotfix process ready.

## 4. Smoke tests (production)
Login both roles; dashboards load; list orders; open order; approve test vendor; assign partner; refund within limit in a test zone; webhook delivery; file upload; audit entries visible.

## 5. Data migration
Import scripts idempotent with dry-run mode; map legacy IDs; validate counts and totals; keep import log; no production import without backup.

## 6. Launch rollback
Triggers: login or payments failing, data isolation breach, error rate > 5% for 15 min. Actions: disable pilot zone access via flag, roll back image, communicate, follow doc 17 if a security incident.

## 7. Communication
Internal announcement, admin training sessions and quick guides, support contact, post-launch review after 2 weeks.
