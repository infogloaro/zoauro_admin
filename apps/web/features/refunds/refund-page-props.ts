import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the refund and payment pages show a member, from /me (server side). A convenience only: the API checks
// refunds:view / refunds:add / payments:view in the order's zone, the member's refund limits there (D20), and keeps
// the approvals (refunds:edit) to Super Admins; nobody approves their own refund.

export interface RefundPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  meId: string;
  /** zones where the member may view refunds (or payments, on the payment pages) */
  myZones: ScopeZone[];
  can: { add: boolean };
}

export function refundPageProps(me: MeResponse, module: 'refunds' | 'payments'): RefundPageProps {
  if (me.permissions.global)
    return { role: 'SUPER_ADMIN', meId: me.user.id, myZones: [], can: { add: true } };
  const zones = me.permissions.zones;
  return {
    role: 'ZONAL_ADMIN',
    meId: me.user.id,
    myZones: zones
      .filter((z) => z.permissions.includes(`${module}:view`))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    can: { add: zones.some((z) => z.permissions.includes('refunds:add')) },
  };
}
