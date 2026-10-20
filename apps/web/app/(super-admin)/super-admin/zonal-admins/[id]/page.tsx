import type { Metadata } from 'next';
import { ZonalAdminDetailPage } from '../../../../../features/access/admins/ZonalAdminDetailPage';

export const metadata: Metadata = { title: 'Zonal Admin · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown member. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ZonalAdminDetailPage id={id} />;
}
