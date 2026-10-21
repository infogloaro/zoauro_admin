import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderOverviewPage } from '../../../../../features/orders/OrderOverviewPage';
import { orderPageProps } from '../../../../../features/orders/order-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Order overview · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may view orders nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  if (orderPageProps(me).myZones.length === 0) notFound();
  return <OrderOverviewPage userRole="ZONAL_ADMIN" />;
}
