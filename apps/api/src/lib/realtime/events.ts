import type { PermissionModule } from '@zoauro/shared';

// Which outbox events reach the admin panel over Socket.IO, and to whom (doc 06 section 6, doc 36 section 5).
// A message names the zone and the module whose view permission a member needs in that zone to receive it; the
// payload carries ids and minimal fields only, the client refetches through the normal scoped API.
// Doc 06 lists order.created, order.status_changed, refund.pending_approval and partner.availability_changed; only
// order.status_changed is written to the outbox today. The others join this table when their writers exist.

export type RealtimeMessage =
  | {
      kind: 'zone';
      zoneId: string;
      module: PermissionModule;
      event: string;
      payload: Record<string, unknown>;
    }
  /** a member's zones or permissions changed (admin.zones_changed with userId, doc 10 / doc 14): re-join rooms */
  | { kind: 'scope'; userId: string }
  /** sessions revoked, logged out or expired (D142): their sockets are disconnected at once */
  | { kind: 'evict'; tokenHashes: string[] };

interface OutboxLike {
  eventType: string;
  zoneId: string | null;
  payload: unknown;
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function realtimeMessagesOf(row: OutboxLike): RealtimeMessage[] {
  const payload = obj(row.payload);
  const data = obj(payload['data']);
  if (row.eventType === 'order.status_changed') {
    const orderId = str(obj(payload['aggregate'])['id']);
    if (!row.zoneId || !orderId) return [];
    return [
      {
        kind: 'zone',
        zoneId: row.zoneId,
        module: 'orders',
        event: 'order.status_changed',
        payload: {
          orderId,
          zoneId: row.zoneId,
          from: data['from'] ?? null,
          to: data['to'] ?? null,
        },
      },
    ];
  }
  if (row.eventType === 'admin.ticket_changed') {
    // support desk (D139-D140): ids and what changed; the client refetches the ticket through the scoped API
    const ticketId = str(data['ticketId']);
    if (!row.zoneId || !ticketId) return [];
    return [
      {
        kind: 'zone',
        zoneId: row.zoneId,
        module: 'support',
        event: 'support.ticket_changed',
        payload: {
          ticketId,
          zoneId: row.zoneId,
          change: str(data['change']),
          assigneeId: str(data['assigneeId']),
        },
      },
    ];
  }
  if (row.eventType === 'admin.zones_changed') {
    const userId = str(data['userId']);
    return userId ? [{ kind: 'scope', userId }] : [];
  }
  return [];
}

// Room names. Rooms are joined by the server only; a client can never ask for one (doc 06 section 6).
export const zoneRoom = (zoneId: string, module: PermissionModule) => `zone:${zoneId}:${module}`;
export const allZonesRoom = (module: PermissionModule) => `all:${module}`;
export const userRoom = (userId: string) => `user:${userId}`;
