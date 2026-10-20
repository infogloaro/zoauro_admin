import type { RescheduleOrderInput, RescheduleOrderResponse } from '@zoauro/shared';
import { record, runAsSystem, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import {
  dispatchAtFor,
  preorderWindowIssue,
  rescheduleBlocker,
  type PreorderRules,
} from './preorder.rules';
import type { OutboxRow, PreorderRow, PreordersDatabase } from './preorders.repository';

// Pre-orders (D150, D167). An admin reschedules a pre-order (orders:edit in its zone, If-Match version) inside the
// `orders.preorder` window and before the cut-off; the dispatch sweep (every 60 s, SYSTEM) releases each due pre-order
// to the vendor and partner apps (order.released). Cancel is the ordinary order cancel. Pre-orders are created by the
// intake module (customer app) only.

const notFound = () => new AppError('NOT_FOUND', 'Not found');
/** Orders released per sweep transaction; the next sweep takes the rest. */
export const RELEASE_BATCH = 50;

export interface PreordersDeps {
  db: PreordersDatabase;
  /** settings `orders.preorder` of a zone (SettingsReader.preorderRules) */
  rules: (zoneId: string) => Promise<PreorderRules>;
  clock: () => Date;
}

export class PreordersService {
  constructor(private readonly deps: PreordersDeps) {}

  async reschedule(
    ctx: AuthContext,
    id: string,
    version: number,
    input: RescheduleOrderInput,
  ): Promise<RescheduleOrderResponse> {
    const seen = await this.deps.db.repo.find(ctx, id);
    if (!seen) throw notFound();
    assertCanWrite(ctx, 'orders:edit', seen.zoneId);
    const rules = await this.deps.rules(seen.zoneId);
    const scheduledFor = new Date(input.scheduledFor);
    const after = await this.deps.db.transaction(async (tx) => {
      const current = await tx.repo.lock(id);
      if (!current) throw notFound();
      if (current.version !== version)
        throw new AppError(
          'STALE_VERSION',
          'The order changed since it was read',
          undefined,
          undefined,
          {
            current: { status: current.status, version: current.version },
          },
        );
      const now = this.deps.clock();
      if (current.status !== 'PLACED')
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'Only a placed pre-order can be rescheduled',
          [{ field: 'scheduledFor', issue: 'RELEASED' }],
        );
      const blocker = rescheduleBlocker(current, now, rules);
      if (blocker)
        throw new AppError('INVALID_STATE_TRANSITION', blockerMessage(blocker), [
          { field: 'scheduledFor', issue: blocker },
        ]);
      const window = preorderWindowIssue(scheduledFor, now, rules);
      if (window)
        throw new AppError(
          'VALIDATION_ERROR',
          window === 'TOO_SOON'
            ? `Choose a time at least ${rules.minLeadMinutes} minutes ahead`
            : `Choose a time within ${rules.maxAheadDays} days`,
          [{ field: 'scheduledFor', issue: window }],
        );
      const dispatchAt = dispatchAtFor(scheduledFor, now, rules);
      await tx.repo.reschedule(id, { scheduledFor, dispatchAt });
      const updated = await tx.repo.lock(id);
      if (!updated) throw notFound();
      await record(tx.audit, {
        module: 'orders',
        action: 'order.rescheduled',
        entity: { type: 'order', id, label: updated.orderNo, zoneId: updated.zoneId },
        before: {
          scheduledFor: current.scheduledFor.toISOString(),
          dispatchAt: current.dispatchAt.toISOString(),
        },
        after: {
          scheduledFor: updated.scheduledFor.toISOString(),
          dispatchAt: updated.dispatchAt.toISOString(),
        },
        note: input.reason,
      });
      await tx.repo.insertOutbox([
        event('order.rescheduled', updated, { type: 'ADMIN', id: ctx.userId }, now, {
          scheduledFor: updated.scheduledFor.toISOString(),
          dispatchAt: updated.dispatchAt.toISOString(),
          rescheduleCount: updated.rescheduleCount,
        }),
      ]);
      return updated;
    });
    return { id: after.id, version: after.version, preorder: preorderInfo(after) };
  }

  /** The 60 s dispatch sweep: releases every due pre-order (batches of RELEASE_BATCH); returns how many. */
  async sweep(): Promise<{ released: number }> {
    return runAsSystem('preorder-dispatch', async () => {
      let released = 0;
      for (;;) {
        const n = await this.deps.db.transaction(async (tx) => {
          const now = this.deps.clock();
          const due = await tx.repo.lockDue(now, RELEASE_BATCH);
          for (const o of due) {
            const version = await tx.repo.release(o.id, now);
            await record(tx.audit, {
              module: 'system',
              action: 'job.preorder_released',
              entity: { type: 'order', id: o.id, label: o.orderNo, zoneId: o.zoneId },
              after: {
                scheduledFor: o.scheduledFor.toISOString(),
                dispatchAt: o.dispatchAt.toISOString(),
              },
            });
            await tx.repo.insertOutbox([
              event('order.released', { ...o, version }, { type: 'SYSTEM', id: null }, now, {
                scheduledFor: o.scheduledFor.toISOString(),
                dispatchAt: o.dispatchAt.toISOString(),
                ...(o.deliveryLat !== null && o.deliveryLng !== null
                  ? {
                      deliveryLocation: {
                        lat: o.deliveryLat,
                        lng: o.deliveryLng,
                        address: o.deliveryAddress,
                      },
                    }
                  : {}),
              }),
            ]);
          }
          return due.length;
        });
        released += n;
        if (n < RELEASE_BATCH) return { released };
      }
    });
  }
}

function blockerMessage(b: 'RELEASED' | 'PAST_CUTOFF' | 'TOO_MANY_RESCHEDULES'): string {
  if (b === 'RELEASED') return 'The pre-order is already with the vendor';
  if (b === 'PAST_CUTOFF') return 'It is too close to dispatch to reschedule';
  return 'This pre-order cannot be rescheduled again';
}

function preorderInfo(o: PreorderRow): RescheduleOrderResponse['preorder'] {
  return {
    scheduledFor: o.scheduledFor.toISOString(),
    dispatchAt: o.dispatchAt.toISOString(),
    releasedAt: o.releasedAt?.toISOString() ?? null,
    rescheduleCount: o.rescheduleCount,
    deliveryAddress: o.deliveryAddress,
    deliveryLat: o.deliveryLat,
    deliveryLng: o.deliveryLng,
  };
}

/** Outbox envelope as orders.events.ts (doc 43); the vendor and partner are resolved by the publisher from the order. */
function event(
  type: string,
  o: { id: string; zoneId: string; version: number },
  actor: { type: 'ADMIN' | 'SYSTEM'; id: string | null },
  at: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: type,
    zoneId: o.zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: at.toISOString(),
      aggregate: { type: 'order', id: o.id, version: o.version },
      audience: { zoneId: o.zoneId, orderId: o.id },
      actor,
      data,
    },
  };
}
