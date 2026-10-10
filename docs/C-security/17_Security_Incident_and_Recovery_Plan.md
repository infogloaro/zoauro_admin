# 17 — Security Incident and Recovery Plan

## 1. Recovery objectives
| Item | Target |
|---|---|
| RPO (data loss) | ≤ 5 minutes (RDS PITR) |
| RTO (restore service) | ≤ 4 hours |
| Backup retention | 35-day PITR; monthly snapshots kept 12 months; cross-region snapshot copy **after pilot** (D31) |
| Restore test | Quarterly, documented |

## 2. Backups
RDS automated backups + PITR, encryption with KMS; S3 versioning and cross-region replication for documents; Terraform state versioned; secrets recoverable from Secrets Manager with replicas; Redis is cache/queue only, rebuildable.

## 3. Incident severity
| Level | Example | Response |
|---|---|---|
| SEV1 | Confirmed data breach, payment fraud, full outage | Immediate; incident commander, all hands |
| SEV2 | Partial outage, suspected compromise, cross-zone leak | Within 30 min |
| SEV3 | Single feature broken, suspicious logins | Same business day |
| SEV4 | Minor | Backlog |

## 4. Response phases
1. **Detect** via alerts, Sentry, reports. 2. **Triage** classify severity, appoint incident commander, open incident record. 3. **Contain** revoke sessions, disable affected accounts, rotate keys, block IPs in WAF, disable feature flag, suspend payment settings if fraud. 4. **Eradicate** fix root cause, patch. 5. **Recover** restore from backup or redeploy, verify integrity, monitor. 6. **Review** blameless post-mortem within 5 working days; actions tracked in doc 32.

## 5. Breach escalation
Within 1 hour: tech lead and Super Admin owner informed. Within 24 hours: legal counsel and management decide on notification. Notify affected users and the Data Protection Board of India where required by law (DPDP Act timelines to be confirmed with counsel). Keep evidence: logs, snapshots, timeline.

## 6. Playbooks
| Scenario | Steps |
|---|---|
| Admin account compromised | Revoke sessions, lock account, reset password and 2FA, review audit log for actions, reverse harmful changes |
| Cross-zone data exposure | Disable affected endpoint, identify records via audit, notify owners, patch, add regression test |
| Payment fraud / suspicious refunds | Freeze refunds (setting), reconcile, contact gateway, review ledger |
| Secrets leaked | Rotate secret, redeploy, search logs for misuse |
| Database corruption / bad migration | Stop writes, PITR to a new instance, switch endpoint, reconcile |
| Region outage | Restore to secondary region from cross-region snapshot; DNS cutover (documented, tested yearly) |
| DDoS | WAF rate rules, enable Shield Standard, scale out |

## 7. Disaster recovery steps (database)
Identify time before failure → RDS restore to new instance → run integrity checks (row counts, latest orders) → update `DATABASE_URL` secret → redeploy → smoke tests → communicate.

## 8. Contacts and roles
Incident commander (tech lead), communications (Super Admin owner), payments contact (finance), AWS support plan Business recommended in production. Keep an on-call roster.
