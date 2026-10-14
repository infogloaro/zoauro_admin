import type { ZoneDto } from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import type { OutboxRow } from './zones.repository';

// Events of a zone change (doc 53 section 2.5), written to the outbox in the change's own transaction (R-ZONE-10):
//  - zone.updated (contracts/events.catalog.json) for the customer, vendor and partner apps;
//  - admin.zones_changed, internal: admin web cache invalidation and workers. Never delivered to the apps.
// The outbox publisher (worker, not built yet) adds `sequence` from the row and delivers the envelope of doc 43 section 2.

export const ZONE_UPDATED = 'zone.updated';
export const ADMIN_ZONES_CHANGED = 'admin.zones_changed';

export type ZoneChange =
  | 'created'
  | 'updated'
  | 'delivery_charge_changed'
  | 'pincodes_changed'
  | 'activated'
  | 'deactivated'
  | 'deleted'
  /** D92: a service switched on or off; internal only until the apps' contract carries services (doc 32) */
  | 'services_changed';

/**
 * `pincodeRange` of the catalogue is one string and cannot express a list (doc 53 section 2.5): the range when the
 * zone is defined by its range alone, "multiple" when it has other pincodes, "" when it has none. pincodeCount is
 * not sent (D87 needs the app teams).
 */
export function pincodeRangeOf(z: ZoneDto, onlyRangeRows: boolean): string {
  if (z.pincodeCount === 0) return '';
  if (z.pincodeFrom && z.pincodeTo && onlyRangeRows) return `${z.pincodeFrom}-${z.pincodeTo}`;
  return 'multiple';
}

export function zoneEventRows(input: {
  zone: ZoneDto;
  change: ZoneChange;
  actorId: string;
  occurredAt: Date;
  /** every pincode of the zone came from its range (source RANGE) */
  onlyRangeRows: boolean;
}): OutboxRow[] {
  const { zone, change } = input;
  const occurredAt = input.occurredAt.toISOString();
  const updatedId = uuidv7();
  const internalId = uuidv7();
  return [
    {
      id: updatedId,
      eventType: ZONE_UPDATED,
      zoneId: zone.id,
      payload: {
        eventId: updatedId,
        type: ZONE_UPDATED,
        schemaVersion: 1,
        occurredAt,
        aggregate: { type: 'zone', id: zone.id, version: zone.version },
        audience: { zoneId: zone.id },
        actor: { type: 'ADMIN', id: input.actorId },
        data: {
          zoneId: zone.id,
          name: zone.name,
          // a deleted zone is closed for the apps, like an inactive one (D87: they need not know why)
          status: change === 'deleted' ? 'INACTIVE' : zone.status,
          pincodeRange: change === 'deleted' ? '' : pincodeRangeOf(zone, input.onlyRangeRows),
          deliveryChargePaise: zone.deliveryChargePaise,
        },
      },
    },
    {
      id: internalId,
      eventType: ADMIN_ZONES_CHANGED,
      zoneId: zone.id,
      payload: {
        eventId: internalId,
        type: ADMIN_ZONES_CHANGED,
        schemaVersion: 1,
        occurredAt,
        actor: { type: 'ADMIN', id: input.actorId },
        data: { zoneId: zone.id, change },
      },
    },
  ];
}

/** admin.zones_changed alone: a change the apps are not told about (yet), such as the D92 service switches. */
export function zoneInternalEventRow(input: {
  zoneId: string;
  change: ZoneChange;
  actorId: string;
  occurredAt: Date;
}): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: ADMIN_ZONES_CHANGED,
    zoneId: input.zoneId,
    payload: {
      eventId: id,
      type: ADMIN_ZONES_CHANGED,
      schemaVersion: 1,
      occurredAt: input.occurredAt.toISOString(),
      actor: { type: 'ADMIN', id: input.actorId },
      data: { zoneId: input.zoneId, change: input.change },
    },
  };
}

/** The global counter the resolver cache is keyed with (doc 53 section 2.3). Bumped after every committed change. */
export interface ZonesCacheVersion {
  bump(): Promise<void>;
}

export const ZONES_VERSION_KEY = 'zones:version';

export function redisZonesCacheVersion(redis: {
  incr(key: string): Promise<number>;
}): ZonesCacheVersion {
  return {
    bump: async () => {
      await redis.incr(ZONES_VERSION_KEY);
    },
  };
}
