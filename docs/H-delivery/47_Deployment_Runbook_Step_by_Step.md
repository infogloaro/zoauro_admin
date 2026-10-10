# 47 — Deployment Runbook, step by step (from an empty AWS account to a live pilot)

Companion to doc 29 (pipelines) and doc 12 (variables). Hosting follows D31: one host with Docker Compose + Nginx, RDS PostgreSQL, S3, Secrets Manager; scale-up steps after the pilot. Files in `H-delivery/deploy/` are starting points: review and adapt, they have not been run against your account.

## 1. Accounts and decisions
1. AWS account with MFA on root; create an admin IAM Identity Center user; enable billing alerts.
2. Region: `ap-south-1` (Mumbai) for latency and data residency.
3. Domains: `admin.<yourdomain>` (production), `staging-admin.<yourdomain>` (staging). Public API for the apps lives on the same host under `/api/v1/intake`.
4. GitHub organisation, private monorepo, protected `main`.

## 2. Repository bootstrap (day 1)
```bash
pnpm dlx create-turbo@latest zoauro-admin   # or manual pnpm workspace
# apps/web (Next.js App Router), apps/api (Express + TypeScript), packages/shared
cp docs/AGENTS.md ./AGENTS.md
docker compose -f docker-compose.dev.yml up -d   # postgres, redis, minio, mailpit
pnpm prisma migrate dev && pnpm db:seed          # zones A,B,C + test members (doc 08 seed)
pnpm dev                                          # web :3000, api :4000
```
Done when: login page renders, `/api/health` returns 200, seed users can log in.

## 3. Staging environment
1. **Network:** default VPC is acceptable for pilot; security groups: host allows 80/443 from the internet and 22 only from your office IP/SSM; RDS allows 5432 only from the host's security group.
2. **Host:** EC2 `t3.medium` (2 vCPU, 4 GB) Ubuntu LTS, 40 GB gp3; install Docker + Compose plugin; attach an IAM instance role with access to its S3 bucket and Secrets Manager paths only; install CloudWatch agent.
3. **RDS PostgreSQL 16** `db.t4g.medium`, encrypted, automated backups 7 days (staging) / 14 days + PITR (production), single-AZ now, deletion protection on in production. Create database `zoauro` and a least-privilege app user (not the master user).
4. **Redis:** a container on the host for the pilot (persistence on); move to ElastiCache when you add a second host.
5. **S3:** private bucket `zoauro-<env>-uploads` (block public access, SSE-S3, CORS only for the admin domain, lifecycle: incomplete uploads 7 days), separate bucket for DB/export backups.
6. **Email:** SES in `ap-south-1`, verify domain (SPF, DKIM, DMARC), request production access early (takes days).
7. **DNS and TLS:** A record to the host's Elastic IP; Nginx with Let's Encrypt (certbot) or ACM if you front it with an ALB later.
8. **Secrets:** create secrets in Secrets Manager per environment: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY` (32 bytes base64), payment keys and `PAYMENT_WEBHOOK_SECRET`, `INITIAL_SUPERADMIN_*`. Rotate `INITIAL_SUPERADMIN_PASSWORD` after first login (forced change).
9. **Deploy files** to `/opt/zoauro`: `docker-compose.prod.yml`, `nginx/zoauro.conf`, `.env` (non-secret values only). See `deploy/`.

## 4. CI/CD (details in doc 29)
1. GitHub OIDC role `gh-deploy-staging` and `gh-deploy-prod` (no long-lived keys); ECR repos `zoauro-api`, `zoauro-web`.
2. Workflow `ci.yml` on PR (lint, typecheck, tests with Postgres/Redis services, authorization matrix, OpenAPI diff, audit, secrets scan). Workflow `deploy-staging.yml` on merge to main (build, push, migrate, SSH/SSM `docker compose pull && up -d`, smoke tests). Workflow `deploy-prod.yml` on tag `v*` with manual approval, RDS snapshot first.
3. Branch protection: required checks, one review (two for `auth`, `access`, `payments`, `integration` paths via CODEOWNERS).

## 5. First deploy to staging
```bash
# on the host
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.ap-south-1.amazonaws.com
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm api pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml run --rm api pnpm db:seed:prod   # creates the Super Admin from INITIAL_SUPERADMIN_*, default profiles, settings
docker compose -f docker-compose.prod.yml up -d
curl -fsS https://staging-admin.<domain>/api/ready
```
Then: log in as Super Admin → forced password change → enrol 2FA → create zone → create two members → give them different access → verify with the Access Preview.

## 6. Connect the apps to staging (sandbox)
1. Super Admin: Settings > Integrations > create three clients (Customer, Vendor, Partner) in **sandbox**; copy each secret once and hand it to the right app team through a password manager (never chat or email).
2. Each app team sets `ZOAURO_BASE_URL`, `ZOAURO_KEY_ID`, `ZOAURO_SECRET`, `ZOAURO_WEBHOOK_URL`; registers its webhook endpoint in the Hub; presses "Send test event".
3. Run the contract suite (doc 48). Fix mismatches until green.

## 7. Production environment
Repeat §3 with production names, plus:
- RDS: Multi-AZ off for pilot, **PITR on**, snapshot before every release, deletion protection.
- Host: separate from staging, termination protection, unattended security upgrades, SSH disabled in favour of SSM Session Manager.
- Nginx: rate-limit `/api/v1/auth/login`; separate stricter limit zone for `/api/v1/intake`; request body cap (1 MB, uploads go direct to S3); security headers (doc 13).
- Alarms (CloudWatch): host CPU/disk, RDS CPU/storage/connections, 5xx rate, `/api/ready` failing, webhook dead-letter metric, queue depth, certificate expiry, backup failure.
- Sentry projects for web and api; uptime check on `/api/ready`.
- Payment gateway **live** keys and webhook URL `https://admin.<domain>/api/v1/webhooks/payments/<provider>`; one controlled real transaction and refund (doc 31).

## 8. Go-live sequence (doc 31 has the full checklist)
1. T-14 to T-1 as in doc 31 §3. Production is deployed and reachable only from admin IPs until the day.
2. Data: if apps hold existing data, run the import (doc 44 §5): dry run → report → fix → real run → reconcile counts per zone → Super Admin sign-off.
3. Create production clients for the three apps; each app team switches its **production** backend to the Integration API for the **pilot zone only** (feature flag on their side).
4. Create the pilot zone, its team and access (workflow W1, doc 39).
5. Enable the pilot zone; watch the Integration Hub Needs-attention panel and Sentry for four hours with all three app teams on a call.
6. Daily review for 7 days: error rate, dead letters, reconciliation, support tickets.

## 9. Rollback
- **App release fails health check:** compose reverts to the previous image automatically (doc 29 §5).
- **Bad migration:** migrations are expand-then-contract, so the previous image still works; if data is damaged restore from the pre-release RDS snapshot or PITR (drilled in S10).
- **Integration problem with one app:** disable that client in the Hub (kill switch). The app should queue and retry (it keeps the same Idempotency-Keys). Re-enable after the fix.
- **Pilot problem:** the app teams switch the pilot-zone flag back to the old path; the admin keeps the data collected so far.
- **Security incident:** doc 17.

## 10. After the pilot (do not do earlier, D31)
Multi-AZ RDS, second app host behind an ALB, WAF/CloudFront, Terraform for what exists, ElastiCache, log retention tuning, pen-test re-run.
