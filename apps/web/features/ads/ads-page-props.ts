import type { MeResponse, PermissionKey } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the Advertising pages show a member, from /me (server side). A convenience only: the API scopes every list to
// the member's ads:view zones and checks every write in the record's zone (403 without the action). D178: ads is an
// operations module, so a Super Admin (primary or not) has every action in every zone.

/** Zones where an action is allowed: 'ALL' for a Super Admin. */
export type ZoneGrant = 'ALL' | readonly string[];

export interface AdsPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view ads (empty for a Super Admin: every zone) */
  myZones: ScopeZone[];
  can: {
    /** ads:edit: quote a request */
    edit: ZoneGrant;
    /** ads:status: reject a request; pause, resume and cancel a campaign; a slot's status */
    status: ZoneGrant;
    /** commission:edit (D155): quote a commission % other than the slot's list % */
    commission: ZoneGrant;
  };
}

export const allows = (grant: ZoneGrant, zoneId: string): boolean =>
  grant === 'ALL' || grant.includes(zoneId);

/** True when the grant covers at least one zone. */
export const anyZone = (grant: ZoneGrant): boolean => grant === 'ALL' || grant.length > 0;

export function adsPageProps(me: MeResponse): AdsPageProps {
  if (me.permissions.global)
    return {
      role: 'SUPER_ADMIN',
      myZones: [],
      can: { edit: 'ALL', status: 'ALL', commission: 'ALL' },
    };
  const zones = me.permissions.zones;
  const where = (key: PermissionKey) =>
    zones.filter((z) => z.permissions.includes(key)).map((z) => z.zoneId);
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('ads:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: {
      edit: where('ads:edit'),
      status: where('ads:status'),
      commission: where('commission:edit'),
    },
  };
}
