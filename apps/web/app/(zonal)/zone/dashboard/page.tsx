import type { Metadata } from 'next';
import { ZonalDashboard } from '../../../../features/dashboard/ZonalDashboard';
import { getMe } from '../../../../lib/server-session';
import { ZONE_PARAM, selectedZone } from '../../../../lib/zone-scope';

export const metadata: Metadata = { title: 'Dashboard · ZOAURO Admin' };

/**
 * The layout has already checked the session and the role. ?zone=<CODE> (the zone switcher, M05) narrows the view to
 * one of the member's own zones; any other code shows all of them (it never widens anything: the zones come from /me).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getMe();
  if (!me || me.permissions.global) return null;
  const raw = (await searchParams)[ZONE_PARAM];
  const zones = me.permissions.zones;
  const pick = selectedZone(
    typeof raw === 'string' ? raw : null,
    zones.map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
  );
  return (
    <ZonalDashboard
      name={me.user.name}
      zones={pick ? zones.filter((z) => z.zoneId === pick.id) : zones}
      zoneId={pick?.id ?? null}
    />
  );
}
