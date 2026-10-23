import type { PromotionStatus } from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import type { OfferRow, OutboxRow } from './offers.repository';

// Offer events for the apps (contracts/events.catalog.json, doc 43 §4), written to the outbox in the change's own
// transaction:
//  - offer.status_changed (customer and vendor apps): the offer became ACTIVE, PAUSED, EXPIRED or CANCELLED, the states
//    an app shows or hides. SCHEDULED, DRAFT, PENDING_APPROVAL and REJECTED are admin-only and send nothing.
//  - offer.decided (vendor app): an offer the vendor app submitted was approved or rejected.
// aggregate.version is the offer's version after the change. One zone: the zone's feed; several or every zone: none.

export const OFFER_STATUS_CHANGED = 'offer.status_changed';
export const OFFER_DECIDED = 'offer.decided';

/** The states the apps are told about (doc 43). */
export const APP_VISIBLE: readonly PromotionStatus[] = ['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'];

type Actor = { type: 'ADMIN' | 'SYSTEM' | 'APP_CLIENT'; id: string | null };

function envelope(
  type: string,
  o: OfferRow,
  version: number,
  actor: Actor,
  at: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  const vendorId = o.restaurantId ?? o.homemakerId;
  const zoneId = o.zoneIds.length === 1 ? (o.zoneIds[0] ?? null) : null;
  return {
    id,
    eventType: type,
    zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: at.toISOString(),
      aggregate: { type: 'offer', id: o.id, version },
      audience: { vendorId: vendorId ?? null, zoneId },
      actor,
      data,
    },
  };
}

/** offer.status_changed when `to` is one the apps show; otherwise nothing. `o` is the row before the change. */
export function statusChangedRows(
  o: OfferRow,
  to: PromotionStatus,
  version: number,
  actor: Actor,
  at: Date,
  validTo: Date = o.validTo,
): OutboxRow[] {
  if (!APP_VISIBLE.includes(to) || o.status === to) return [];
  return [
    envelope(OFFER_STATUS_CHANGED, o, version, actor, at, {
      offerId: o.id,
      from: o.status,
      to,
      scope: o.scope,
      zoneIds: o.zoneIds,
      vendorId: o.restaurantId ?? o.homemakerId ?? null,
      code: o.code,
      validTo: validTo.toISOString(),
    }),
  ];
}

/** offer.decided for an offer the vendor app submitted (source APP); otherwise nothing. */
export function decidedRows(
  o: OfferRow,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
  version: number,
  actor: Actor,
  at: Date,
): OutboxRow[] {
  if (o.source !== 'APP') return [];
  return [
    envelope(OFFER_DECIDED, o, version, actor, at, {
      offerId: o.id,
      decision,
      ...(reason ? { reason } : {}),
    }),
  ];
}
