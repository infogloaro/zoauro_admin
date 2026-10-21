import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the COD settlement and payout pages show a member, from /me (server side). A convenience only: the API scopes
// every row to the member's settlements:view / payouts:view zones and answers 404 for an unassigned ?zoneId.

export interface SettlementPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view the module (empty for a Super Admin: every zone) */
  myZones: ScopeZone[];
  /** settlements:add somewhere: record a COD hand-in (the API checks the partner's zone) */
  canRecord: boolean;
}

export function settlementPageProps(
  me: MeResponse,
  module: 'settlements' | 'payouts',
): SettlementPageProps {
  if (me.permissions.global) return { role: 'SUPER_ADMIN', myZones: [], canRecord: true };
  return {
    role: 'ZONAL_ADMIN',
    myZones: me.permissions.zones
      .filter((z) => z.permissions.includes(`${module}:view`))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    canRecord: me.permissions.zones.some((z) => z.permissions.includes('settlements:add')),
  };
}
