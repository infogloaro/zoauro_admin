import type { Metadata } from 'next';
import { OrderOverviewPage } from '../../../../../features/orders/OrderOverviewPage';

export const metadata: Metadata = { title: 'Order overview · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default function Page() {
  return <OrderOverviewPage userRole="SUPER_ADMIN" />;
}
