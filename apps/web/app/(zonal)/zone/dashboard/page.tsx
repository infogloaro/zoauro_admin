import type { Metadata } from 'next';
import { DashboardStatus } from '../../../../components/shell/DashboardStatus';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Dashboard · ZOAURO Admin' };

/** The layout has already checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me || me.permissions.global) return null;
  return (
    <DashboardStatus name={me.user.name} userRole="ZONAL_ADMIN" zones={me.permissions.zones} />
  );
}
