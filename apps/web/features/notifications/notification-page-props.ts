import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the notification pages show a member, from /me (server side): the zones where they may view notifications and
// whether compose / edit / cancel are offered (D94: whatever the Super Admin gives per zone). The API decides.

export interface NotificationPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  canAdd: boolean;
  can: { edit: boolean; cancel: boolean };
}

export function notificationPageProps(me: MeResponse): NotificationPageProps {
  if (me.permissions.global)
    return { role: 'SUPER_ADMIN', myZones: [], canAdd: true, can: { edit: true, cancel: true } };
  const zones = me.permissions.zones;
  const holds = (action: 'add' | 'edit' | 'delete') =>
    zones.some((z) => z.permissions.includes(`notifications:${action}`));
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => z.permissions.includes('notifications:view'))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    canAdd: holds('add'),
    can: { edit: holds('edit'), cancel: holds('delete') },
  };
}
