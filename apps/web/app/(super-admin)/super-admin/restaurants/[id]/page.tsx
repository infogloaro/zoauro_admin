import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VendorDetailPage } from '../../../../../features/vendors/VendorDetailPage';
import { vendorPageProps } from '../../../../../features/vendors/vendor-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Restaurants · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One vendor; the API answers 404 for a vendor outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = vendorPageProps(me, 'restaurants');
  if (!UUID.test(id) || (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0)) notFound();
  return (
    <VendorDetailPage module="restaurants" id={id} role={p.role} myZones={p.myZones} can={p.can} />
  );
}
