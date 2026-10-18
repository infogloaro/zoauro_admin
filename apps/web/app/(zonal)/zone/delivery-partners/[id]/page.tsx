import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PartnerDetailPage } from '../../../../../features/partners/PartnerDetailPage';
import { partnerPageProps } from '../../../../../features/partners/partner-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Delivery partner · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One partner; the API answers 404 for a partner outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = partnerPageProps(me);
  if (!UUID.test(id) || (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0)) notFound();
  return <PartnerDetailPage id={id} role={p.role} myZones={p.myZones} can={p.can} />;
}
