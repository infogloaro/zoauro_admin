import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the partner pages show a member, from /me (server side): the zones where they may view partners (delivery:view)
// and which buttons to offer. A convenience only: the API checks delivery:* in the partner's zone on every request.

export interface PartnerPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  canAdd: boolean;
  can: { edit: boolean; status: boolean; delete: boolean; reveal: boolean };
}

export function partnerPageProps(me: MeResponse): PartnerPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      canAdd: true,
      can: { edit: true, status: true, delete: true, reveal: true },
    };
  const zones = me.permissions.zones;
  const holds = (action: 'add' | 'edit' | 'status' | 'delete') =>
    zones.some((z) => z.permissions.includes(`delivery:${action}`));
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('delivery:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    canAdd: holds('add'),
    can: {
      edit: holds('edit'),
      status: holds('status'),
      delete: holds('delete'),
      reveal: zones.some((z) => z.limits.canReveal),
    },
  };
}
