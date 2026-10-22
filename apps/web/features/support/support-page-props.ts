import type { MeResponse } from '@zoauro/shared';
import { superAdminExports } from '../../lib/export-access';
import type { ScopeZone } from '../../lib/zone-scope';

// What the support pages show a member, from /me (server side): their zones and which buttons to offer. A convenience
// only: the API checks support:view / edit / export in the ticket's zone, and the zone's export switch (D93, D149).

export interface SupportPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** the member's own id ("assign to me") */
  meId: string;
  /** zones where the member may view tickets */
  myZones: ScopeZone[];
  can: { edit: boolean; export: boolean };
}

export function supportPageProps(me: MeResponse): SupportPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      meId: me.user.id,
      myZones: [],
      can: { edit: true, export: superAdminExports(me) },
    };
  const zones = me.permissions.zones.filter((z) => z.permissions.includes('support:view'));
  return {
    role: 'ZONAL_ADMIN',
    meId: me.user.id,
    myZones: zones.map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: {
      edit: zones.some((z) => z.permissions.includes('support:edit')),
      export: zones.some((z) => z.permissions.includes('support:export') && z.limits.canExport),
    },
  };
}
