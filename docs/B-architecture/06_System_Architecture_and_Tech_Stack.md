# 06 — System Architecture and Technology Stack (v1.1)

v1.1 aligns the stack with the GloAro CRM stack (D16). Changed from v1.0: Express API instead of Next route handlers; in-house session auth instead of Auth.js; Socket.IO instead of SSE; hosting starts simple (D31).

## 1. Stack
| Area | Choice |
|---|---|
| Language | TypeScript strict (web, api, shared) |
| Frontend | Next.js App Router, Tailwind CSS, shadcn/ui + Radix, React Hook Form + Zod, TanStack Query, Recharts, lucide-react |
| API | Node.js + Express, modular monolith, REST under `/api/v1`, Zod validation, OpenAPI 3.1 via `zod-to-openapi` |
| Database | PostgreSQL + Prisma |
| Cache, jobs | Redis + BullMQ (dashboard cache, exports, outbox publisher, webhooks, payouts, reconciliation, retention) |
| Real-time | Socket.IO (zone-scoped rooms joined server-side only) |
| Auth | In-house session auth in the API: Argon2id, opaque session id in HTTP-only cookie, sessions in PostgreSQL (Redis read-through), TOTP via `otplib`, email OTP fallback (doc 14) |
| Authorization | Server-side RBAC + zone scoping in the API repository layer |
| Storage | S3 (S3-compatible API; MinIO locally), pre-signed URLs |
| Payments | `PaymentProvider` interface (D6 open) + COD + wallet record |
| Email | Amazon SES (or SMTP provider already used by the CRM); Mailpit locally |
| Monitoring | Sentry + structured pino logs + CloudWatch (or host log shipping) |
| CI/CD | GitHub Actions, Docker images |
| Hosting | Docker Compose behind Nginx on one AWS host; RDS PostgreSQL; S3. Upgrade path in §5 |
| Security testing | `npm audit`, gitleaks, Semgrep, authorization matrix tests, ZAP baseline before launch |

## 2. Application boundaries
Monorepo, three packages:
- `apps/web` Next.js. Pure UI: **never imports Prisma or repositories**. Server Components call the API through the generated typed client, forwarding the session cookie.
- `apps/api` Express. Owns auth, RBAC, zone scoping, services, repositories, Prisma, BullMQ workers (separate process entry `worker.ts`), Socket.IO.
- `packages/shared` Zod schemas, DTO types, permission keys, order/refund enums, money helpers, route constants. Single source for form validation and OpenAPI.

```
Browser ── Nginx ──┬─ /            → web (Next.js)
                   ├─ /api/v1/*    → api (Express)  ─┬─ PostgreSQL (RDS)
                   └─ /socket.io/* → api (Socket.IO) ├─ Redis ─ worker (BullMQ)
                                                      ├─ S3 (pre-signed URLs)
                                                      └─ Payment gateway / SES / SMS (outbound; webhooks inbound)
```
Web and API share one origin through Nginx, so the session cookie is `SameSite=Lax`, first-party, and CORS stays closed.
Customer, vendor and partner app **backends** call `/api/v1/intake/*` server-to-server with HMAC-signed requests and separate client credentials (docs 41–43); the Core sends signed webhooks back and exposes a pull feed. The `worker` process also runs the outbox publisher and webhook delivery.

## 3. Layering (API)
route → controller (parse, auth guard) → service (rules, transactions, audit, events) → repository (Prisma; **always receives `AuthContext`**) → database. Controllers never call Prisma. Only `repository.ts` imports Prisma.

## 4. Zone isolation
Every zone-owned table has `zone_id`. Repositories add `zone_id IN (ctx.effectiveZoneIds)` for non-Super-Admin. Optional second barrier: PostgreSQL RLS using `SET LOCAL app.zone_ids` inside the request transaction. Tests prove isolation for 1-zone and N-zone admins (doc 24, 36).

## 5. Hosting and scaling
Sizing reality check: 50 concurrent admins and ~100k orders/month is roughly 2–3 orders per minute on average. v1.0 asked for ECS Fargate, Terraform, Multi-AZ, WAF, CloudFront, separate AWS accounts and cross-region copies up front. That is more infrastructure than this load needs and a heavy first task (old F0-6, size L). v1.1 order:

| Stage | Hosting |
|---|---|
| Local | Docker Compose: Postgres, Redis, MinIO, Mailpit |
| Staging + pilot production | One EC2 (or Lightsail) host: Docker Compose + Nginx + Let's Encrypt/ACM; **RDS PostgreSQL** (automated backups + PITR, encrypted), **S3** private buckets, Secrets Manager or SSM for secrets, CloudWatch agent for logs |
| After pilot is stable | Multi-AZ RDS, second app host behind an ALB, WAF/CloudFront, then Terraform for what already exists |
| Only if load requires | ECS Fargate, read replica, partitioned `audit_logs` |

Scaling levers in order: Redis cache for dashboard aggregates (TTL 30–60 s) → indexes → vertical DB → read replica → move heavy exports to BullMQ (already planned).

## 6. Real-time (Socket.IO)
- Client connects with the session cookie; server authenticates the handshake.
- Server joins the socket to `zone:<id>` rooms for each **currently assigned** zone. Clients cannot request rooms.
- Events: `order.created`, `order.status_changed`, `refund.pending_approval`, `partner.availability_changed`. Payload carries ids and minimal fields; client refetches through the normal scoped API.
- On assignment change the server emits `scope.changed`; the socket leaves/joins rooms and the client refreshes `/me`.
- Polling every 15 s is the fallback if the socket drops.

## 7. Architecture decisions (ADR summary)
| ADR | Decision | Reason |
|---|---|---|
| 1 | Modular monolith (Express) + separate Next.js UI | Matches CRM stack, small team |
| 2 | REST + OpenAPI generated from shared Zod | Reusable by customer/vendor/partner apps |
| 3 | Zone scope in repository layer, N-zone aware | One enforcement point |
| 4 | Soft delete | History and audit |
| 5 | Money in integer paise | No rounding errors |
| 6 | Single-host Docker first, ECS later | Right-sized (D31) |
| 7 | Socket.IO zone rooms joined server-side | Real-time without scope leaks |
| 8 | Separate repo/DB from CRM | Different data class and cadence (D17) |
