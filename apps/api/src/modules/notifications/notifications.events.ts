import type { NotificationChannel } from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import type { NotificationRecord, OutboxRow } from './notifications.repository';

// broadcast.created (contracts/events.catalog.json, doc 43, D136): emitted at send time, one per zone. The apps deliver
// it as push / SMS / in-app to their own users (doc 41 F5: the panel holds no device tokens). EMAIL is the panel's own
// channel and is not in the event.

export const BROADCAST_CREATED = 'broadcast.created';

export function broadcastCreatedRow(
  n: NotificationRecord,
  zoneId: string,
  channels: readonly NotificationChannel[],
  at: Date,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: BROADCAST_CREATED,
    zoneId,
    payload: {
      eventId: id,
      type: BROADCAST_CREATED,
      schemaVersion: 1,
      occurredAt: at.toISOString(),
      aggregate: { type: 'notification', id: n.id, version: n.version },
      audience: { zoneId },
      actor: { type: 'ADMIN', id: n.requestedBy },
      data: {
        audienceType: n.audience,
        zoneIds: [zoneId],
        title: n.title,
        body: n.body,
        channels: channels.filter((c) => c !== 'EMAIL'),
        sendAt: at.toISOString(),
      },
    },
  };
}
