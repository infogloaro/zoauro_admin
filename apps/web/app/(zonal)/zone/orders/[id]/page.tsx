import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderDetailPage } from '../../../../../features/orders/OrderDetailPage';
import { orderPageProps } from '../../../../../features/orders/order-page-props';
import { getMe } from '../../../../../lib/server-session';

export const metadata: Metadata = { title: 'Order · ZOAURO Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One order; the API answers 404 for an order outside the member's zones. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) return null;
  const p = orderPageProps(me);
  if (!UUID.test(id) || (p.role === 'ZONAL_ADMIN' && p.myZones.length === 0)) notFound();
  return <OrderDetailPage id={id} role={p.role} can={p.can} />;
}
