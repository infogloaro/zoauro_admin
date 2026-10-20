import type { Metadata } from 'next';
import { OrderDetailPage } from '../../../../../features/orders/OrderDetailPage';

export const metadata: Metadata = { title: 'Order · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown order. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OrderDetailPage id={id} listHref="/super-admin/orders" homeHref="/super-admin/dashboard" />
  );
}
