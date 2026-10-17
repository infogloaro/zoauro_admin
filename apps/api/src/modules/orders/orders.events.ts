import type { OrderStatus } from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import type { OutboxRow } from './orders.repository';

// Outbox rows of an admin order write (contracts/events.catalog.json; doc 10: written in the same transaction as the
// change). The apps apply an event only when aggregate.version is newer. Ids are the Core's UUIDs: the publisher maps
// them to each app's own externalId (ExternalRef is per client) when it delivers.

export type OrderEventExtra =
  | { type: 'order.assigned'; partnerId: string; partnerName: string }
  | { type: 'order.reassigned'; fromPartnerId: string; toPartnerId: string }
  | { type: 'order.cancelled'; reasonCode: string; refundExpected: boolean };

export function orderEventRows(input: {
  orderId: string;
  zoneId: string;
  version: number;
  actorId: string;
  occurredAt: Date;
  /** null when the status did not change (a reassignment) */
  status: { from: OrderStatus; to: OrderStatus; note: string | null } | null;
  extra?: OrderEventExtra;
}): OutboxRow[] {
  const occurredAt = input.occurredAt.toISOString();
  const row = (type: string, data: Record<string, unknown>): OutboxRow => {
    const id = uuidv7();
    return {
      id,
      eventType: type,
      zoneId: input.zoneId,
      payload: {
        eventId: id,
        type,
        schemaVersion: 1,
        occurredAt,
        aggregate: { type: 'order', id: input.orderId, version: input.version },
        audience: { zoneId: input.zoneId, orderId: input.orderId },
        actor: { type: 'ADMIN', id: input.actorId },
        data,
      },
    };
  };
  const rows: OutboxRow[] = [];
  if (input.status) {
    rows.push(
      row('order.status_changed', {
        from: input.status.from,
        to: input.status.to,
        ...(input.status.note ? { note: input.status.note } : {}),
      }),
    );
  }
  const extra = input.extra;
  if (extra?.type === 'order.assigned') {
    rows.push(row(extra.type, { partnerId: extra.partnerId, partnerName: extra.partnerName }));
  } else if (extra?.type === 'order.reassigned') {
    rows.push(
      row(extra.type, { fromPartnerId: extra.fromPartnerId, toPartnerId: extra.toPartnerId }),
    );
  } else if (extra?.type === 'order.cancelled') {
    rows.push(
      row(extra.type, {
        reasonCode: extra.reasonCode,
        cancelledBy: 'ADMIN',
        refundExpected: extra.refundExpected,
      }),
    );
  }
  return rows;
}
