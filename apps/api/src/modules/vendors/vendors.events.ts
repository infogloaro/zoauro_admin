import { uuidv7 } from '../../lib/audit';
import type { OutboxRow, VendorRecord } from './vendors.repository';

// Vendor events for the vendor app (contracts/events.catalog.json, doc 43), written to the outbox in the change's own
// transaction (doc 44: the admin owns status, verification, commission and zone):
//  - vendor.status_changed: verified, rejected (+note), activated, deactivated, suspended
//  - vendor.updated: admin-owned fields changed (commissionPct, zoneId, zoneName)
// Vendors carry no version column, so aggregate.version is the row's updatedAt in milliseconds (monotonic per row;
// receivers apply only a newer version, doc 32). The publisher adds `sequence`.

export const VENDOR_STATUS_CHANGED = 'vendor.status_changed';
export const VENDOR_UPDATED = 'vendor.updated';

function envelope(
  type: string,
  v: VendorRecord,
  actorId: string,
  occurredAt: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: type,
    zoneId: v.zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: occurredAt.toISOString(),
      aggregate: {
        type: v.module === 'restaurants' ? 'restaurant' : 'homemaker',
        id: v.id,
        version: v.updatedAt.getTime(),
      },
      audience: { vendorId: v.id, zoneId: v.zoneId },
      actor: { type: 'ADMIN', id: actorId },
      data,
    },
  };
}

/** After a status or verification change; `v` is the row as it is now. */
export function statusChangedRow(v: VendorRecord, actorId: string, at: Date): OutboxRow {
  return envelope(VENDOR_STATUS_CHANGED, v, actorId, at, {
    verificationStatus: v.verificationStatus,
    status: v.status,
    ...(v.verificationStatus === 'REJECTED' && v.verificationNote
      ? { note: v.verificationNote }
      : {}),
  });
}

/** After a commission or zone change; `fields` holds only what changed. */
export function updatedRow(
  v: VendorRecord,
  actorId: string,
  at: Date,
  fields: { commissionPct?: number; zoneId?: string; zoneName?: string },
): OutboxRow {
  return envelope(VENDOR_UPDATED, v, actorId, at, { fields });
}
