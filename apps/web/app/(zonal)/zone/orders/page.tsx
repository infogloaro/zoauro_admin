import type { Metadata } from 'next';
import { OrdersPage } from '../../../../features/orders/OrdersPage';

export const metadata: Metadata = { title: 'Orders · ZOAURO Admin' };

/** Zonal Admins see the orders of the zones where they hold orders:view (the API decides). */
export default function Page() {
  return <OrdersPage basePath="/zone/orders" homeHref="/zone/dashboard" />;
}
