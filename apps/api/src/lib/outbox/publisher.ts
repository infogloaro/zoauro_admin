import type { DueDelivery, OutboxRepository, PublishedRow } from './outbox.repository';
import {
  envelopeBody,
  MAX_ATTEMPTS,
  nextAttemptAfter,
  webhookHeaders,
  webhookSecretAad,
} from './signing';
import type { WebhookTransport } from './transport';

// Outbox publisher (SA-4.5, IH-5 delivery part; docs 10, 43). Two steps, each run by its own BullMQ job:
//  1. publish: unpublished outbox rows -> one webhook_deliveries row per matching subscription, row marked published;
//     then every published row goes to the in-process listeners (realtime relay, M17).
//  2. deliver: due deliveries -> signed POST through the transport -> DELIVERED, FAILED (retry) or DEAD (dead letter).

export type OutboxStore = Pick<
  OutboxRepository,
  'publishBatch' | 'claimDue' | 'markDelivered' | 'markRetry' | 'defer' | 'markDead'
>;

export interface SecretOpener {
  open(sealed: string, associatedData: string): string;
}

export type PublishedListener = (rows: readonly PublishedRow[]) => Promise<void> | void;

export interface PublisherConfig {
  batchSize: number;
  /** batches per job run; the job is scheduled again right after, so this only bounds one run */
  maxBatchesPerRun: number;
  /** how long a claimed delivery stays invisible to other workers while it is being sent */
  leaseMs: number;
  timeoutMs: number;
  /** paused subscription or disabled client: how long to wait before looking again */
  pauseRecheckMs: number;
  /** a delivery still waiting on a paused subscription after this long is dead (feed retention, doc 43 section 3) */
  retentionMs: number;
}

export const DEFAULT_PUBLISHER_CONFIG: PublisherConfig = {
  batchSize: 100,
  maxBatchesPerRun: 10,
  leaseMs: 60_000,
  timeoutMs: 10_000,
  pauseRecheckMs: 5 * 60_000,
  retentionMs: 14 * 24 * 3_600_000,
};

export type DeliveryOutcome = 'DELIVERED' | 'RETRY' | 'DEAD' | 'DEFERRED';

export interface OutboxPublisher {
  /** Publishes until nothing is left or maxBatchesPerRun is reached; returns the number of rows published. */
  publish(): Promise<number>;
  /** Sends due deliveries until none are left or maxBatchesPerRun is reached; returns the outcomes. */
  deliver(): Promise<Record<DeliveryOutcome, number>>;
}

export function createOutboxPublisher(deps: {
  store: OutboxStore;
  transport: WebhookTransport;
  secrets: SecretOpener;
  listeners?: readonly PublishedListener[];
  config?: Partial<PublisherConfig>;
  clock?: () => Date;
  log?: (line: string) => void;
}): OutboxPublisher {
  const cfg = { ...DEFAULT_PUBLISHER_CONFIG, ...deps.config };
  const now = deps.clock ?? (() => new Date());
  const log = deps.log ?? ((l: string) => console.error(l));
  const listeners = deps.listeners ?? [];

  async function notify(rows: readonly PublishedRow[]) {
    for (const l of listeners) {
      try {
        await l(rows);
      } catch (err) {
        // a listener failing never un-publishes a row: the webhook path and the pull feed still carry the event
        log(`[outbox] listener failed (${err instanceof Error ? err.name : 'unknown'})`);
      }
    }
  }

  async function deliverOne(d: DueDelivery, at: Date): Promise<DeliveryOutcome> {
    const s = d.subscription;
    if (s.deleted || s.clientDeleted) {
      await deps.store.markDead(d.id, { httpStatus: null, responseMs: null });
      return 'DEAD';
    }
    if (!s.active || !s.clientActive) {
      if (at.getTime() - d.createdAt.getTime() >= cfg.retentionMs) {
        await deps.store.markDead(d.id, { httpStatus: null, responseMs: null });
        return 'DEAD';
      }
      await deps.store.defer(d.id, new Date(at.getTime() + cfg.pauseRecheckMs));
      return 'DEFERRED';
    }

    let secret: string | null = null;
    try {
      secret = deps.secrets.open(s.secretEncrypted, webhookSecretAad(s.id));
    } catch {
      log(`[outbox] delivery ${d.id}: webhook secret does not open`); // ids only, never the sealed value
    }
    const result =
      secret === null
        ? { ok: false, httpStatus: null, responseMs: 0 }
        : await (async () => {
            const body = envelopeBody(d.payload, d.sequence);
            const headers = webhookHeaders({
              eventId: d.eventId,
              eventType: d.eventType,
              attempt: d.attempt,
              secret,
              rawBody: body,
              now: at,
            });
            return deps.transport.send({ url: s.url, headers, body, timeoutMs: cfg.timeoutMs });
          })();

    if (result.ok) {
      await deps.store.markDelivered(d.id, {
        httpStatus: result.httpStatus,
        responseMs: result.responseMs,
        at,
      });
      return 'DELIVERED';
    }
    const next = d.attempt >= MAX_ATTEMPTS ? null : nextAttemptAfter(d.attempt, at);
    if (next === null) {
      await deps.store.markDead(d.id, {
        httpStatus: result.httpStatus,
        responseMs: result.responseMs,
        alert: {
          clientId: s.clientId,
          detail: {
            deliveryId: d.id,
            subscriptionId: s.id,
            eventId: d.eventId,
            eventType: d.eventType,
            attempts: d.attempt,
            lastHttpStatus: result.httpStatus,
          },
        },
      });
      return 'DEAD';
    }
    await deps.store.markRetry(d.id, {
      attempt: d.attempt,
      httpStatus: result.httpStatus,
      responseMs: result.responseMs,
      nextAttemptAt: next,
    });
    return 'RETRY';
  }

  return {
    async publish() {
      let total = 0;
      for (let i = 0; i < cfg.maxBatchesPerRun; i++) {
        const rows = await deps.store.publishBatch(cfg.batchSize, now());
        if (rows.length === 0) break;
        total += rows.length;
        await notify(rows);
        if (rows.length < cfg.batchSize) break;
      }
      return total;
    },

    async deliver() {
      const counts: Record<DeliveryOutcome, number> = {
        DELIVERED: 0,
        RETRY: 0,
        DEAD: 0,
        DEFERRED: 0,
      };
      for (let i = 0; i < cfg.maxBatchesPerRun; i++) {
        const at = now();
        const due = await deps.store.claimDue(
          cfg.batchSize,
          at,
          new Date(at.getTime() + cfg.leaseMs),
        );
        if (due.length === 0) break;
        for (const d of due) counts[await deliverOne(d, now())] += 1;
        if (due.length < cfg.batchSize) break;
      }
      return counts;
    },
  };
}
