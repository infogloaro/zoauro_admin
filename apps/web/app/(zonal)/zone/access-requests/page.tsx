import type { Metadata } from 'next';
import { RequestAccessPage } from '../../../../features/access/requests/RequestAccessPage';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Access requests · ZOAURO Admin' };

/** The layout has already checked the session and the role; every Zonal Admin may file their own requests. */
export default async function Page() {
  const me = await getMe();
  if (!me || me.permissions.global) return null;
  return <RequestAccessPage myZones={me.permissions.zones} />;
}
