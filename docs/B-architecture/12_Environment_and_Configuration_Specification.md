# 12 — Environment and Configuration Specification (v1.1)

## Environments
| Env | Purpose | Data | Infra |
|---|---|---|---|
| local | Developer | Seed data (zones A, B, C; admin on A+B) | Docker Compose: Postgres, Redis, MinIO (S3), Mailpit, api, web, worker |
| staging | QA, UAT | Synthetic only | One host Docker Compose + Nginx, RDS single-AZ |
| production | Live | Real | Same shape; RDS with PITR; Multi-AZ and second host after pilot (doc 06 §5) |

## Variables (API unless stated)
| Name | Secret | Description |
|---|---|---|
| NODE_ENV | no | |
| APP_URL | no | Public base URL (web and API share it) |
| WEB_INTERNAL_API_URL | no | Web → API URL for Server Components (web only) |
| DATABASE_URL | yes | Postgres connection (role `zoauro_app`: SELECT/INSERT on the audit tables) |
| DATABASE_ALLOWED_ROLES | no | Comma-separated, default `zoauro_app`. Boot guard: after connecting, `select current_user` must equal the role in `DATABASE_URL` and be in this list, or the API refuses to start (the message names roles only). `zoauro_owner` and `zoauro_purge` are rejected |
| DATABASE_URL_MIGRATE | CI/deploy only | Migration role `zoauro_owner`; never set in the API or worker environment |
| DATABASE_URL_AUDIT_PURGE | worker only | Role `zoauro_purge` for the audit retention job (doc 50 §3.2, D64) |
| REDIS_URL | yes | |
| SESSION_SECRET | yes | Cookie/CSRF signing (replaces Auth.js `AUTH_SECRET`) |
| ENCRYPTION_KEY | yes | AES-256 for MFA secrets and sensitive fields (KMS preferred) |
| ENCRYPTION_KEY_PREVIOUS | no | Previous key kept while rotating (secrets are opened with current, then previous) |
| OTP_HMAC_KEY | yes | HMAC key for OTP and backup-code hashes; ≥ 32 bytes; must differ from `SESSION_SECRET` and `ENCRYPTION_KEY` (doc 52) |
| MFA_ISSUER | no | Name shown in authenticator apps (default `ZOAURO Admin`) |
| SMS_PROVIDER | yes | `none` (default) \| `console` (dev/test only; production refuses to start) \| a real adapter once chosen |
| SMS_API_KEY, SMS_SENDER_ID, SMS_DLT_ENTITY_ID, SMS_DLT_TEMPLATE_ID_OTP | when SMS is enabled | Provider credentials and DLT identifiers; `smsEnabled` cannot be true without a real provider and the template id |
| S3_BUCKET, S3_REGION, S3_ENDPOINT | no | endpoint set for MinIO locally |
| SES_FROM_ADDRESS / SMTP_URL | no/yes | |
| PAYMENT_PROVIDER | no | razorpay, cashfree |
| PAYMENT_KEY_ID / PAYMENT_KEY_SECRET | yes | |
| PAYMENT_WEBHOOK_SECRET | yes | |
| INTEGRATION_CLOCK_SKEW_SEC | no | default 300 |
| INTEGRATION_WEBHOOK_TIMEOUT_MS | no | default 10000 |
| INTEGRATION_FEED_RETENTION_DAYS | no | default 14 |
| INTEGRATION_LOG_RETENTION_DAYS | no | default 90 |
| ONLINE_PAYMENT_EXPIRY_MIN | no | default 15 (D52) |
(Client secrets are encrypted with `ENCRYPTION_KEY`; the v1.1 pepper is no longer used, D51.)
| SENTRY_DSN | no | |
| LOG_LEVEL | no | |
| TRUST_PROXY_HOPS | no | Non-negative integer, default 0: how many reverse proxies may set `X-Forwarded-For` (Express `trust proxy`). 0 = `req.ip` is the socket address; 1 behind the single Nginx (doc 06). Never more than the real number, or a client can choose its own IP for rate limits and the audit `ip` |
| INITIAL_SUPERADMIN_EMAIL | no | Seed only |
| INITIAL_SUPERADMIN_PASSWORD | yes | Seed only, forced change |

## Rules
- All env vars validated at startup by a Zod schema in `apps/api/src/lib/env.ts` (and `apps/web` equivalent); the process refuses to start if invalid.
- `.env.example` committed, `.env*` ignored.
- Production secrets live in AWS Secrets Manager/SSM and are injected at container start; no static AWS keys in images.
- Business settings (commission, refund limits, timeouts, password policy, lock duration, session timeout) live in `settings`, editable by Super Admin, cached 60 s. Infrastructure config stays in env.
- Feature flags: `settings` keys prefixed `flag.`.

## Ownership
| Item | Owner |
|---|---|
| Hosting, IAM, deploy scripts | DevOps / tech lead |
| Secrets rotation | DevOps (quarterly) |
| Business settings | Super Admin |
| Gateway credentials | Finance owner + tech lead |
