import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VendorsPage } from '../../../../features/vendors/VendorsPage';
import { vendorPageProps } from '../../../../features/vendors/vendor-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Restaurants · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view restaurants anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = vendorPageProps(me, 'restaurants');
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <VendorsPage module="restaurants" role={p.role} myZones={p.myZones} canAdd={p.canAdd} />;
}
