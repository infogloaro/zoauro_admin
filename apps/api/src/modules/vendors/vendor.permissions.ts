/**
 * Permission keys for M06 Restaurants and M07 Homemakers (doc 04 §3 matrix,
 * doc 05 permission keys `module:action`, doc 09 endpoint catalogue).
 *
 * Routes declare their key here; enforcement today is role-based (see
 * `vendor.scope.ts`) until SA-1.7 resolves grants per member per zone.
 */
export const VENDOR_PERMISSIONS = {
  restaurant: {
    view: 'restaurants:view',
    add: 'restaurants:add',
    edit: 'restaurants:edit',
    delete: 'restaurants:delete',
    status: 'restaurants:status',
  },
  homemaker: {
    view: 'homemakers:view',
    add: 'homemakers:add',
    edit: 'homemakers:edit',
    delete: 'homemakers:delete',
    status: 'homemakers:status',
  },
} as const;

type PermissionGroup = (typeof VENDOR_PERMISSIONS)[keyof typeof VENDOR_PERMISSIONS];
export type VendorPermission = PermissionGroup[keyof PermissionGroup];

/** POST /{vendors}/{id}/move-zone (doc 09): `zones:assign`, Super Admin only (R-VEN-3). */
export const MOVE_ZONE_PERMISSION = 'zones:assign';
