import type { Metadata } from 'next';
import { OrdersPage } from '../../../../features/orders/OrdersPage';

export const metadata: Metadata = { title: 'Orders · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API scopes the orders. */
export default function Page() {
  return <OrdersPage basePath="/super-admin/orders" homeHref="/super-admin/dashboard" />;
}
