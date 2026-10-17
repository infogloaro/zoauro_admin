import { uuidv7 } from '../../lib/audit';
import type { OutboxRow, PartnerRecord } from './partners.repository';

// Partner events for the partner app (contracts/events.catalog.json, doc 43), written to the outbox in the change's own
// transaction (doc 44: the admin owns status, verification, force-offline and the zone):
//  - partner.status_changed {verificationStatus, status, note?}: verified, rejected (+note), activated, deactivated,
//    suspended
//  - partner.force_offline {reason, until}
//  - partner.updated {fields: {zoneId, zoneName}}: a zone move (D131)
// aggregate.version is the D130 version column: receivers apply only a newer one.

export const PARTNER_STATUS_CHANGED = 'partner.status_changed';
export const PARTNER_FORCE_OFFLINE = 'partner.force_offline';
export const PARTNER_UPDATED = 'partner.updated';

function envelope(
  type: string,
  p: PartnerRecord,
  actorId: string,
  occurredAt: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: type,
    zoneId: p.zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: occurredAt.toISOString(),
      aggregate: { type: 'partner', id: p.id, version: p.version },
      audience: { partnerId: p.id, zoneId: p.zoneId },
      actor: { type: 'ADMIN', id: actorId },
      data,
    },
  };
}

/** After a status or verification change; `p` is the row as it is now. */
export function partnerStatusChangedRow(p: PartnerRecord, actorId: string, at: Date): OutboxRow {
  return envelope(PARTNER_STATUS_CHANGED, p, actorId, at, {
    verificationStatus: p.verificationStatus,
    status: p.status,
    ...(p.verificationStatus === 'REJECTED' && p.verificationNote
      ? { note: p.verificationNote }
      : {}),
  });
}

export function partnerForceOfflineRow(
  p: PartnerRecord,
  actorId: string,
  at: Date,
  reason: string,
  until: Date,
): OutboxRow {
  return envelope(PARTNER_FORCE_OFFLINE, p, actorId, at, { reason, until: until.toISOString() });
}

export function partnerUpdatedRow(
  p: PartnerRecord,
  actorId: string,
  at: Date,
  fields: { zoneId: string; zoneName: string },
): OutboxRow {
  return envelope(PARTNER_UPDATED, p, actorId, at, { fields });
}
