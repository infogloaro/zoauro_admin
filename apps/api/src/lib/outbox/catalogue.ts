// Which app clients receive which outbound event (doc 43 section 4, contracts/events.catalog.json "to").
// Mirrored here so the worker does not read docs/ at run time; catalogue.unit.test.ts fails when the two drift.
// Event types not listed (admin.zones_changed and other internal events) are never delivered to the apps.

export type AppClientType = 'CUSTOMER_APP' | 'VENDOR_APP' | 'PARTNER_APP';

export const OUTBOUND_EVENTS: Readonly<Record<string, readonly AppClientType[]>> = {
  'order.status_changed': ['CUSTOMER_APP', 'VENDOR_APP', 'PARTNER_APP'],
  'order.assigned': ['PARTNER_APP', 'VENDOR_APP', 'CUSTOMER_APP'],
  'order.reassigned': ['PARTNER_APP', 'CUSTOMER_APP'],
  'order.cancelled': ['CUSTOMER_APP', 'VENDOR_APP', 'PARTNER_APP'],
  'payment.status_changed': ['CUSTOMER_APP'],
  'refund.updated': ['CUSTOMER_APP'],
  'vendor.status_changed': ['VENDOR_APP'],
  'vendor.updated': ['VENDOR_APP'],
  'menu_item.admin_changed': ['VENDOR_APP', 'CUSTOMER_APP'],
  'partner.status_changed': ['PARTNER_APP'],
  'partner.force_offline': ['PARTNER_APP'],
  'partner.updated': ['PARTNER_APP'],
  'customer.status_changed': ['CUSTOMER_APP'],
  'settlement.confirmed': ['PARTNER_APP'],
  'zone.updated': ['CUSTOMER_APP', 'VENDOR_APP', 'PARTNER_APP'],
  'config.changed': ['CUSTOMER_APP', 'VENDOR_APP', 'PARTNER_APP'],
  'broadcast.created': ['CUSTOMER_APP', 'VENDOR_APP', 'PARTNER_APP'],
};

/** The scope every client type holds for outbound events (doc 42 section 2). */
export const EVENTS_SCOPE = 'events:read';

/** True when a client of this type may receive this event type. */
export function isDeliverableTo(eventType: string, clientType: string): boolean {
  const to = OUTBOUND_EVENTS[eventType];
  return to !== undefined && (to as readonly string[]).includes(clientType);
}
