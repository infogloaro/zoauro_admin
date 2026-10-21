import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the vendor plan pages show a member, from /me (server side). A convenience only: the API keeps every catalogue
// write and every subscription change to Super Admins (`plans` is view-grantable only, D188) and scopes the vendors on
// a plan to the member's plans:view zones.

export interface PlanPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view plans (empty for a Super Admin: every zone) */
  myZones: ScopeZone[];
}

export function planPageProps(me: MeResponse): PlanPageProps {
  if (me.permissions.global) return { role: 'SUPER_ADMIN', myZones: [] };
  return {
    role: 'ZONAL_ADMIN',
    myZones: me.permissions.zones
      .filter((z) => z.permissions.includes('plans:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
  };
}
