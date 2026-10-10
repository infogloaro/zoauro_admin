# 30 — Monitoring and Operations Runbook

## 1. Logs
Structured JSON logs to CloudWatch with requestId, userId, zoneId; retention 30 days hot, archive to S3 for 1 year; redact secrets and PII.

## 2. Metrics and dashboards
| Area | Metrics |
|---|---|
| Web/API | request rate, p50/p95/p99 latency, 4xx/5xx rate per route |
| Containers/host | CPU, memory, restarts, disk |
| Nginx | 5xx, upstream health |
| RDS | CPU, connections, freelocal storage, replica lag, slow queries (Performance Insights), deadlocks |
| Redis | memory, evictions, queue depth |
| Queues | waiting, active, failed, oldest job age |
| Business | orders per minute, payment success rate, refunds per hour, webhook failures, login failures |
| Security | lockouts, 403/404 spikes on zone endpoints, **zone-assignment changes**, WAF blocks (once WAF exists) |

## 3. Alerts
| Alert | Condition | Severity | Route |
|---|---|---|---|
| 5xx rate | > 2% for 5 min | SEV2 | On-call |
| Login or payment failing | synthetic check fails 2× | SEV1 | On-call + phone |
| DB CPU | > 80% for 10 min | SEV3 | Slack |
| DB storage | < 20% free | SEV3 | Slack |
| Queue age | oldest job > 10 min | SEV2 | On-call |
| Dead-letter jobs | > 0 | SEV3 | Slack |
| Webhook failures | > 3 in 10 min | SEV2 | On-call |
| Reconciliation mismatch | any open > 48 h | SEV3 | Finance owner |
| Refund spike | > 10/hour by one admin | SEV2 | Super Admin |
| Auth anomalies | > 20 lockouts/hour | SEV3 | Security |
| Backup failure | any | SEV2 | On-call |
| Certificate expiry | < 14 days | SEV3 | DevOps |

## 4. Error tracking
Sentry for web, API and worker; release tagging by git SHA; source maps uploaded in CI; PII scrubbing; ownership rules by module; weekly triage.

## 5. Background jobs
BullMQ with retries (exponential backoff, max 5), dead-letter queue, idempotent handlers, job metrics. Job list: webhook processing, outbox publisher, notifications, exports, reconciliation (daily), payout generation (weekly), purge/retention (daily), backup verification.

## 6. Database performance
Weekly review of slow queries; add indexes via migration; `pg_stat_statements`; keep connections pooled (RDS Proxy or PgBouncer); archive old audit logs; vacuum monitored.

## 7. Operational procedures
| Task | Cadence |
|---|---|
| Review alerts and Sentry | Daily |
| Check reconciliation report | Daily |
| Dependency updates | Weekly (Dependabot) |
| Access review (admins, IAM) | Monthly |
| Secrets rotation | Quarterly |
| Restore test | Quarterly |
| Load test | Before major releases |
| DR drill | Yearly |

## 8. Support runbook (common issues)
| Symptom | Check | Action |
|---|---|---|
| Admin cannot log in | login_history, lockout | Unlock via Super Admin, reset password |
| Orders not updating | Socket.IO room membership/polling, worker health, queue depth | Restart worker, replay jobs |
| Payment shows pending | webhook_events, provider dashboard | Re-fetch payment, run reconcile |
| Refund failed | refunds.status, provider logs | Retry with same key |
| Zone data missing | `admin_zone_assignments` (revoked_at), switcher scope, filters | Fix assignment, verify zone_id |
| Admin sees wrong zones in switcher | `/me` response, scope cache | Invalidate scope cache, re-login |
| Socket events missing for a zone | room membership, `scope.changed` | Reconnect socket, check assignments |
| Slow dashboard | cache, slow query log | Warm cache, add index |

## 9. On-call
Primary and secondary rotation, escalation to tech lead after 15 minutes, incident process per doc 17.

## Integration monitoring (v2.0)
Dashboards and alarms: inbound requests per app and result code, p95 latency, signature failures, rate-limit hits; webhook deliveries by status, retry depth, dead letters; silent-client detector; reconciliation differences. Runbook rows: *app says orders are missing* (check inbound log by `Idempotency-Key`/`orderId`), *app not receiving updates* (check deliveries, retry, pull feed), *signature failures* (clock skew or rotated secret), *vendor stuck unzoned* (Pending registrations > Needs a zone). Details doc 45 and doc 43 §6.
