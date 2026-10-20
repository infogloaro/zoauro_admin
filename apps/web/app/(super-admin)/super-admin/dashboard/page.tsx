import type { Metadata } from 'next';
import { SuperAdminDashboard } from '../../../../features/dashboard/SuperAdminDashboard';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Dashboard · ZOAURO Admin' };

/** The layout has already checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  return <SuperAdminDashboard name={me.user.name} />;
}
