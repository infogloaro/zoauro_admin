import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrdersPage } from '../../../../features/orders/OrdersPage';
import { orderPageProps } from '../../../../features/orders/order-page-props';
import { canExportList } from '../../../../lib/export-access';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Orders · ZOAURO Admin' };

/** The layout has checked the session and the role; a member who may not view orders anywhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = orderPageProps(me);
  if (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0) notFound();
  return <OrdersPage role={p.role} myZones={p.myZones} canExport={canExportList(me, 'orders')} />;
}
