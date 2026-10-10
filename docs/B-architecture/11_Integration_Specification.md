# 11 — Integration Specification

| Integration | Purpose | Status | Notes |
|---|---|---|---|
| Payment gateway | Online payments, refunds, webhooks | Undecided (D6) | `PaymentProvider` interface; Razorpay or Cashfree first candidates |
| Maps | Address geocoding, distance/zone detection | Proposed Google Maps Platform or AWS Location Service | Zone pincode check is primary; maps optional in admin |
| Customer / vendor / partner apps | Order source and vendor/partner events | **D18 open** | Inbound Integration API + outbound signed webhooks (docs 41–45). Mode B adapter if a backend already exists |
| Delivery services | Third-party fleet | Not in v1 | Interface placeholder `FleetProvider` |
| Email | Credentials, resets, alerts | Amazon SES | Verified domain, SPF, DKIM, DMARC |
| SMS / OTP | Optional OTP, alerts | Provider TBD (India DLT registration needed) | |
| WhatsApp | Notifications | Optional later | Business API template approval |
| Push | Customer/partner apps | Out of panel scope; admin sends via notifications module | FCM |
| Object storage | Documents, images | Amazon S3 (S3-compatible, MinIO locally) | Pre-signed PUT, 5 MB images / 10 MB PDFs, allow-list types, virus scan (optional ClamAV Lambda) |
| Error tracking | Sentry | | PII scrubbing |

## PaymentProvider contract
```ts
interface PaymentProvider {
  createPayment(order: OrderForPayment): Promise<{ providerPaymentId: string; clientToken: string }>;
  verifyWebhook(rawBody: Buffer, signature: string): ProviderEvent;
  refund(input: { providerPaymentId: string; amount: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>; // for reconciliation
}
```

## Webhook handling
1. Read raw body, verify signature, reject 400 on failure. 2. Insert into `webhook_events` (unique event_id); duplicate → 200. 3. Enqueue processing job. 4. Job updates payment, order, ledger in one transaction. 5. Failures retry with exponential backoff, then dead-letter queue and alert.

## Outbound resilience
Timeouts (5–10 s), retries with jitter for idempotent calls, circuit breaker, no secrets in logs, per-provider health metrics.

## Uploads
Client asks `/uploads/presign` with type and size → server validates and returns pre-signed URL with key `zone/{zoneId}/{entity}/{uuid}.{ext}` → client uploads → client confirms → server verifies object exists. Files are private; reads use short-lived signed URLs.
