# 29 — CI/CD and Deployment Runbook

## 1. Pipelines (GitHub Actions)
**On pull request:** checkout → install (pnpm, cached) → lint → typecheck → unit + integration tests (Postgres and Redis service containers) → authorization matrix → OpenAPI diff check → `npm audit --audit-level=high` → secret scan (gitleaks) → build → Playwright smoke (optional).
**On merge to main:** build `web` and `api` Docker images → tag with git SHA → scan → push to ECR → run Prisma `migrate deploy` against staging (one-off container) → `docker compose pull && up -d` on the staging host → smoke tests.
**On release tag `v*`:** manual approval (GitHub Environment) → RDS snapshot → migrate production → deploy new containers behind Nginx (health-checked swap) → smoke tests → notify.

## 2. Security of the pipeline
GitHub OIDC to AWS (no long-lived keys); least-privilege deploy role; actions pinned by SHA; branch protection (required checks, reviews); environment secrets only for deploy jobs.

## 3. Migrations
Prisma migrations versioned in repo. Rules: expand → deploy → contract; no destructive change in the same release as code that stops using it; large-table changes use online techniques (create index concurrently); each migration tested on a staging copy. Seed scripts never run in production except the initial Super Admin.

## 4. Environment configuration
Secrets come from Secrets Manager/SSM at container start; non-secret config in the compose env file; `lib/env.ts` validates at boot; infrastructure-as-code (Terraform) is introduced after the pilot (D31).

## 5. Deployment strategy
Start new `api`/`web` containers, wait for `/api/health` (liveness) and `/api/ready` (DB reachable), switch Nginx upstream, stop old containers (automatic revert if health fails); deploy during low-traffic window; worker deployed after api. ECS rolling updates replace this when hosting is upgraded.

## 6. Post-deployment verification
1. `/api/ready` OK. 2. Login as both roles (synthetic accounts). 3. Load dashboard. 4. Create and cancel test order in staging; in production use read-only checks plus a flagged test zone. 5. Check Sentry for new errors and CloudWatch for 5xx and latency. 6. Verify webhook endpoint reachable.

## 7. Rollback
- Application: redeploy previous image tag (one command/workflow dispatch; compose pins tags).
- Database: backward-compatible migrations make app rollback safe; if a migration must be reverted, apply a forward fix; PITR only as last resort (data loss window).
- Config: revert the config commit and redeploy.
Rollback decision within 15 minutes if error rate > 2% or login/payments failing.

## 8. Release hygiene
Semantic version tags, release notes generated from conventional commits, change log updated (doc 32).
