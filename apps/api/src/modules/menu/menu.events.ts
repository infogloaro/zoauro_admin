import type { MenuChangeKind } from '@zoauro/shared';
import { uuidv7 } from '../../lib/audit';
import type { OutboxRow } from './menu.repository';

// Menu events for the apps (contracts/events.catalog.json, doc 43), written to the outbox in the change's own
// transaction:
//  - menu_item.admin_changed (vendor, customer): an admin disabled or re-enabled an item (D126)
//  - menu_item.change_decided (vendor, D125): a vendor change request was approved or rejected (with the reason)
// `itemId` is the vendor app's id when the item came from an app (external_refs), else ours; `menuItemId` is always ours.
// Menu items carry no version column, so aggregate.version is updatedAt in milliseconds (as vendors, doc 32).

export const MENU_ITEM_ADMIN_CHANGED = 'menu_item.admin_changed';
export const MENU_ITEM_CHANGE_DECIDED = 'menu_item.change_decided';

function envelope(
  type: string,
  agg: { type: string; id: string; version: number },
  audience: { vendorId: string; zoneId: string },
  actorId: string,
  occurredAt: Date,
  data: Record<string, unknown>,
): OutboxRow {
  const id = uuidv7();
  return {
    id,
    eventType: type,
    zoneId: audience.zoneId,
    payload: {
      eventId: id,
      type,
      schemaVersion: 1,
      occurredAt: occurredAt.toISOString(),
      aggregate: agg,
      audience,
      actor: { type: 'ADMIN', id: actorId },
      data,
    },
  };
}

export function adminChangedRow(
  item: {
    id: string;
    zoneId: string;
    vendorId: string;
    updatedAt: Date;
    externalId: string | null;
  },
  adminDisabled: boolean,
  reason: string | undefined,
  actorId: string,
  at: Date,
): OutboxRow {
  return envelope(
    MENU_ITEM_ADMIN_CHANGED,
    { type: 'menu_item', id: item.id, version: item.updatedAt.getTime() },
    { vendorId: item.vendorId, zoneId: item.zoneId },
    actorId,
    at,
    {
      itemId: item.externalId ?? item.id,
      menuItemId: item.id,
      adminDisabled,
      ...(reason ? { reason } : {}),
    },
  );
}

export function changeDecidedRow(
  req: {
    id: string;
    zoneId: string;
    vendorId: string;
    kind: MenuChangeKind;
    version: number;
    externalItemId: string | null;
    menuItemId: string | null;
  },
  decision: 'APPROVED' | 'REJECTED',
  reason: string | undefined,
  actorId: string,
  at: Date,
): OutboxRow {
  return envelope(
    MENU_ITEM_CHANGE_DECIDED,
    { type: 'menu_item_change_request', id: req.id, version: req.version },
    { vendorId: req.vendorId, zoneId: req.zoneId },
    actorId,
    at,
    {
      requestId: req.id,
      kind: req.kind,
      decision,
      itemId: req.externalItemId ?? req.menuItemId,
      menuItemId: req.menuItemId,
      ...(reason ? { reason } : {}),
    },
  );
}
