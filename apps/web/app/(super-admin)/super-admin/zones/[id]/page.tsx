import type { Metadata } from 'next';
import { ZoneDetailPage } from '../../../../../features/zones/ZoneDetailPage';
import { areaAllows } from '../../../../../lib/navigation';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Zone · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown zone. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  return <ZoneDetailPage id={id} canTeam={areaAllows('access', me.controlAreas)} />;
}
