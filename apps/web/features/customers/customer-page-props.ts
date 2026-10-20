import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the customer pages show a member, from /me (server side): their zones and which buttons to offer. A convenience
// only: the API checks every request against customers:{action} in the customer's zone and the reveal flag (D26).

export interface CustomerPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view customers */
  myZones: ScopeZone[];
  /** zones where the member may add a customer (the first address goes there, D25) */
  addZones: ScopeZone[];
  can: { add: boolean; edit: boolean; status: boolean; reveal: boolean };
}

export function customerPageProps(me: MeResponse): CustomerPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      addZones: [],
      can: { add: true, edit: true, status: true, reveal: true },
    };
  const zones = me.permissions.zones;
  const toScope = (z: (typeof zones)[number]): ScopeZone => ({
    id: z.zoneId,
    name: z.name,
    code: z.code,
    colorHex: z.colorHex,
  });
  const viewable = zones.filter((z) => z.permissions.includes('customers:view'));
  return {
    role: 'ZONAL_ADMIN',
    myZones: viewable.map(toScope),
    addZones: zones.filter((z) => z.permissions.includes('customers:add')).map(toScope),
    can: {
      add: zones.some((z) => z.permissions.includes('customers:add')),
      edit: zones.some((z) => z.permissions.includes('customers:edit')),
      status: zones.some((z) => z.permissions.includes('customers:status')),
      reveal: viewable.some((z) => z.limits.canReveal),
    },
  };
}
