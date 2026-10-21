import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the COD settlement page shows a member, from /me (server side). A convenience only: the API checks
// settlements:view / add / edit on the partner's own zone (404 outside the member's zones, 403 without the action).

export interface CodPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view settlements */
  myZones: ScopeZone[];
  can: { add: boolean; edit: boolean };
}

export function codPageProps(me: MeResponse): CodPageProps {
  if (me.permissions.global)
    return { role: 'SUPER_ADMIN', myZones: [], can: { add: true, edit: true } };
  const zones = me.permissions.zones;
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('settlements:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: {
      add: zones.some((z) => z.permissions.includes('settlements:add')),
      edit: zones.some((z) => z.permissions.includes('settlements:edit')),
    },
  };
}
