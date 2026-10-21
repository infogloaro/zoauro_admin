/**
 * Permission keys for M10 Delivery Partners (doc 04 §3 matrix "Delivery
 * Partners", doc 05 `module:action`, doc 09 `/delivery-partners` catalogue:
 * `delivery:*` on GET/POST, `delivery:edit` on PATCH, `delivery:status` on
 * verification and force-offline).
 *
 * Routes declare their key here; enforcement today is role-based (see
 * `delivery-partner.scope.ts`) until SA-1.7 resolves grants per member per
 * zone. Doc 09 lists no DELETE route, so no `delivery:delete` key is used.
 */
export const DELIVERY_PARTNER_PERMISSIONS = {
  view: 'delivery:view',
  add: 'delivery:add',
  edit: 'delivery:edit',
  status: 'delivery:status',
} as const;

export type DeliveryPartnerPermission =
  (typeof DELIVERY_PARTNER_PERMISSIONS)[keyof typeof DELIVERY_PARTNER_PERMISSIONS];
