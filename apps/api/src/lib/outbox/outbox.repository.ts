import type { Prisma, PrismaClient } from '@prisma/client';
import { uuidv7 } from '../audit';
import { EVENTS_SCOPE, isDeliverableTo, OUTBOUND_EVENTS } from './catalogue';

// Worker-only repository for outbox, webhook_deliveries and integration_alerts (docs 08, 43). No AuthContext: these
// methods run in the worker on system tables, never on behalf of an admin request (same as IdempotencyRepository).
// Row locks use FOR UPDATE SKIP LOCKED so several workers can run side by side without taking the same rows.

export interface PublishedRow {
  id: string;
  sequence: bigint;
  eventType: string;
  zoneId: string | null;
  payload: unknown;
}

export interface DueDelivery {
  id: string;
  attempt: number;
  createdAt: Date;
  eventId: string;
  eventType: string;
  sequence: bigint;
  payload: unknown;
  subscription: {
    id: string;
    url: string;
    secretEncrypted: string;
    active: boolean;
    deleted: boolean;
    clientId: string;
    clientActive: boolean;
    clientDeleted: boolean;
  };
}

interface OutboxLockRow {
  id: string;
  sequence: bigint;
  event_type: string;
  zone_id: string | null;
  payload_json: unknown;
}

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Takes up to `limit` unpublished rows in sequence order, writes one PENDING delivery per matching subscription and
   * marks the rows published, all in one transaction. A matching subscription is not deleted, lists the event type,
   * and belongs to a client that is not deleted, has `events:read` and is a receiver of that type (doc 43 section 4).
   * Paused subscriptions and disabled clients still get the delivery: it waits until they are switched back on
   * (doc 43 section 5, "events keep queueing").
   */
  async publishBatch(limit: number, now: Date): Promise<PublishedRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxLockRow[]>`
        SELECT id, sequence, event_type, zone_id, payload_json
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY sequence
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [];

      const deliverable = [...new Set(rows.map((r) => r.event_type))].filter(
        (t) => OUTBOUND_EVENTS[t] !== undefined,
      );
      const subscriptions =
        deliverable.length === 0
          ? []
          : await tx.webhookSubscription.findMany({
              where: {
                deletedAt: null,
                eventTypes: { hasSome: deliverable },
                client: { deletedAt: null, scopes: { has: EVENTS_SCOPE } },
              },
              select: { id: true, eventTypes: true, client: { select: { type: true } } },
            });

      const deliveries: Prisma.WebhookDeliveryCreateManyInput[] = [];
      for (const row of rows) {
        for (const s of subscriptions) {
          if (!s.eventTypes.includes(row.event_type)) continue;
          if (!isDeliverableTo(row.event_type, s.client.type)) continue;
          deliveries.push({
            id: uuidv7(),
            outboxId: row.id,
            subscriptionId: s.id,
            eventId: row.id, // the payload's eventId is the outbox row id (every writer sets both to the same uuid)
            attempt: 1,
            status: 'PENDING',
            nextAttemptAt: now,
          });
        }
      }
      if (deliveries.length > 0) await tx.webhookDelivery.createMany({ data: deliveries });
      await tx.outbox.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { publishedAt: now, attempts: { increment: 1 } },
      });
      return rows.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        eventType: r.event_type,
        zoneId: r.zone_id,
        payload: r.payload_json,
      }));
    });
  }

  /**
   * Claims up to `limit` deliveries that are due (PENDING or FAILED, next_attempt_at <= now) by moving their
   * next_attempt_at to `leaseUntil` in one statement. The caller then sends them outside any transaction; if the worker
   * dies mid-send the lease runs out and the delivery is tried again (at-least-once, doc 43 section 1).
   */
  async claimDue(limit: number, now: Date, leaseUntil: Date): Promise<DueDelivery[]> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE webhook_deliveries SET next_attempt_at = ${leaseUntil}
      WHERE id IN (
        SELECT id FROM webhook_deliveries
        WHERE status IN ('PENDING', 'FAILED') AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (claimed.length === 0) return [];
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      select: {
        id: true,
        attempt: true,
        createdAt: true,
        eventId: true,
        outbox: { select: { eventType: true, sequence: true, payloadJson: true } },
        subscription: {
          select: {
            id: true,
            url: true,
            secretEncrypted: true,
            status: true,
            deletedAt: true,
            client: { select: { id: true, status: true, deletedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      createdAt: r.createdAt,
      eventId: r.eventId,
      eventType: r.outbox.eventType,
      sequence: r.outbox.sequence,
      payload: r.outbox.payloadJson,
      subscription: {
        id: r.subscription.id,
        url: r.subscription.url,
        secretEncrypted: r.subscription.secretEncrypted,
        active: r.subscription.status === 'ACTIVE',
        deleted: r.subscription.deletedAt !== null,
        clientId: r.subscription.client.id,
        clientActive: r.subscription.client.status === 'ACTIVE',
        clientDeleted: r.subscription.client.deletedAt !== null,
      },
    }));
  }

  async markDelivered(id: string, r: { httpStatus: number | null; responseMs: number; at: Date }) {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        httpStatus: r.httpStatus,
        responseMs: r.responseMs,
        deliveredAt: r.at,
        nextAttemptAt: null,
      },
    });
  }

  /** A failed attempt with another one to come: FAILED, attempt + 1, due at `nextAttemptAt`. */
  async markRetry(
    id: string,
    r: { attempt: number; httpStatus: number | null; responseMs: number; nextAttemptAt: Date },
  ) {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'FAILED',
        attempt: r.attempt + 1,
        httpStatus: r.httpStatus,
        responseMs: r.responseMs,
        nextAttemptAt: r.nextAttemptAt,
      },
    });
  }

  /** Paused subscription or disabled client: try again later, the attempt does not count. */
  async defer(id: string, until: Date) {
    await this.prisma.webhookDelivery.update({ where: { id }, data: { nextAttemptAt: until } });
  }

  /** Dead letter (doc 43): status DEAD and, when `alert` is set, a DEAD_LETTER alert for the client, in one transaction. */
  async markDead(
    id: string,
    r: {
      httpStatus: number | null;
      responseMs: number | null;
      alert?: { clientId: string; detail: Prisma.InputJsonObject };
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDelivery.update({
        where: { id },
        data: {
          status: 'DEAD',
          httpStatus: r.httpStatus,
          responseMs: r.responseMs,
          nextAttemptAt: null,
        },
      });
      if (r.alert) {
        await tx.integrationAlert.create({
          data: {
            id: uuidv7(),
            clientId: r.alert.clientId,
            type: 'DEAD_LETTER',
            detailJson: r.alert.detail,
          },
        });
      }
    });
  }
}
