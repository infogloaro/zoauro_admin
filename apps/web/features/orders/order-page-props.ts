import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the order pages show a member, from /me (server side): the zones where they may view orders and whether status
// buttons are offered. A convenience only: the API checks orders:view / orders:status / orders:edit per order zone.

export interface OrderPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  /** orders:status (moves, cancel) and orders:edit (assign a partner) somewhere */
  can: { status: boolean; assign: boolean };
}

export function orderPageProps(me: MeResponse): OrderPageProps {
  if (me.permissions.global)
    return { role: 'SUPER_ADMIN', myZones: [], can: { status: true, assign: true } };
  const zones = me.permissions.zones;
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('orders:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: {
      status: zones.some((z) => z.permissions.includes('orders:status')),
      assign: zones.some((z) => z.permissions.includes('orders:edit')),
    },
  };
}
