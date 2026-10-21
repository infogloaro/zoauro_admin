import type { Metadata } from 'next';
import { PaymentsPage } from '../../../../features/refunds/PaymentsPage';
import { refundPageProps } from '../../../../features/refunds/refund-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Payments · ZOAURO Admin' };

/** The layout has checked the session and the role. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = refundPageProps(me, 'payments');
  return <PaymentsPage {...p} />;
}
