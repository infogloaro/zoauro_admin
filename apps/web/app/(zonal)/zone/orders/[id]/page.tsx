import type { Metadata } from 'next';
import { OrderDetailPage } from '../../../../../features/orders/OrderDetailPage';

export const metadata: Metadata = { title: 'Order · ZOAURO Admin' };

/** An order outside the admin's zones is 404 from the API; the page shows "Order not found". */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailPage id={id} listHref="/zone/orders" homeHref="/zone/dashboard" />;
}
