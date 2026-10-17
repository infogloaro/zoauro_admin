import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VendorsPage } from '../../../../features/vendors/VendorsPage';
import { vendorPageProps } from '../../../../features/vendors/vendor-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Home Food · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view homemakers anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = vendorPageProps(me, 'homemakers');
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <VendorsPage module="homemakers" role={p.role} myZones={p.myZones} canAdd={p.canAdd} />;
}
