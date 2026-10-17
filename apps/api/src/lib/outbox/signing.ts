import { createHmac } from 'node:crypto';

// Webhook envelope, headers and signature (doc 43 section 2) and the retry schedule (doc 43, D129 item 5).

/** Delay before attempt n+1 after attempt n failed (n = 1..6). Attempt 7 failing sends the delivery to dead letter. */
export const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 3_600_000, // 2 h
  6 * 3_600_000, // 6 h
  24 * 3_600_000, // 24 h
];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 7

/** When the next attempt is due after `attempt` failed, or null when that was the last one (dead letter). */
export function nextAttemptAfter(attempt: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/**
 * The body sent for an outbox row: the payload the writer stored (eventId, type, schemaVersion, occurredAt, aggregate,
 * audience, actor, data) plus `sequence` from the row. Built from the row alone, so every retry sends the same bytes.
 */
export function envelopeBody(payload: unknown, sequence: bigint): string {
  const base = payload !== null && typeof payload === 'object' ? payload : {};
  return JSON.stringify({ ...base, sequence: Number(sequence) });
}

/** `t=<ts>,v1=<hex HMAC-SHA256(secret, ts + "." + rawBody)>` */
export function signature(secret: string, timestampSec: number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `t=${timestampSec},v1=${mac}`;
}

export function webhookHeaders(i: {
  eventId: string;
  eventType: string;
  attempt: number;
  secret: string;
  rawBody: string;
  now: Date;
}): Record<string, string> {
  const ts = Math.floor(i.now.getTime() / 1000);
  return {
    'Content-Type': 'application/json',
    'X-Zoauro-Event-Id': i.eventId,
    'X-Zoauro-Event-Type': i.eventType,
    'X-Zoauro-Timestamp': String(ts),
    'X-Zoauro-Signature': signature(i.secret, ts, i.rawBody),
    'X-Zoauro-Attempt': String(i.attempt),
  };
}

/** Associated data for a subscription's webhook secret: it opens only for that subscription (doc 32). */
export const webhookSecretAad = (subscriptionId: string): string =>
  `webhook_subscriptions.secret_encrypted:${subscriptionId}`;
