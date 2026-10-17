/**
 * Permission keys for the Hotel Room Booking module (task: Hotel Room Booking
 * Management; doc 05 `module:action` style). Hotels reuse the vendor
 * lifecycle keys' shape; bookings and dining have their own action sets.
 *
 * Routes declare their key here; enforcement today is role-based (see
 * `hotel.scope.ts`) until SA-1.7 resolves grants per member per zone.
 */
export const HOTEL_PERMISSIONS = {
  hotels: {
    view: 'hotels:view',
    add: 'hotels:add',
    edit: 'hotels:edit',
    delete: 'hotels:delete',
    status: 'hotels:status',
  },
  bookings: {
    view: 'bookings:view',
    add: 'bookings:add',
    status: 'bookings:status',
  },
  dining: {
    view: 'dining:view',
    add: 'dining:add',
    status: 'dining:status',
  },
} as const;

export type HotelModuleKey = keyof typeof HOTEL_PERMISSIONS;
type PermissionGroup = (typeof HOTEL_PERMISSIONS)[HotelModuleKey];
export type HotelPermission = PermissionGroup[keyof PermissionGroup];
