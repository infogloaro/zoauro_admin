import type { Metadata } from 'next';
import { ZonalDashboard } from '../../../../features/dashboard/ZonalDashboard';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Dashboard · ZOAURO Admin' };

/** The layout has already checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me || me.permissions.global) return null;
  return <ZonalDashboard name={me.user.name} zones={me.permissions.zones} />;
}
