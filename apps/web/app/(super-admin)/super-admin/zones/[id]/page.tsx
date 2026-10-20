import type { Metadata } from 'next';
import { ZoneDetailPage } from '../../../../../features/zones/ZoneDetailPage';

export const metadata: Metadata = { title: 'Zone · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown zone. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ZoneDetailPage id={id} />;
}
