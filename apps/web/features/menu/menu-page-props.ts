import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the menu pages show a member, from /me (server side): the zones where they may view menus and which actions to
// offer. A convenience only: the API checks menu:* in each item's zone.

export interface MenuPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  /** status: menu:status somewhere, which deciding a food item request needs (the API checks the item's zone) */
  can: { add: boolean; edit: boolean; delete: boolean; status: boolean };
}

export function menuPageProps(me: MeResponse): MenuPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      can: { add: true, edit: true, delete: true, status: true },
    };
  const zones = me.permissions.zones;
  const holds = (action: 'add' | 'edit' | 'delete' | 'status') =>
    zones.some((z) => z.permissions.includes(`menu:${action}`));
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('menu:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: {
      add: holds('add'),
      edit: holds('edit'),
      delete: holds('delete'),
      status: holds('status'),
    },
  };
}
