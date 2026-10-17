import type { MeResponse, VendorModule } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the vendor pages show a member, from /me (server side): their zones and which buttons to offer. A convenience
// only: the API checks every request against the member's permissions in the vendor's zone.

export interface VendorPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  canAdd: boolean;
  /** edit/status/delete: {module}:{action} somewhere; reveal: the reveal flag somewhere (D123) */
  can: { edit: boolean; status: boolean; delete: boolean; reveal: boolean };
}

export function vendorPageProps(me: MeResponse, module: VendorModule): VendorPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      canAdd: true,
      can: { edit: true, status: true, delete: true, reveal: true },
    };
  const zones = me.permissions.zones;
  const holds = (action: 'add' | 'edit' | 'status' | 'delete') =>
    zones.some((z) => z.permissions.includes(`${module}:${action}`));
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes(`${module}:view`))
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
