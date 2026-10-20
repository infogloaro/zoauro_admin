import { uuidv7 } from '../../lib/audit';

// admin.zones_changed for a member (doc 10: `userId, added[], removed[]`), written to the outbox in the change's own
// transaction. Internal only: admin web cache invalidation, socket rooms (scope.changed, M17) and workers. The zones
// module uses the same event type with `{zoneId, change}` for a zone's own changes (doc 53); the two payloads are told
// apart by `userId` vs `zoneId` (doc 32). `changed` = zones whose permissions or limits changed (D107).

export const ADMIN_ZONES_CHANGED = 'admin.zones_changed';

export function memberScopeEvent(input: {
  userId: string;
  added: readonly string[];
  removed: readonly string[];
  changed: readonly string[];
  actorId: string;
  occurredAt: Date;
}): { id: string; eventType: string; payload: Record<string, unknown> } {
  const id = uuidv7();
  return {
    id,
    eventType: ADMIN_ZONES_CHANGED,
    payload: {
      eventId: id,
      type: ADMIN_ZONES_CHANGED,
      schemaVersion: 1,
      occurredAt: input.occurredAt.toISOString(),
      actor: { type: 'ADMIN', id: input.actorId },
      data: {
        userId: input.userId,
        added: [...input.added],
        removed: [...input.removed],
        changed: [...input.changed],
      },
    },
  };
}
