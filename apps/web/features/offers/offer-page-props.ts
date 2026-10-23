import type { MeResponse } from '@zoauro/shared';
import { canExportList } from '../../lib/export-access';
import type { ScopeZone } from '../../lib/zone-scope';

// What the offer pages show a member, from /me (server side). A convenience only: the API checks every zone of an offer
// on every write (D182 F1), keeps every-zone offers and shared funding to Super Admins, and decides who may approve.

export interface OfferPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  /** zones where the member may view offers (empty for a Super Admin: every zone) */
  viewZones: ScopeZone[];
  /** zones where the member may create offers (empty for a Super Admin: every zone) */
  addZones: ScopeZone[];
  /** offers:export where the zone's export switch is on (D182 F1, D149) */
  canExport?: boolean;
}

export function offerPageProps(me: MeResponse): OfferPageProps {
  const perms = me.permissions;
  const canExport = canExportList(me, 'offers');
  if (perms.global) return { role: 'SUPER_ADMIN', viewZones: [], addZones: [], canExport };
  const list = perms.zones;
  const zones = (key: string) =>
    list
      .filter((z) => (z.permissions as readonly string[]).includes(key))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex }));
  return {
    role: 'ZONAL_ADMIN',
    viewZones: zones('offers:view'),
    addZones: zones('offers:add'),
    canExport,
  };
}
