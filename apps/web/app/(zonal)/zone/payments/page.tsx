import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PaymentsPage } from '../../../../features/refunds/PaymentsPage';
import { refundPageProps } from '../../../../features/refunds/refund-page-props';
import { getMe } from '../../../../lib/server-session';

export const metadata: Metadata = { title: 'Payments · ZOAURO Admin' };

/** The layout has checked the session and the role. A member who may view payments nowhere gets 404. */
export default async function Page() {
  const me = await getMe();
  if (!me) return null;
  const p = refundPageProps(me, 'payments');
  if (p.myZones.length === 0) notFound();
  return <PaymentsPage {...p} />;
}
